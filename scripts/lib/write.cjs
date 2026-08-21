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

/** Actor recorded on seeded writes; not a person, and deliberately visible. */
const SEED_ACTOR = Object.freeze({ uid: 'init-event-script', email: 'init-event-script' });

/**
 * Write the `config/*` documents (§5.1 steps b–c).
 *
 * @param {{ db: object, docs: object, force?: boolean, dryRun?: boolean,
 *           now?: () => number }} args
 * @returns {Promise<Array<{ docId: string, action: string, reason: string }>>}
 */
async function writeConfigDocs({ db, docs, force = false, dryRun = false, now = Date.now }) {
  const results = [];
  for (const [docId, next] of Object.entries(docs)) {
    const ref = db.collection('config').doc(docId);
    const snap = await ref.get();
    const existing = snap.exists ? snap.data() : null;
    const decision = decideConfigWrite({ docId, existing, next, force });
    results.push({ docId, action: decision.action, reason: decision.reason });
    if (decision.action === 'skip' || dryRun) continue;
    await ref.set({
      ...decision.value,
      updatedAt: new Date(now()),
      updatedBy: SEED_ACTOR.email,
    });
  }
  return results;
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

  for (const doc of docs) {
    const { id, ...fields } = doc;
    const snap = await db.collection(collection).doc(id).get();
    const existing = snap.exists ? snap.data() : null;
    const decision = decideSeedWrite(existing, { force });
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
 *                     theme: object|null, bootstrap: object|null }>}
 */
async function readConfig({ db }) {
  const ids = ['event', 'providers', 'theme', 'bootstrap'];
  const snaps = await db.getAll(...ids.map((id) => db.collection('config').doc(id)));
  const out = {};
  ids.forEach((id, i) => {
    out[id] = snaps[i].exists ? snaps[i].data() : null;
  });
  return out;
}

module.exports = { writeConfigDocs, seedCollection, countSeeded, readConfig, SEED_ACTOR };
