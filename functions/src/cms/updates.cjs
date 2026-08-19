'use strict';

/**
 * News/announcement post admin endpoints (spec §4.1 cmsUpdates, §8.4,
 * issue #13).
 *
 *   cmsSaveUpdate   POST { id?, update, visible? } — validate and write the
 *                   DRAFT revision only (cmsUpdates_drafts, status 'dirty').
 *                   Omitting `id` creates a new update with a random id.
 *   cmsDeleteUpdate POST { id } — remove live + draft in one batch.
 *
 * cmsUpdates content fields: { title, body, publishAt | null, pinned }.
 * `publishAt` is editorial display scheduling — it never gates the §8.4
 * publish action, which stays an explicit admin batch. Accepted as null, an
 * ISO-8601 string, or epoch millis; stored as a Date so Firestore holds a
 * Timestamp rather than a client-formatted string.
 *
 * Draft writes, deletes, and admin_logs rows go through cms/store.cjs
 * (same injected interface as cms/pages.cjs: writeDraft / deleteBoth /
 * logAdminAction); live cmsUpdates docs are written only by cms/publish.
 */

const crypto = require('node:crypto');
const { requireAdmin } = require('../core/auth.cjs');
const { sendError, badRequest, notFound, methodNotAllowed, internal } = require('../core/errors.cjs');
const { internals: pagesInternals } = require('./pages.cjs');

const { writeAdminLog, DOC_ID_RE } = pagesInternals;

const UPDATES_COLLECTION = 'cmsUpdates';
const UPDATES_DRAFTS = 'cmsUpdates_drafts';

/** Keys a cmsUpdates doc may carry — anything else is rejected by name. */
const UPDATE_KEYS = Object.freeze(['title', 'body', 'publishAt', 'pinned']);

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/** @param {unknown} v @returns {Date|null|undefined} undefined = invalid */
function normalizePublishAt(v) {
  if (v === null) return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : undefined;
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v);
  if (typeof v === 'string') {
    const ms = Date.parse(v);
    return Number.isFinite(ms) ? new Date(ms) : undefined;
  }
  return undefined;
}

/**
 * Validate a cmsUpdates content doc. Pure — no db, no clock. Returns every
 * error, each naming the offending field.
 *
 * @param {unknown} doc
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validateUpdateDoc(doc) {
  const errors = [];
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    return { ok: false, errors: ['update: must be an object'] };
  }
  for (const key of Object.keys(doc)) {
    if (!UPDATE_KEYS.includes(key)) errors.push(`${key}: unknown field`);
  }
  if (!isNonEmptyString(doc.title)) errors.push('title: must be a non-empty string');
  if (!isNonEmptyString(doc.body)) errors.push('body: must be a non-empty string');
  if (!('publishAt' in doc) || normalizePublishAt(doc.publishAt) === undefined) {
    errors.push('publishAt: must be null, an ISO-8601 string, or epoch millis');
  }
  if (typeof doc.pinned !== 'boolean') errors.push('pinned: must be a boolean');
  return { ok: errors.length === 0, errors };
}

/**
 * @param {{ db: object,
 *           auth: { verifyIdToken: (t: string) => Promise<object> },
 *           getConfig: () => Promise<object>,
 *           store: { writeDraft: Function, logAdminAction: Function },
 *           now?: () => number, log?: Pick<Console, 'warn'|'error'> }} deps
 */
function createSaveUpdateHandler({ db, auth, getConfig, store, now = Date.now, log = console }) {
  return async function cmsSaveUpdate(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ auth, getConfig }, req);
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);

    const update = req.body?.update;
    const verdict = validateUpdateDoc(update);
    if (!verdict.ok) return badRequest(res, `Invalid update: ${verdict.errors.join('; ')}`);

    const rawId = req.body?.id;
    if (rawId !== undefined && (!isNonEmptyString(rawId) || !DOC_ID_RE.test(rawId))) {
      return badRequest(res, 'id: must be a valid update id');
    }
    const visible = req.body?.visible;
    if (visible !== undefined && typeof visible !== 'boolean') {
      return badRequest(res, 'visible: must be a boolean');
    }
    const id = rawId === undefined ? crypto.randomUUID() : rawId;

    const contentFields = {
      title: update.title,
      body: update.body,
      publishAt: normalizePublishAt(update.publishAt),
      pinned: update.pinned,
    };
    try {
      await store.writeDraft({
        db,
        collection: UPDATES_COLLECTION,
        docId: id,
        fields: contentFields,
        // Omitted => undefined, so the store preserves the prior draft/live
        // visibility (§8.4: visibility changes are explicit admin actions,
        // never a side effect of editing). Forcing a default here would
        // silently re-show an unpublished update on its next edit.
        visible,
        actor: { uid: gate.uid, email: gate.email },
        now,
      });
    } catch (err) {
      log.error('cmsSaveUpdate draft write failed', err);
      return internal(res, 'The update could not be saved.');
    }
    await writeAdminLog({ db, store, now, log }, {
      action: 'cmsSaveUpdate',
      docPath: `${UPDATES_DRAFTS}/${id}`,
      uid: gate.uid,
      email: gate.email,
    });
    res.status(200).json({ id, status: 'dirty' });
  };
}

/**
 * @param {{ db: object,
 *           auth: { verifyIdToken: (t: string) => Promise<object> },
 *           getConfig: () => Promise<object>,
 *           store: { deleteBoth: Function, logAdminAction: Function },
 *           now?: () => number, log?: Pick<Console, 'warn'|'error'> }} deps
 */
function createDeleteUpdateHandler({ db, auth, getConfig, store, now = Date.now, log = console }) {
  return async function cmsDeleteUpdate(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ auth, getConfig }, req);
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);

    const id = req.body?.id;
    if (!isNonEmptyString(id) || !DOC_ID_RE.test(id)) {
      return badRequest(res, 'id: must be a valid update id');
    }
    const [draftSnap, liveSnap] = await Promise.all([
      db.collection(UPDATES_DRAFTS).doc(id).get(),
      db.collection(UPDATES_COLLECTION).doc(id).get(),
    ]);
    if (!draftSnap.exists && !liveSnap.exists) return notFound(res, 'Update not found.');

    try {
      await store.deleteBoth({ db, collection: UPDATES_COLLECTION, docId: id });
    } catch (err) {
      log.error('cmsDeleteUpdate failed', err);
      return internal(res, 'The update could not be deleted.');
    }
    await writeAdminLog({ db, store, now, log }, {
      action: 'cmsDeleteUpdate',
      docPath: `${UPDATES_COLLECTION}/${id}`,
      uid: gate.uid,
      email: gate.email,
    });
    res.status(200).json({ id, deleted: true });
  };
}

/** Deployable exports (spec §1.3 cms/): cmsSaveUpdate, cmsDeleteUpdate. */
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';

  const buildDeps = () => {
    const { getDb } = require('../core/firestore.cjs');
    const { getAuth } = require('firebase-admin/auth');
    const { getEventConfig } = require('../core/config.cjs');
    const store = require('./store.cjs');
    const db = getDb();
    return { db, auth: getAuth(), getConfig: () => getEventConfig({ db }), store };
  };

  const withCors = (handler) => async (req, res) => {
    const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
    const handled = applyCors(req, res, {
      allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS),
    });
    if (handled) return;
    await handler(req, res);
  };

  return {
    cmsSaveUpdate: onRequest({ region }, withCors(async (req, res) => {
      await createSaveUpdateHandler(buildDeps())(req, res);
    })),
    cmsDeleteUpdate: onRequest({ region }, withCors(async (req, res) => {
      await createDeleteUpdateHandler(buildDeps())(req, res);
    })),
  };
}

module.exports = {
  validateUpdateDoc,
  createSaveUpdateHandler,
  createDeleteUpdateHandler,
  get handlers() {
    return buildHandlers();
  },
  internals: { normalizePublishAt, UPDATE_KEYS },
};
