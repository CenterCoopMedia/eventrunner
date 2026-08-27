'use strict';

/**
 * Pages-as-data admin endpoints (spec §5.2, §8.4, issue #13).
 *
 *   cmsSavePage   POST { page } — validate the cmsPages doc shape and write
 *                 the DRAFT revision only (cmsPages_drafts, status 'dirty');
 *                 refuses to flip systemPage true -> false so the delete
 *                 guard below cannot be laundered via save -> publish; a
 *                 generic page's `path` must be root-level, normalized, not
 *                 reserved (shared/routing, issue #52), and not already
 *                 claimed by another page (draft or live).
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
const { PAGE_TEMPLATE_IDS } = require('./pageTemplates.cjs');
const { requireAdmin } = require('../core/auth.cjs');
const { sendError, badRequest, notFound, forbidden, methodNotAllowed, internal } = require('../core/errors.cjs');
const { isReservedPathSegment } = require('shared/routing');

const PAGES_COLLECTION = 'cmsPages';
const PAGES_DRAFTS = 'cmsPages_drafts';

/** Doc ids are URL-path and Firestore-path safe; no slashes, no dots. */
const DOC_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** One normalized path segment: lowercase slug, no leading/trailing hyphen. */
const PATH_SEGMENT_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Keys a cmsPages doc may carry — anything else is rejected by name. */
const PAGE_KEYS = Object.freeze(['id', 'label', 'path', 'icon', 'order', 'visible', 'systemPage', 'sections', 'layout', 'template']);
const SECTION_KEYS = Object.freeze(['id', 'label', 'description', 'allowedBlocks', 'maxBlocks', 'reorderable', 'defaultBlocks', 'slot']);
const DEFAULT_BLOCK_KEYS = Object.freeze(['field', 'blockType', 'description']);

/**
 * The page-level layout variants (design brief §6.1, §6.2). A system page
 * changes shape from data: no code edit, no new component, no new class.
 *
 * Mirrored in apps/web/src/lib/pageLayout.js, which the admin editor and the
 * public renderer both read; pageDoc.test.js pins the two together.
 */
const PAGE_LAYOUT_KEYS = Object.freeze(['header', 'arrangement', 'density', 'navPlacement']);

/**
 * `navPlacement` IS THE PAGE-LEVEL EXCEPTION TO A SITE-LEVEL SETTING.
 *
 * Where the navigation sits is normally a property of the site, not of one
 * page: a reader who meets a top nav on the home page and a side rail on
 * the schedule has lost the shell that told them where they are. So the
 * ordinary answer lives in config/theme.navPlacement, beside the rest of
 * the site's structure, and covers every page.
 *
 * A page may still overrule it, which is why this key is accepted here and
 * offered in the page editor's Advanced disclosure. The exception is real
 * work — one directory that wants a rail beside it, one landing page that
 * wants only a top row — and the renderer reads the page's value FIRST
 * (apps/web/src/components/Layout.jsx), then the site's, then the default.
 * A stated exception the site setting could overrule would not be an
 * exception; it would be a value the editor accepts and the shell ignores.
 *
 * Reading the page first is also what keeps deployments that set it per
 * page, before the site setting existed, rendering exactly what they
 * rendered.
 */

/**
 * What each variant may say. Every value is checked on write and an unknown
 * one is rejected BY NAME, so a typo fails at the save rather than degrading
 * silently in the renderer.
 *
 * `header` carries no `none` (brief §6.2): every public page has a nameplate
 * (§5.1), so `nameplate-compact` is the minimum. A page that renders no
 * header at all is not a layout variant.
 */
const PAGE_LAYOUT_VALUES = Object.freeze({
  header: Object.freeze(['nameplate', 'nameplate-compact']),
  arrangement: Object.freeze(['grid', 'list']),
  density: Object.freeze(['tight', 'comfortable', 'loose']),
  navPlacement: Object.freeze(['top', 'side']),
});

/**
 * Where a section renders relative to the core feature component
 * (brief §6.2). `main` is the default and it has stated semantics: the order
 * down a system page is nameplate, `above` sections, the core component,
 * `main` sections, `below` sections.
 *
 * That default is what keeps existing data working. A section stored before
 * this schema landed carries no `slot`, so it reads as `main` and renders in
 * the old position — no migration runs, and no seeded page changes shape.
 */
const SECTION_SLOTS = Object.freeze(['above', 'main', 'below']);

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
  } else if (doc.path === '/') {
    // '/' is the home page's route (index route in App.jsx) — reserved for
    // the systemPage that owns it, never assignable to a generic page.
    if (doc.systemPage !== true) {
      errors.push("path: '/' is reserved for the home page");
    }
  } else if (doc.path.endsWith('/')) {
    errors.push('path: must not end with a trailing slash');
  } else if (doc.path.includes('//')) {
    errors.push('path: must not contain empty segments (//)');
  } else {
    const segments = doc.path.slice(1).split('/');
    segments.forEach((segment) => {
      if (!PATH_SEGMENT_RE.test(segment)) {
        errors.push(
          `path: segment '${segment}' must be lowercase letters, digits, and hyphens, with no leading or trailing hyphen`,
        );
      }
    });
    // Reserved first-segment collision (issue #52): every statically
    // mounted App.jsx route (plus the retired /p/ prefix) owns its first
    // segment. System pages ARE those routes, so they're exempt — this
    // only blocks a generic page from claiming one.
    if (doc.systemPage !== true && isReservedPathSegment(segments[0])) {
      errors.push(`path: '${segments[0]}' is a reserved route and cannot be used by a page`);
    }
  }
  if (doc.icon !== null && !isNonEmptyString(doc.icon)) {
    errors.push('icon: must be a non-empty string or null');
  }
  if (typeof doc.order !== 'number' || !Number.isFinite(doc.order)) {
    errors.push('order: must be a finite number');
  }
  if (typeof doc.visible !== 'boolean') errors.push('visible: must be a boolean');
  if (typeof doc.systemPage !== 'boolean') errors.push('systemPage: must be a boolean');

  // `template` is the task the operator picked, and it is optional twice
  // over: a document written before templates existed carries none, and an
  // operator may still set the variants by hand without naming a template.
  // Null and absent both mean "no template", which is a fact about the
  // page rather than a gap — nothing infers one from the layout values.
  if (doc.template !== undefined && doc.template !== null) {
    if (!PAGE_TEMPLATE_IDS.includes(doc.template)) {
      errors.push(
        `template: must be one of ${PAGE_TEMPLATE_IDS.join(', ')}, got ${JSON.stringify(doc.template)}`,
      );
    }
  }

  // `layout` is optional: a document written before this schema landed
  // carries none, reads as the default layout, and keeps working with no
  // migration (brief §6.2). What it does carry is checked key by key.
  if (doc.layout !== undefined) {
    if (typeof doc.layout !== 'object' || doc.layout === null || Array.isArray(doc.layout)) {
      errors.push('layout: must be an object');
    } else {
      for (const key of Object.keys(doc.layout)) {
        if (!PAGE_LAYOUT_KEYS.includes(key)) errors.push(`layout.${key}: unknown field`);
      }
      for (const key of PAGE_LAYOUT_KEYS) {
        const value = doc.layout[key];
        if (value === undefined) continue;
        if (!PAGE_LAYOUT_VALUES[key].includes(value)) {
          errors.push(
            `layout.${key}: must be one of ${PAGE_LAYOUT_VALUES[key].join(', ')}, ` +
            `got ${JSON.stringify(value)}`,
          );
        }
      }
    }
  }

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
    // Optional, and absent means `main`. A custom page ignores the slot
    // because it has no core component, but the value is still checked
    // there: a page that stops being a system page must not carry a slot
    // nothing would ever accept back.
    if (section.slot !== undefined && !SECTION_SLOTS.includes(section.slot)) {
      errors.push(
        `${at}.slot: must be one of ${SECTION_SLOTS.join(', ')}, got ${JSON.stringify(section.slot)}`,
      );
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

    // Path uniqueness (issue #52): Firestore has no unique index, so this is
    // an application-level check — scan both revisions for any OTHER page
    // id already claiming this exact path. Draft AND live are checked: a
    // collision with an unpublished draft is just as real to an admin about
    // to save as one already live.
    try {
      const [draftPathSnap, livePathSnap] = await Promise.all([
        db.collection(PAGES_DRAFTS).where('path', '==', page.path).get(),
        db.collection(PAGES_COLLECTION).where('path', '==', page.path).get(),
      ]);
      const collision = [...draftPathSnap.docs, ...livePathSnap.docs].find((doc) => doc.id !== page.id);
      if (collision) {
        return badRequest(res, `path: '${page.path}' is already used by page '${collision.id}'`);
      }
    } catch (err) {
      log.error('cmsSavePage path uniqueness check failed', err);
      return internal(res, 'The page could not be saved.');
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
  PAGE_LAYOUT_KEYS,
  PAGE_LAYOUT_VALUES,
  SECTION_SLOTS,
  PAGE_TEMPLATE_IDS,
  internals: { writeAdminLog, DOC_ID_RE, PAGE_KEYS, SECTION_KEYS, DEFAULT_BLOCK_KEYS },
};
