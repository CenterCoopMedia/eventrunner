'use strict';

/**
 * Content-block endpoints under the two-revision publish model
 * (spec §8.4 step 1, §4.1, issue #12).
 *
 *   cmsCreateContent  admin POST — new draft; 409 if the doc exists
 *   cmsUpdateContent  admin POST — merge onto the draft (forking one from
 *                     the live doc if only that exists); DRAFTS ONLY
 *   cmsDeleteContent  admin POST — removes live + draft in one batch
 *   getSiteContent    PUBLIC GET — published cmsContent where visible==true
 *
 * cmsContent docs are keyed section+field (spec §4.1): the doc id is
 * `<section>__<field>` and both keys are stored as content fields, so a
 * (section, field) pair can never map to two docs. The other GENERIC
 * collections address docs by explicit docId; cmsPages/cmsUpdates are out
 * of scope here (see GENERIC_COLLECTIONS).
 *
 * None of the mutation handlers ever writes a live collection — that is
 * publish's job (store.publishDocs) — so a keystroke saved to an
 * already-published doc is never visible to anonymous readers.
 */

const { requireAdmin } = require('../core/auth.cjs');
const { sendError, badRequest, notFound, methodNotAllowed, internal } = require('../core/errors.cjs');
const { draftCollectionFor } = require('./blockTypes.cjs');
const {
  writeDraft,
  deleteBoth,
  logAdminAction,
  contentFieldsOf,
  isValidDocId,
  internals: storeInternals,
} = require('./store.cjs');

const SECTION_FIELD_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/**
 * The publishable collections these generic endpoints may write. cmsPages
 * and cmsUpdates are deliberately EXCLUDED: their drafts must go through
 * cmsSavePage / cmsSaveUpdate (and cmsDeletePage / cmsDeleteUpdate), whose
 * validators enforce §5.2 BLOCK_TYPES and the updates shape — a generic
 * writer here would let an unvalidated draft reach publish verbatim.
 */
const GENERIC_COLLECTIONS = Object.freeze([
  'cmsContent',
  'cmsSchedule',
  'cmsOrganizations',
  'cmsTimeline',
]);

/**
 * Resolve the target doc from a request body. cmsContent is keyed
 * section+field; the other GENERIC_COLLECTIONS take an explicit docId.
 * Returns extraFields so section/field ride along as content fields on
 * cmsContent docs.
 *
 * @param {object} body
 * @returns {{ ok: true, collection: string, docId: string, extraFields: object } |
 *           { ok: false, message: string }}
 */
function resolveTarget(body) {
  const collection = typeof body?.collection === 'string' ? body.collection : 'cmsContent';
  if (!GENERIC_COLLECTIONS.includes(collection)) {
    if (collection === 'cmsPages' || collection === 'cmsUpdates') {
      return {
        ok: false,
        message: collection === 'cmsPages'
          ? 'cmsPages drafts must go through cmsSavePage / cmsDeletePage.'
          : 'cmsUpdates drafts must go through cmsSaveUpdate / cmsDeleteUpdate.',
      };
    }
    return { ok: false, message: `Unknown collection. Writable here: ${GENERIC_COLLECTIONS.join(', ')}.` };
  }
  if (collection === 'cmsContent') {
    const { section, field } = body || {};
    if (typeof section !== 'string' || !SECTION_FIELD_RE.test(section) ||
        typeof field !== 'string' || !SECTION_FIELD_RE.test(field)) {
      return { ok: false, message: 'cmsContent docs are keyed by section and field (letters, digits, _ and -).' };
    }
    return { ok: true, collection, docId: `${section}__${field}`, extraFields: { section, field } };
  }
  if (!isValidDocId(body?.docId)) {
    return { ok: false, message: `${collection} requires a valid docId.` };
  }
  return { ok: true, collection, docId: body.docId, extraFields: {} };
}

/**
 * Caller-supplied content fields: a plain object whose keys never collide
 * with the publish model's bookkeeping (store RESERVED_FIELDS) — a client
 * must not be able to hand-set `revision` or `status`.
 *
 * @param {unknown} fields
 * @returns {{ ok: true, fields: object } | { ok: false, message: string }}
 */
function validateFields(fields) {
  if (fields === undefined) return { ok: true, fields: {} };
  if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) {
    return { ok: false, message: 'fields must be an object.' };
  }
  const reserved = Object.keys(fields).filter((k) => storeInternals.RESERVED_FIELDS.includes(k));
  if (reserved.length > 0) {
    return { ok: false, message: `fields may not set reserved keys: ${reserved.join(', ')}.` };
  }
  return { ok: true, fields };
}

/** Shared admin-POST preamble. Sends the response itself on failure. */
async function gateAdminPost({ auth, getConfig }, req, res) {
  if (req.method !== 'POST') {
    methodNotAllowed(res, ['POST']);
    return null;
  }
  const verdict = await requireAdmin({ auth, getConfig }, req);
  if (!verdict.ok) {
    sendError(res, verdict.status, verdict.code, verdict.message);
    return null;
  }
  return verdict;
}

/**
 * @param {{ db, auth, getConfig, now?: () => number, log?: Console }} deps
 */
function createCmsCreateContentHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function cmsCreateContent(req, res) {
    const actor = await gateAdminPost({ auth, getConfig }, req, res);
    if (!actor) return;
    const target = resolveTarget(req.body);
    if (!target.ok) return badRequest(res, target.message);
    const checked = validateFields(req.body?.fields);
    if (!checked.ok) return badRequest(res, checked.message);

    const { collection, docId, extraFields } = target;
    const draftRef = db.collection(draftCollectionFor(collection)).doc(docId);
    const [draftSnap, liveSnap] = await Promise.all([
      draftRef.get(),
      db.collection(collection).doc(docId).get(),
    ]);
    if (draftSnap.exists || liveSnap.exists) {
      return sendError(res, 409, 'already-exists', 'That document already exists; use cmsUpdateContent.');
    }

    const { docPath } = await writeDraft({
      db,
      collection,
      docId,
      fields: { ...checked.fields, ...extraFields },
      visible: typeof req.body?.visible === 'boolean' ? req.body.visible : undefined,
      actor,
      now,
    });
    await logAdminAction({ db, action: 'cms-create-content', docPath, actor, now, log });
    res.status(200).json({ docPath, docId, status: 'dirty' });
  };
}

/**
 * @param {{ db, auth, getConfig, now?: () => number, log?: Console }} deps
 */
function createCmsUpdateContentHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function cmsUpdateContent(req, res) {
    const actor = await gateAdminPost({ auth, getConfig }, req, res);
    if (!actor) return;
    const target = resolveTarget(req.body);
    if (!target.ok) return badRequest(res, target.message);
    const checked = validateFields(req.body?.fields);
    if (!checked.ok) return badRequest(res, checked.message);

    const { collection, docId, extraFields } = target;
    const draftSnap = await db.collection(draftCollectionFor(collection)).doc(docId).get();
    let base;
    if (draftSnap.exists) {
      base = contentFieldsOf(draftSnap.data());
    } else {
      // No draft yet: fork one from the published doc. writeDraft picks up
      // basedOnRevision from the live doc itself.
      const liveSnap = await db.collection(collection).doc(docId).get();
      if (!liveSnap.exists) return notFound(res, 'No such document; use cmsCreateContent.');
      base = contentFieldsOf(liveSnap.data());
    }

    const { docPath } = await writeDraft({
      db,
      collection,
      docId,
      fields: { ...base, ...checked.fields, ...extraFields },
      visible: typeof req.body?.visible === 'boolean' ? req.body.visible : undefined,
      actor,
      now,
    });
    await logAdminAction({ db, action: 'cms-update-content', docPath, actor, now, log });
    res.status(200).json({ docPath, docId, status: 'dirty' });
  };
}

/**
 * @param {{ db, auth, getConfig, now?: () => number, log?: Console }} deps
 */
function createCmsDeleteContentHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function cmsDeleteContent(req, res) {
    const actor = await gateAdminPost({ auth, getConfig }, req, res);
    if (!actor) return;
    const target = resolveTarget(req.body);
    if (!target.ok) return badRequest(res, target.message);

    const { livePath, draftPath } = await deleteBoth({
      db,
      collection: target.collection,
      docId: target.docId,
    });
    await logAdminAction({ db, action: 'cms-delete-content', docPath: livePath, actor, now, log });
    res.status(200).json({ deleted: [livePath, draftPath] });
  };
}

/**
 * PUBLIC GET: the published, visible content blocks. No auth — Firestore
 * rules make these docs anonymously readable anyway (spec §8.4). The
 * response omits publishedBy so admin addresses are not trivially
 * harvestable from an unauthenticated endpoint; every other live field is
 * public by design.
 *
 * @param {{ db, log?: Console }} deps
 */
function createGetSiteContentHandler({ db, log = console }) {
  return async function getSiteContent(req, res) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
    try {
      const snap = await db.collection('cmsContent').where('visible', '==', true).get();
      const content = snap.docs.map((d) => {
        const { publishedBy, ...data } = d.data();
        return { id: d.id, ...data };
      });
      res.status(200).json({ content });
    } catch (err) {
      log.error('getSiteContent read failed', err);
      internal(res, 'Content is temporarily unavailable.');
    }
  };
}

/** Deployable exports (spec §1.3 cms/). */
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';

  const buildDeps = () => {
    const { getDb } = require('../core/firestore.cjs');
    const { getAuth } = require('firebase-admin/auth');
    const { getEventConfig } = require('../core/config.cjs');
    const db = getDb();
    return { db, auth: getAuth(), getConfig: () => getEventConfig({ db }), now: Date.now, log: console };
  };

  const withCors = (methods, handler) => async (req, res) => {
    const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
    const handled = applyCors(req, res, {
      allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS),
      methods,
    });
    if (handled) return;
    await handler(req, res);
  };

  return {
    cmsCreateContent: onRequest({ region }, withCors(['POST'], async (req, res) => {
      await createCmsCreateContentHandler(buildDeps())(req, res);
    })),
    cmsUpdateContent: onRequest({ region }, withCors(['POST'], async (req, res) => {
      await createCmsUpdateContentHandler(buildDeps())(req, res);
    })),
    cmsDeleteContent: onRequest({ region }, withCors(['POST'], async (req, res) => {
      await createCmsDeleteContentHandler(buildDeps())(req, res);
    })),
    getSiteContent: onRequest({ region }, withCors(['GET'], async (req, res) => {
      const { getDb } = require('../core/firestore.cjs');
      await createGetSiteContentHandler({ db: getDb() })(req, res);
    })),
  };
}

module.exports = {
  createCmsCreateContentHandler,
  createCmsUpdateContentHandler,
  createCmsDeleteContentHandler,
  createGetSiteContentHandler,
  get handlers() {
    return buildHandlers();
  },
  internals: { resolveTarget, validateFields, isValidDocId, SECTION_FIELD_RE, GENERIC_COLLECTIONS },
};
