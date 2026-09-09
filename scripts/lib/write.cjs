'use strict';

/**
 * Firestore write paths for the seeding scripts (spec §5.1 steps b–e, §8.4).
 *
 * Seeded CMS documents go through the SAME primitives the admin endpoints
 * use — `cms/store.cjs` `writeDraft` + `publishDocs` — rather than a
 * parallel writer of this script's own. That is what makes a seeded page
 * indistinguishable from an admin-authored one: it has a clean draft, a
 * live revision, and a `cmsVersionHistory` row, so the first thing an
 * editor does to a seeded block behaves exactly like editing anything
 * else. A hand-rolled `set()` here would create live docs with no draft,
 * and the first admin save would appear to conflict with a document that
 * was never published.
 *
 * Idempotency lives in `idempotency.cjs` and is applied before any write:
 * a document a client has edited (its `seeded` flag cleared) is skipped
 * and reported, never refreshed.
 */

const { decideSeedWrite, decideConfigWrite } = require('./idempotency.cjs');
const { draftCollectionFor } = require('../../functions/src/cms/blockTypes.cjs');

/** Actor recorded on seeded writes; not a person, and deliberately visible. */
const SEED_ACTOR = Object.freeze({ uid: 'init-event-script', email: 'init-event-script' });

/**
 * Write the `config/*` documents (§5.1 steps b–c).
 *
 * Returns both what happened and the EFFECTIVE documents — what the
 * project holds now, which for a skipped or partially preserved doc is
 * not what the caller passed in. Content seeding derives copy from
 * configuration (§5.5 legal templates read the auth and provider
 * settings), so it must build from what is stored, not from what init
 * proposed and the merge rules then declined to apply.
 *
 * @param {{ db: object, docs: object, force?: boolean, dryRun?: boolean,
 *           now?: () => number }} args
 * @returns {Promise<{ results: Array<{ docId: string, action: string, reason: string }>,
 *                     effective: object }>}
 */
async function writeConfigDocs({ db, docs, force = false, dryRun = false, now = Date.now }) {
  const results = [];
  const effective = {};
  for (const [docId, next] of Object.entries(docs)) {
    const ref = db.collection('config').doc(docId);
    const snap = await ref.get();
    const existing = snap.exists ? snap.data() : null;
    const decision = decideConfigWrite({ docId, existing, next, force });
    results.push({ docId, action: decision.action, reason: decision.reason });
    effective[docId] = decision.value;
    if (decision.action === 'skip' || dryRun) continue;
    await ref.set({
      ...decision.value,
      updatedAt: new Date(now()),
      updatedBy: SEED_ACTOR.email,
    });
  }
  return { results, effective };
}

/**
 * Seed one publishable collection: draft write then publish, per document,
 * skipping anything a client has edited.
 *
 * @param {{ db: object, store: object, collection: string, docs: object[],
 *           dryRun?: boolean, now?: () => number, force?: boolean }} args
 * @returns {Promise<{ created: string[], refreshed: string[],
 *                     skipped: Array<{ id: string, reason: string }> }>}
 */
async function seedCollection({ db, store, collection, docs, dryRun = false, now = Date.now, force = false }) {
  const created = [];
  const refreshed = [];
  const skipped = [];
  const toPublish = [];

  const draftCollection = draftCollectionFor(collection);
  for (const doc of docs) {
    const { id, ...fields } = doc;
    // Both revisions: unpublished editor work lives only in the draft, and
    // writeDraft + publishDocs below would overwrite it and then make the
    // placeholder live (§8.4).
    const [snap, draftSnap] = await Promise.all([
      db.collection(collection).doc(id).get(),
      db.collection(draftCollection).doc(id).get(),
    ]);
    const existing = snap.exists ? snap.data() : null;
    const draft = draftSnap.exists ? draftSnap.data() : null;
    const decision = decideSeedWrite(existing, { force, draft });
    if (decision.action === 'skip') {
      skipped.push({ id, reason: decision.reason });
      continue;
    }
    if (decision.action === 'create') created.push(id);
    else refreshed.push(id);
    if (dryRun) continue;
    await store.writeDraft({
      db,
      collection,
      docId: id,
      fields,
      visible: fields.visible !== false,
      actor: SEED_ACTOR,
      now,
    });
    toPublish.push(id);
  }

  if (!dryRun && toPublish.length > 0) {
    // Seeds are published immediately: a fresh deployment whose pages sit
    // unpublished renders an empty site, and the operator's next step
    // (§5.1 step 5) is generating the build snapshot from PUBLISHED docs.
    await store.publishDocs({ db, collection, docIds: toPublish, actor: SEED_ACTOR, now });
  }
  return { created, refreshed, skipped };
}

/**
 * Delete the documents an EARLIER release seeded and this one no longer
 * emits (Codex review of the configured registration action: P1).
 *
 * THE MISSING HALF OF `seedCollection`. That function writes and refreshes;
 * it never deletes, and it only ever looks at the ids it was handed. So
 * dropping a block from the seed changes nothing on a site that already ran
 * init: the old document stays live, stays published, and keeps drawing the
 * control the release removed. Upgrading a deployment has to be able to
 * take something away, not only add to it.
 *
 * SAME OWNERSHIP RULE, SAME FUNCTION. `decideSeedWrite` already answers
 * "may the seed have this document back", reading BOTH revisions because
 * unpublished editor work lives only in the draft (§8.4). Deleting asks
 * exactly that question with more at stake, so it asks it the same way
 * rather than inventing a second test of what counts as seed-owned: a
 * document the seed may not overwrite is a document it may not delete. An
 * editor's own cta at the same id, and a seeded one they have since
 * edited, both stay — including under --force, which relaxes the run-level
 * refusal and never a client edit.
 *
 * Both revisions go together (`store.deleteBoth`). Deleting the live doc
 * alone would leave a draft that republishes the block the moment anybody
 * presses publish.
 *
 * @param {{ db: object, store: object, collection: string, docIds: readonly string[],
 *           dryRun?: boolean }} args
 * @returns {Promise<{ removed: string[], kept: Array<{ id: string, reason: string }> }>}
 */
async function removeObsoleteSeeds({ db, store, collection, docIds, dryRun = false }) {
  const removed = [];
  const kept = [];
  const draftCollection = draftCollectionFor(collection);
  for (const id of docIds) {
    const [snap, draftSnap] = await Promise.all([
      db.collection(collection).doc(id).get(),
      db.collection(draftCollection).doc(id).get(),
    ]);
    const existing = snap.exists ? snap.data() : null;
    const draft = draftSnap.exists ? draftSnap.data() : null;
    // Neither revision exists: a site that never had it, which is every
    // site initialized after the block was dropped. Nothing to report.
    if (existing == null && draft == null) continue;
    const decision = decideSeedWrite(existing, { draft });
    if (decision.action === 'skip') {
      kept.push({ id, reason: decision.reason });
      continue;
    }
    removed.push(id);
    if (dryRun) continue;
    await store.deleteBoth({ db, collection, docId: id });
  }
  return { removed, kept };
}

/**
 * Path-collision preflight for the page seed (Codex review, seed a recap
 * page and a guidelines page: P1).
 *
 * `seedCollection`'s existing-document check only ever looks at
 * `cmsPages/{id}` — it decides purely by DOC ID. A page's route is its
 * `path`, not its id, so that check is blind to the one collision that
 * actually breaks the site: an operator who has moved a live page to a
 * different id but kept the SAME path, or drafted a brand-new page at a
 * path a seeded id also wants. Nothing stops `seedCollection` from writing
 * a second `cmsPages` document at that path, and `getPage`
 * (apps/web/src/contexts/ContentContext.jsx) resolves the collision
 * arbitrarily from then on — whichever of the two documents its snapshot
 * happens to read first.
 *
 * Reads BOTH live and draft `cmsPages`, because a path claimed only in an
 * unpublished draft becomes a live collision the moment that draft
 * publishes, and this preflight is the only chance to catch it before a
 * seed write ever lands. Live ownership wins when a path is claimed in
 * both revisions — that is the route as it actually resolves today.
 *
 * @param {{ db: object, pages: object[] }} args pages carry at least
 *   `{ id, path }` — the DEFAULT_PAGES() shape, or any subset of it.
 * @returns {Promise<Map<string, { path: string, ownerId: string }>>}
 *   keyed by the SEEDED page id that collides; empty when nothing does.
 */
async function findPagePathCollisions({ db, pages }) {
  const [liveSnap, draftSnap] = await Promise.all([
    db.collection('cmsPages').get(),
    db.collection('cmsPages_drafts').get(),
  ]);
  const owners = new Map(); // path -> the doc id that currently owns it
  for (const snap of [liveSnap, draftSnap]) {
    for (const doc of snap.docs) {
      const data = doc.data();
      const docPath = data?.path;
      if (typeof docPath === 'string' && !owners.has(docPath)) {
        owners.set(docPath, doc.id);
      }
    }
  }
  const collisions = new Map();
  for (const page of pages) {
    const ownerId = owners.get(page.path);
    if (ownerId && ownerId !== page.id) {
      collisions.set(page.id, { path: page.path, ownerId });
    }
  }
  return collisions;
}

/**
 * Section-id collision preflight for the page seed (Codex review, seed a
 * city guide page: P2).
 *
 * cmsContent is keyed globally by `${section}__${field}` (seed.cjs), not
 * scoped to a page — a page merely NAMES which section ids belong to it in
 * its own `sections` array. Nothing stops two different pages from naming
 * the same section id, and nothing stops content surviving under a section
 * id whose page was later deleted (deleting a page removes the page
 * document, not the cmsContent filed under its sections). Either way,
 * seeding a page whose section ids already resolve to someone else's
 * content would make that content show up on, and become editable from,
 * the seeded page — a real page take-over, not merely stale data. This is
 * the same class of bug findPagePathCollisions closes for `path`, one
 * level down: a doc id is not the only key a seed can collide on.
 *
 * Two distinct ownership problems, both checked here, per section id:
 *   - a DIFFERENT page (live or draft) already lists this section id among
 *     its own `sections` — the id is doing real work for someone else's
 *     page right now; or
 *   - no page (live or draft) claims this section id at all, but cmsContent
 *     (live or draft) still carries a doc filed under it — content orphaned
 *     by an earlier page deletion, sitting there ownerless until something
 *     reuses the id.
 *
 * Reads all four collections — live and draft cmsPages, live and draft
 * cmsContent — for the same reason findPagePathCollisions does: an
 * unpublished claim on either side becomes a live collision the moment it
 * publishes, and this preflight is the only chance to catch it first.
 *
 * @param {{ db: object, pages: object[] }} args pages carry at least
 *   `{ id, sections: [{ id }] }` — the DEFAULT_PAGES() shape, or any
 *   subset of it.
 * @returns {Promise<Map<string, { sectionId: string, ownerId?: string }>>}
 *   keyed by the SEEDED page id that collides; `ownerId` is present only
 *   for a page-owned collision and absent for an orphaned-content one;
 *   empty when nothing does.
 */
async function findPageSectionCollisions({ db, pages }) {
  const [liveSnap, draftSnap, contentSnap, contentDraftSnap] = await Promise.all([
    db.collection('cmsPages').get(),
    db.collection('cmsPages_drafts').get(),
    db.collection('cmsContent').get(),
    db.collection('cmsContent_drafts').get(),
  ]);

  // section id -> the doc id of the page that currently lists it as one of
  // its own sections, in either revision. First writer (live, then draft)
  // wins the same way findPagePathCollisions' owners map does.
  const sectionOwners = new Map();
  for (const snap of [liveSnap, draftSnap]) {
    for (const doc of snap.docs) {
      const sections = doc.data()?.sections;
      if (!Array.isArray(sections)) continue;
      for (const section of sections) {
        const sectionId = section?.id;
        if (typeof sectionId === 'string' && !sectionOwners.has(sectionId)) {
          sectionOwners.set(sectionId, doc.id);
        }
      }
    }
  }

  // Section ids cmsContent still carries a doc under, in either revision —
  // what makes an ownerless id "orphaned" rather than simply unused.
  const contentSectionIds = new Set();
  for (const snap of [contentSnap, contentDraftSnap]) {
    for (const doc of snap.docs) {
      const sectionId = doc.data()?.section;
      if (typeof sectionId === 'string') contentSectionIds.add(sectionId);
    }
  }

  const collisions = new Map();
  for (const page of pages) {
    const sections = Array.isArray(page.sections) ? page.sections : [];
    for (const section of sections) {
      const sectionId = section?.id;
      if (typeof sectionId !== 'string') continue;
      const ownerId = sectionOwners.get(sectionId);
      if (ownerId && ownerId !== page.id) {
        collisions.set(page.id, { sectionId, ownerId });
        break;
      }
      if (!ownerId && contentSectionIds.has(sectionId)) {
        collisions.set(page.id, { sectionId });
        break;
      }
    }
  }
  return collisions;
}

/**
 * Seed the `email_templates/{id}` overrides (spec §5.1 step f). A flat
 * document write, not the CMS draft/publish path `seedCollection` uses —
 * `email_templates` is a code-default registry with an OPTIONAL override
 * doc (functions/src/email/templates.cjs `loadTemplate`), not a
 * publishable content collection, so there is no draft revision to protect
 * and no publish step to run. The `seeded`-flag idempotency rule is the
 * same one every other seed follows (idempotency.cjs `decideSeedWrite`):
 * unedited, still-seeded docs refresh on re-run; anything a human touched
 * is left alone, even under `--force`.
 *
 * @param {{ db: object, docs: object[], dryRun?: boolean, now?: () => number,
 *           force?: boolean }} args
 * @returns {Promise<{ created: string[], refreshed: string[],
 *                     skipped: Array<{ id: string, reason: string }> }>}
 */
async function seedEmailTemplateOverrides({ db, docs, dryRun = false, now = Date.now, force = false }) {
  const created = [];
  const refreshed = [];
  const skipped = [];
  for (const doc of docs) {
    const { id, ...fields } = doc;
    const ref = db.collection('email_templates').doc(id);
    const snap = await ref.get();
    const existing = snap.exists ? snap.data() : null;
    const decision = decideSeedWrite(existing, { force });
    if (decision.action === 'skip') {
      skipped.push({ id, reason: decision.reason });
      continue;
    }
    if (decision.action === 'create') created.push(id);
    else refreshed.push(id);
    if (dryRun) continue;
    await ref.set({
      ...fields,
      updatedAt: new Date(now()),
      updatedBy: SEED_ACTOR.email,
    });
  }
  return { created, refreshed, skipped };
}

/**
 * Count live `cmsContent` docs still flagged `seeded: true` — the
 * launch-readiness seeded-content row (§5.1.1).
 *
 * @param {{ db: object, collection?: string }} args
 * @returns {Promise<number>}
 */
async function countSeeded({ db, collection = 'cmsContent' }) {
  const snap = await db.collection(collection).where('seeded', '==', true).get();
  return snap.size ?? snap.docs.length;
}

/**
 * Load the config documents a readiness check needs.
 *
 * @param {{ db: object }} args
 * @returns {Promise<{ event: object|null, providers: object|null,
 *                     theme: object|null, bootstrap: object|null,
 *                     features: object|null }>}
 */
async function readConfig({ db }) {
  const ids = ['event', 'providers', 'theme', 'bootstrap', 'features'];
  const snaps = await db.getAll(...ids.map((id) => db.collection('config').doc(id)));
  const out = {};
  ids.forEach((id, i) => {
    out[id] = snaps[i].exists ? snaps[i].data() : null;
  });
  return out;
}

module.exports = {
  writeConfigDocs,
  seedCollection,
  removeObsoleteSeeds,
  findPagePathCollisions,
  findPageSectionCollisions,
  seedEmailTemplateOverrides,
  countSeeded,
  readConfig,
  SEED_ACTOR,
};
