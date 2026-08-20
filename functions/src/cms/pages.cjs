'use strict';

/**
 * Pages-as-data admin endpoints (spec §5.2, §8.4, issue #13).
 *
 *   cmsSavePage   POST { page } — validate the cmsPages doc shape and write
 *                 the DRAFT revision only (cmsPages_drafts, status 'dirty');
 *                 refuses to flip systemPage true -> false so the delete
 *                 guard below cannot be laundered via save -> publish.
 *   cmsDeletePage POST { id }   — remove live + draft in one batch; refuses
 *                 to delete a systemPage (those own a dedicated React route;
 *                 deleting the doc would strand the route's content).
 *
 * Editing never touches the live cmsPages collection — publish (cms/publish)
 * is the only writer of live docs (§8.4 two-revision model). Draft writes,
 * deletes, and admin_logs rows go through cms/store.cjs, injected as `store`
 * so tests drive fakes:
 *
 *   store.writeDraft({ db, collection, docId, fields, visible, actor, now })
 *   store.deleteBoth({ db, collection, docId })
 *   store.logAdminAction({ db, action, docPath, actor, now, log })
 *
 * `allowedBlocks` and `defaultBlocks[].blockType` are validated against the
 * code-resident BLOCK_TYPES registry; unknown ids are rejected BY NAME so an
 * admin sees which block id is wrong, not a generic shape error.
 */

const { isKnownBlockType } = require('./blockTypes.cjs');
const { requireAdmin } = require('../core/auth.cjs');
const { sendError, badRequest, notFound, forbidden, methodNotAllowed, internal } = require('../core/errors.cjs');

const PAGES_COLLECTION = 'cmsPages';
const PAGES_DRAFTS = 'cmsPages_drafts';

/** Doc ids are URL-path and Firestore-path safe; no slashes, no dots. */
const DOC_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Keys a cmsPages doc may carry — anything else is rejected by name. */
const PAGE_KEYS = Object.freeze(['id', 'label', 'path', 'icon', 'order', 'visible', 'systemPage', 'sections']);
const SECTION_KEYS = Object.freeze(['id', 'label', 'description', 'allowedBlocks', 'maxBlocks', 'reorderable', 'defaultBlocks']);
const DEFAULT_BLOCK_KEYS = Object.freeze(['field', 'blockType', 'description']);

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Validate a full cmsPages doc against the spec §5.2 shape. Pure — no db,
 * no clock. Returns every error, not the first one, each naming the
 * offending field (and for block ids, the unknown id itself).
 *
 * @param {unknown} doc
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validatePageDoc(doc) {
  const errors = [];
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    return { ok: false, errors: ['page: must be an object'] };
  }
  for (const key of Object.keys(doc)) {
    if (!PAGE_KEYS.includes(key)) errors.push(`${key}: unknown field`);
  }
  if (!isNonEmptyString(doc.id) || !DOC_ID_RE.test(doc.id)) {
    errors.push('id: must be 1-64 chars of letters, digits, hyphen, underscore');
  }
  if (!isNonEmptyString(doc.label)) errors.push('label: must be a non-empty string');
  if (!isNonEmptyString(doc.path) || !doc.path.startsWith('/')) {
    errors.push("path: must be a string starting with '/'");
  }
  if (doc.icon !== null && !isNonEmptyString(doc.icon)) {
    errors.push('icon: must be a non-empty string or null');
  }
  if (typeof doc.order !== 'number' || !Number.isFinite(doc.order)) {
    errors.push('order: must be a finite number');
  }
  if (typeof doc.visible !== 'boolean') errors.push('visible: must be a boolean');
  if (typeof doc.systemPage !== 'boolean') errors.push('systemPage: must be a boolean');

  if (!Array.isArray(doc.sections)) {
    errors.push('sections: must be an array');
    return { ok: errors.length === 0, errors };
  }
  const seenSectionIds = new Set();
  doc.sections.forEach((section, i) => {
    const at = `sections[${i}]`;
    if (typeof section !== 'object' || section === null || Array.isArray(section)) {
      errors.push(`${at}: must be an object`);
      return;
    }
    for (const key of Object.keys(section)) {
      if (!SECTION_KEYS.includes(key)) errors.push(`${at}.${key}: unknown field`);
    }
    if (!isNonEmptyString(section.id)) {
      errors.push(`${at}.id: must be a non-empty string`);
    } else if (seenSectionIds.has(section.id)) {
      errors.push(`${at}.id: duplicate section id '${section.id}'`);
    } else {
      seenSectionIds.add(section.id);
    }
    if (!isNonEmptyString(section.label)) errors.push(`${at}.label: must be a non-empty string`);
    if (section.description !== null && typeof section.description !== 'string') {
      errors.push(`${at}.description: must be a string or null`);
    }
    if (!Array.isArray(section.allowedBlocks) || section.allowedBlocks.length === 0) {
      errors.push(`${at}.allowedBlocks: must be a non-empty array of block type ids`);
    } else {
      section.allowedBlocks.forEach((blockId, j) => {
        if (!isKnownBlockType(blockId)) {
          errors.push(`${at}.allowedBlocks[${j}]: unknown block type '${String(blockId)}'`);
        }
      });
    }
    if (!Number.isInteger(section.maxBlocks) || section.maxBlocks < 1) {
      errors.push(`${at}.maxBlocks: must be an integer >= 1`);
    }
    if (typeof section.reorderable !== 'boolean') {
      errors.push(`${at}.reorderable: must be a boolean`);
    }
    if (!Array.isArray(section.defaultBlocks)) {
      errors.push(`${at}.defaultBlocks: must be an array`);
      return;
    }
    section.defaultBlocks.forEach((block, j) => {
      const bat = `${at}.defaultBlocks[${j}]`;
      if (typeof block !== 'object' || block === null || Array.isArray(block)) {
        errors.push(`${bat}: must be an object`);
        return;
      }
      for (const key of Object.keys(block)) {
        if (!DEFAULT_BLOCK_KEYS.includes(key)) errors.push(`${bat}.${key}: unknown field`);
      }
      if (!isNonEmptyString(block.field)) errors.push(`${bat}.field: must be a non-empty string`);
      if (!isKnownBlockType(block.blockType)) {
        errors.push(`${bat}.blockType: unknown block type '${String(block.blockType)}'`);
      }
      if (typeof block.description !== 'string') {
        errors.push(`${bat}.description: must be a string`);
      }
    });
  });
  return { ok: errors.length === 0, errors };
}

/**
 * Best-effort admin_logs row via store.logAdminAction — never fails the
 * call (house rule): a logging outage must not turn a committed mutation
 * into a client error. The store's own implementation already swallows
 * write failures; the try/catch here keeps the promise even against a
 * misbehaving injected fake.
 */
async function writeAdminLog({ db, store, now, log }, { action, docPath, uid, email }) {
  try {
    await store.logAdminAction({ db, action, docPath, actor: { uid, email }, now, log });
  } catch (err) {
    log.warn('admin_logs write failed', err);
  }
}

/**
 * @param {{ db: object,
 *           auth: { verifyIdToken: (t: string) => Promise<object> },
 *           getConfig: () => Promise<object>,
 *           store: { writeDraft: Function, logAdminAction: Function },
 *           now?: () => number, log?: Pick<Console, 'warn'|'error'> }} deps
 */
function createSavePageHandler({ db, auth, getConfig, store, now = Date.now, log = console }) {
  return async function cmsSavePage(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ auth, getConfig }, req);
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);

    const page = req.body?.page;
    const verdict = validatePageDoc(page);
    if (!verdict.ok) return badRequest(res, `Invalid page: ${verdict.errors.join('; ')}`);

    // systemPage may never be flipped true -> false: cmsDeletePage refuses to
    // delete a system page, and letting a draft edit clear the flag would let
    // save -> publish -> delete launder one into deletability (stranding its
    // dedicated React route, §5.2). Checked against BOTH revisions, same as
    // the delete guard.
    if (page.systemPage === false) {
      let isSystem;
      try {
        const [draftSnap, liveSnap] = await Promise.all([
          db.collection(PAGES_DRAFTS).doc(page.id).get(),
          db.collection(PAGES_COLLECTION).doc(page.id).get(),
        ]);
        isSystem = (draftSnap.exists && draftSnap.data().systemPage === true) ||
          (liveSnap.exists && liveSnap.data().systemPage === true);
      } catch (err) {
        log.error('cmsSavePage systemPage check failed', err);
        return internal(res, 'The page could not be saved.');
      }
      if (isSystem) {
        return forbidden(res, 'systemPage: a system page cannot be changed into a regular page.');
      }
    }

    try {
      // The store strips reserved publish-model keys (visible/status/
      // revision/...) from `fields` itself; visible rides separately.
      await store.writeDraft({
        db,
        collection: PAGES_COLLECTION,
        docId: page.id,
        fields: page,
        visible: page.visible,
        actor: { uid: gate.uid, email: gate.email },
        now,
      });
    } catch (err) {
      log.error('cmsSavePage draft write failed', err);
      return internal(res, 'The page could not be saved.');
    }
    await writeAdminLog({ db, store, now, log }, {
      action: 'cmsSavePage',
      docPath: `${PAGES_DRAFTS}/${page.id}`,
      uid: gate.uid,
      email: gate.email,
    });
    res.status(200).json({ id: page.id, status: 'dirty' });
  };
}

/**
 * @param {{ db: object,
 *           auth: { verifyIdToken: (t: string) => Promise<object> },
 *           getConfig: () => Promise<object>,
 *           store: { deleteBoth: Function, logAdminAction: Function },
 *           now?: () => number, log?: Pick<Console, 'warn'|'error'> }} deps
 */
function createDeletePageHandler({ db, auth, getConfig, store, now = Date.now, log = console }) {
  return async function cmsDeletePage(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ auth, getConfig }, req);
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);

    const id = req.body?.id;
    if (!isNonEmptyString(id) || !DOC_ID_RE.test(id)) {
      return badRequest(res, 'id: must be a valid page id');
    }

    const [draftSnap, liveSnap] = await Promise.all([
      db.collection(PAGES_DRAFTS).doc(id).get(),
      db.collection(PAGES_COLLECTION).doc(id).get(),
    ]);
    if (!draftSnap.exists && !liveSnap.exists) return notFound(res, 'Page not found.');
    // A page is a system page if EITHER revision says so — a draft edit must
    // not be able to launder a system page into deletability.
    const isSystem = (draftSnap.exists && draftSnap.data().systemPage === true) ||
      (liveSnap.exists && liveSnap.data().systemPage === true);
    if (isSystem) return forbidden(res, 'System pages cannot be deleted.');

    try {
      await store.deleteBoth({ db, collection: PAGES_COLLECTION, docId: id });
    } catch (err) {
      log.error('cmsDeletePage failed', err);
      return internal(res, 'The page could not be deleted.');
    }
    await writeAdminLog({ db, store, now, log }, {
      action: 'cmsDeletePage',
      docPath: `${PAGES_COLLECTION}/${id}`,
      uid: gate.uid,
      email: gate.email,
    });
    res.status(200).json({ id, deleted: true });
  };
}

/** Deployable exports (spec §1.3 cms/): cmsSavePage, cmsDeletePage. */
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
    cmsSavePage: onRequest({ region }, withCors(async (req, res) => {
      await createSavePageHandler(buildDeps())(req, res);
    })),
    cmsDeletePage: onRequest({ region }, withCors(async (req, res) => {
      await createDeletePageHandler(buildDeps())(req, res);
    })),
  };
}

module.exports = {
  validatePageDoc,
  createSavePageHandler,
  createDeletePageHandler,
  get handlers() {
    return buildHandlers();
  },
  internals: { writeAdminLog, DOC_ID_RE, PAGE_KEYS, SECTION_KEYS, DEFAULT_BLOCK_KEYS },
};
