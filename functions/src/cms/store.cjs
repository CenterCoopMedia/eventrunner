'use strict';

/**
 * Shared draft-write and publish primitives for the two-revision CMS
 * (spec §8.4). content.cjs, publish.cjs, and the other builders'
 * pages.cjs/updates.cjs all go through these so the invariants live in
 * exactly one place:
 *
 *   - Editing writes DRAFTS ONLY. writeDraft never touches `C/{docId}`;
 *     the only functions that write a live collection are publishDocs,
 *     unpublishDoc (explicit visible:false), and deleteBoth.
 *   - Publish is an atomic per-doc batch: live copy at revision+1, draft
 *     marked clean with basedOnRevision, cmsVersionHistory append — all
 *     three writes commit together or not at all.
 *   - A multi-doc publish chunks at 400 writes per batch (3 writes/doc →
 *     133 docs/chunk) and records each committed chunk on its
 *     cmsPublishQueue row, so a partial publish is resumable and
 *     observable rather than silently half-applied.
 *
 * Every function takes an injected db/clock — no firebase-admin import.
 * Collection names are validated through draftCollectionFor, so a typo is
 * a thrown error, not a silent write to an unprotected collection.
 */

const { draftCollectionFor } = require('./blockTypes.cjs');

const MAX_WRITES_PER_BATCH = 400;
const WRITES_PER_DOC = 3; // live set + draft update + version-history append
const DOCS_PER_CHUNK = Math.floor(MAX_WRITES_PER_BATCH / WRITES_PER_DOC);

/**
 * Bookkeeping keys owned by the publish model itself. They are stripped
 * from caller-supplied field maps and from draft docs when copying, so a
 * draft can never smuggle a fake `revision` or `publishedBy` onto the
 * live doc.
 */
const RESERVED_FIELDS = Object.freeze([
  'visible',
  'status',
  'revision',
  'basedOnRevision',
  'updatedAt',
  'updatedBy',
  'publishedAt',
  'publishedBy',
]);

const MAX_DOC_ID_LENGTH = 300;

/**
 * Usable as a single Firestore doc-path segment. The real SDK throws
 * synchronously on '' and on slash-containing ids (odd-segment paths), and
 * a 4-segment id would silently address a subcollection doc — so every
 * handler validates ids with this before calling `.doc()`.
 *
 * @param {unknown} id
 * @returns {boolean}
 */
function isValidDocId(id) {
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= MAX_DOC_ID_LENGTH &&
    !id.includes('/') &&
    id !== '.' &&
    id !== '..'
  );
}

/** @param {object} data @returns {object} data minus RESERVED_FIELDS */
function contentFieldsOf(data) {
  const out = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (!RESERVED_FIELDS.includes(k)) out[k] = v;
  }
  return out;
}

/**
 * Write (create or replace) a draft. DRAFTS ONLY — the live doc is read
 * for `basedOnRevision` when the draft does not exist yet (editing an
 * already-published doc forks a draft from it), but never written.
 *
 * @param {{ db: FirebaseFirestore.Firestore, collection: string,
 *           docId: string, fields: object, visible?: boolean,
 *           actor: { uid: string, email: string }, now?: () => number }} args
 * @returns {Promise<{ docPath: string, existed: boolean }>}
 */
async function writeDraft({ db, collection, docId, fields, visible, actor, now = Date.now }) {
  const draftCol = draftCollectionFor(collection);
  const ref = db.collection(draftCol).doc(docId);
  const draftSnap = await ref.get();

  let basedOnRevision = null;
  let priorVisible = true;
  if (draftSnap.exists) {
    const prior = draftSnap.data();
    basedOnRevision = typeof prior.basedOnRevision === 'number' ? prior.basedOnRevision : null;
    priorVisible = prior.visible !== false;
  } else {
    const liveSnap = await db.collection(collection).doc(docId).get();
    if (liveSnap.exists) {
      const live = liveSnap.data();
      basedOnRevision = typeof live.revision === 'number' ? live.revision : null;
      priorVisible = live.visible !== false;
    }
  }

  await ref.set({
    ...contentFieldsOf(fields),
    visible: typeof visible === 'boolean' ? visible : priorVisible,
    status: 'dirty',
    basedOnRevision,
    updatedAt: new Date(now()),
    updatedBy: actor.email,
  });
  return { docPath: `${draftCol}/${docId}`, existed: draftSnap.exists };
}

/**
 * Delete the live doc and its draft in ONE batch (spec §8.4 step 4) —
 * never one without the other. cmsVersionHistory rows are deliberately
 * kept (audit trail); a later recreation of the same docId publishes above
 * the historical max revision (see publishDocs), never back at 1.
 *
 * @param {{ db: FirebaseFirestore.Firestore, collection: string, docId: string }} args
 * @returns {Promise<{ livePath: string, draftPath: string }>}
 */
async function deleteBoth({ db, collection, docId }) {
  const draftCol = draftCollectionFor(collection);
  const batch = db.batch();
  batch.delete(db.collection(collection).doc(docId));
  batch.delete(db.collection(draftCol).doc(docId));
  await batch.commit();
  return { livePath: `${collection}/${docId}`, draftPath: `${draftCol}/${docId}` };
}

/**
 * Unpublish: an EXPLICIT admin action that sets the live doc's
 * `visible: false`. Never a side effect of editing, never touches the
 * draft, never deletes (delete is deleteBoth).
 *
 * @param {{ db: FirebaseFirestore.Firestore, collection: string, docId: string }} args
 * @returns {Promise<{ ok: true, docPath: string } | { ok: false, reason: 'not-published' }>}
 */
async function unpublishDoc({ db, collection, docId }) {
  draftCollectionFor(collection); // validate; throws on non-publishable names
  const ref = db.collection(collection).doc(docId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, reason: 'not-published' };
  await ref.update({ visible: false });
  return { ok: true, docPath: `${collection}/${docId}` };
}

/**
 * Ids of every dirty draft in a collection — the admin CMS's "list
 * everything unpublished" query, and the doc set `{ all: true }` publishes.
 *
 * @param {{ db: FirebaseFirestore.Firestore, collection: string }} args
 * @returns {Promise<string[]>}
 */
async function listDirty({ db, collection }) {
  const draftCol = draftCollectionFor(collection);
  const snap = await db.collection(draftCol).where('status', '==', 'dirty').get();
  return snap.docs.map((d) => d.id);
}

/**
 * Highest revision ever recorded for a docPath in cmsVersionHistory, or 0.
 * Uses the same (docPath ==, revision desc) composite index the history
 * endpoint declares in firestore.indexes.json.
 *
 * @param {{ db: FirebaseFirestore.Firestore, docPath: string }} args
 * @returns {Promise<number>}
 */
async function maxHistoryRevision({ db, docPath }) {
  const snap = await db
    .collection('cmsVersionHistory')
    .where('docPath', '==', docPath)
    .orderBy('revision', 'desc')
    .limit(1)
    .get();
  if (snap.empty) return 0;
  const rev = snap.docs[0].data()?.revision;
  return typeof rev === 'number' ? rev : 0;
}

/**
 * Publish drafts to the live collection (spec §8.4 step 3).
 *
 * Per doc, one atomic batch carries: live copy of the draft's content
 * fields with `revision = live.revision + 1` (+ visible, publishedAt,
 * publishedBy); draft update to `status: 'clean'` with the new
 * basedOnRevision; a cmsVersionHistory append. Chunked at DOCS_PER_CHUNK
 * docs so no batch exceeds 400 writes.
 *
 * When `queueRef` (a cmsPublishQueue doc ref) is given, each committed
 * chunk is recorded under `progress.<collection>` before the next chunk
 * starts, and docIds already listed there are skipped on entry — so
 * re-running after a mid-way failure completes the remainder without
 * double-bumping revisions.
 *
 * Throws on a failed chunk commit; everything committed so far stays
 * committed and recorded. DocIds without a draft are reported in
 * `skipped`, never guessed at.
 *
 * @param {{ db: FirebaseFirestore.Firestore, collection: string,
 *           docIds: string[], actor: { uid: string, email: string },
 *           now?: () => number, queueRef?: FirebaseFirestore.DocumentReference }} args
 * @returns {Promise<{ published: string[], skipped: Array<{docId: string, reason: string}>,
 *                     chunksCommitted: number }>}
 */
async function publishDocs({ db, collection, docIds, actor, now = Date.now, queueRef }) {
  const draftCol = draftCollectionFor(collection);

  let alreadyPublished = [];
  if (queueRef) {
    const queueSnap = await queueRef.get();
    const recorded = queueSnap.exists ? queueSnap.data()?.progress?.[collection]?.published : null;
    if (Array.isArray(recorded)) alreadyPublished = recorded;
  }

  const published = [...alreadyPublished];
  const pending = [...new Set(docIds)].filter((id) => !alreadyPublished.includes(id));
  const skipped = [];
  let chunksCommitted = 0;

  for (let i = 0; i < pending.length; i += DOCS_PER_CHUNK) {
    const chunkIds = pending.slice(i, i + DOCS_PER_CHUNK);
    const draftRefs = chunkIds.map((id) => db.collection(draftCol).doc(id));
    const liveRefs = chunkIds.map((id) => db.collection(collection).doc(id));
    const draftSnaps = await db.getAll(...draftRefs);
    const liveSnaps = await db.getAll(...liveRefs);

    const batch = db.batch();
    const chunkPublished = [];
    const publishedAt = new Date(now());
    for (let j = 0; j < chunkIds.length; j += 1) {
      const docId = chunkIds[j];
      if (!draftSnaps[j].exists) {
        skipped.push({ docId, reason: 'no-draft' });
        continue;
      }
      const draft = draftSnaps[j].data();
      const live = liveSnaps[j].exists ? liveSnaps[j].data() : null;
      // No live doc means first publish OR a recreation after deleteBoth
      // (whose cmsVersionHistory rows survive as the audit trail). Resume
      // from the historical max so revisions stay unique per docPath — the
      // invariant versions.cjs's cursor pagination depends on.
      const baseRevision = typeof live?.revision === 'number'
        ? live.revision
        : await maxHistoryRevision({ db, docPath: `${collection}/${docId}` });
      const revision = baseRevision + 1;
      const contentFields = contentFieldsOf(draft);
      const visible = draft.visible !== false;

      batch.set(liveRefs[j], {
        ...contentFields,
        visible,
        revision,
        publishedAt,
        publishedBy: actor.email,
      });
      batch.update(draftRefs[j], { status: 'clean', basedOnRevision: revision });
      batch.set(db.collection('cmsVersionHistory').doc(), {
        docPath: `${collection}/${docId}`,
        revision,
        fields: contentFields,
        visible,
        publishedAt,
        publishedBy: actor.email,
      });
      chunkPublished.push(docId);
    }

    if (chunkPublished.length > 0) await batch.commit();
    published.push(...chunkPublished);
    chunksCommitted += 1;
    if (queueRef) {
      // Recorded AFTER the chunk commits: the row never claims more than
      // Firestore holds, so a resume can trust it.
      await queueRef.set(
        {
          progress: { [collection]: { published, skipped, chunksCommitted } },
          updatedAt: new Date(now()),
        },
        { merge: true },
      );
    }
  }

  return { published, skipped, chunksCommitted };
}

/**
 * Best-effort admin action audit (fixed contract): every admin mutation
 * writes an admin_logs entry, and a failed audit write NEVER fails the
 * mutation it describes.
 *
 * @param {{ db: FirebaseFirestore.Firestore, action: string, docPath: string,
 *           actor: { uid: string, email: string }, now?: () => number,
 *           log?: Pick<Console, 'warn'> }} args
 */
async function logAdminAction({ db, action, docPath, actor, now = Date.now, log = console }) {
  try {
    await db.collection('admin_logs').doc().set({
      action,
      docPath,
      uid: actor.uid,
      email: actor.email,
      at: new Date(now()),
    });
  } catch (err) {
    log.warn('admin_logs write failed', err);
  }
}

module.exports = {
  writeDraft,
  deleteBoth,
  unpublishDoc,
  listDirty,
  publishDocs,
  logAdminAction,
  contentFieldsOf,
  isValidDocId,
  internals: {
    MAX_WRITES_PER_BATCH,
    WRITES_PER_DOC,
    DOCS_PER_CHUNK,
    RESERVED_FIELDS,
    MAX_DOC_ID_LENGTH,
    maxHistoryRevision,
  },
};
