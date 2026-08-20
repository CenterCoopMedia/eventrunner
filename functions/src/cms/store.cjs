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
 * With `createOnly` the write uses the Firestore create() precondition, so
 * two concurrent creates cannot both win: the loser gets an ALREADY_EXISTS
 * rejection (see isAlreadyExistsError) instead of silently clobbering the
 * first writer's draft. An existing draft is refused before writing.
 *
 * @param {{ db: FirebaseFirestore.Firestore, collection: string,
 *           docId: string, fields: object, visible?: boolean,
 *           actor: { uid: string, email: string }, now?: () => number,
 *           createOnly?: boolean }} args
 * @returns {Promise<{ docPath: string, existed: boolean }>}
 */
async function writeDraft({ db, collection, docId, fields, visible, actor, now = Date.now, createOnly = false }) {
  const draftCol = draftCollectionFor(collection);
  const ref = db.collection(draftCol).doc(docId);
  const draftSnap = await ref.get();
  if (createOnly && draftSnap.exists) {
    throw new Error(`ALREADY_EXISTS: document ${draftCol}/${docId} already exists`);
  }

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

  const payload = {
    ...contentFieldsOf(fields),
    visible: typeof visible === 'boolean' ? visible : priorVisible,
    status: 'dirty',
    basedOnRevision,
    updatedAt: new Date(now()),
    updatedBy: actor.email,
  };
  if (createOnly) {
    await ref.create(payload);
  } else {
    await ref.set(payload);
  }
  return { docPath: `${draftCol}/${docId}`, existed: draftSnap.exists };
}

/** True for a Firestore ALREADY_EXISTS rejection (gRPC code 6). */
function isAlreadyExistsError(err) {
  return err?.code === 6 || /ALREADY[-_ ]?EXISTS/i.test(String(err?.message || ''));
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

/** How often one chunk retries after losing a draft-update precondition. */
const MAX_CHUNK_ATTEMPTS = 5;

/** True for a FAILED_PRECONDITION / NOT_FOUND batch rejection (gRPC 9 / 5). */
function isPreconditionFailure(err) {
  if (err?.code === 9 || err?.code === 5) return true;
  return /FAILED_PRECONDITION|NOT_FOUND/i.test(String(err?.message || ''));
}

/** Firestore Timestamp-or-fake equality for snapshot updateTimes. */
function sameUpdateTime(a, b) {
  if (a == null || b == null) return false;
  return typeof a.isEqual === 'function' ? a.isEqual(b) : a === b;
}

/**
 * Publish drafts to the live collection (spec §8.4 step 3).
 *
 * Per doc, one atomic batch carries: live copy of the draft's content
 * fields with `revision = live.revision + 1` (+ visible, publishedAt,
 * publishedBy — the actor's UID; the email stays on the admin-only
 * cmsVersionHistory row, never on an anonymously readable live doc); a
 * draft update to `status: 'clean'` with the new basedOnRevision; a
 * cmsVersionHistory append. Chunked at DOCS_PER_CHUNK docs so no batch
 * exceeds 400 writes.
 *
 * The draft update carries a { lastUpdateTime } precondition from the read
 * snapshot: an editor save landing between the read and the commit fails
 * the chunk, which retries and reports the changed doc as
 * `skipped: { reason: 'conflict' }` — its draft stays dirty with the NEW
 * content instead of being marked clean under a stale publish, so
 * `{ all: true }` still finds it.
 *
 * When `queueRef` (a cmsPublishQueue doc ref) is given, the
 * `progress.<collection>` record is written IN the same batch as the
 * chunk's doc writes — the row and the data can never disagree, so a
 * resume can trust it (docIds already listed are skipped on entry, and a
 * re-run after a mid-way failure completes the remainder without
 * double-bumping revisions).
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
    let chunkIds = pending.slice(i, i + DOCS_PER_CHUNK);
    // docId → the draft updateTime the last failed attempt was built on; a
    // re-read that differs identifies the doc that lost its precondition.
    const prevTimes = new Map();

    for (let attempt = 1; ; attempt += 1) {
      const draftRefs = chunkIds.map((id) => db.collection(draftCol).doc(id));
      const liveRefs = chunkIds.map((id) => db.collection(collection).doc(id));
      const draftSnaps = await db.getAll(...draftRefs);
      const liveSnaps = await db.getAll(...liveRefs);

      const batch = db.batch();
      const chunkPublished = [];
      const keptIds = [];
      const publishedAt = new Date(now());
      for (let j = 0; j < chunkIds.length; j += 1) {
        const docId = chunkIds[j];
        if (!draftSnaps[j].exists) {
          skipped.push({ docId, reason: 'no-draft' });
          continue;
        }
        if (prevTimes.has(docId) && !sameUpdateTime(prevTimes.get(docId), draftSnaps[j].updateTime)) {
          // An editor saved between our earlier read and its failed commit.
          // Leave the newer draft dirty rather than publishing content the
          // editor never saw; the next publish picks it up.
          skipped.push({ docId, reason: 'conflict' });
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
          publishedBy: actor.uid,
        });
        batch.update(
          draftRefs[j],
          { status: 'clean', basedOnRevision: revision },
          // Fails the batch if the draft changed since draftSnaps[j] was
          // read — the guard that makes "marked clean" mean "this exact
          // content went live".
          { lastUpdateTime: draftSnaps[j].updateTime },
        );
        batch.set(db.collection('cmsVersionHistory').doc(), {
          docPath: `${collection}/${docId}`,
          revision,
          fields: contentFields,
          visible,
          publishedAt,
          publishedBy: actor.email,
          publishedByUid: actor.uid,
        });
        keptIds.push(docId);
        chunkPublished.push(docId);
      }

      if (queueRef) {
        // Progress rides in the SAME batch as the doc writes: a resume can
        // never see committed docs missing from the row (double-bump) or
        // recorded docs that never committed.
        batch.set(
          queueRef,
          {
            progress: {
              [collection]: {
                published: [...published, ...chunkPublished],
                skipped,
                chunksCommitted: chunksCommitted + 1,
              },
            },
            updatedAt: new Date(now()),
          },
          { merge: true },
        );
      }

      try {
        if (chunkPublished.length > 0 || queueRef) await batch.commit();
        published.push(...chunkPublished);
        chunksCommitted += 1;
        break;
      } catch (err) {
        if (attempt >= MAX_CHUNK_ATTEMPTS || !isPreconditionFailure(err)) throw err;
        // A draft moved under us (or was deleted). Remember what we read,
        // re-read, and retry with only the docs we actually attempted —
        // the changed ones classify as conflict/no-draft next pass.
        prevTimes.clear();
        for (let j = 0; j < chunkIds.length; j += 1) {
          if (draftSnaps[j].exists) prevTimes.set(chunkIds[j], draftSnaps[j].updateTime);
        }
        chunkIds = keptIds;
      }
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
  isAlreadyExistsError,
  internals: {
    MAX_WRITES_PER_BATCH,
    WRITES_PER_DOC,
    DOCS_PER_CHUNK,
    RESERVED_FIELDS,
    MAX_DOC_ID_LENGTH,
    MAX_CHUNK_ATTEMPTS,
    maxHistoryRevision,
    isPreconditionFailure,
    sameUpdateTime,
  },
};
