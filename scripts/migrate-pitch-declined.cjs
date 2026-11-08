'use strict';

/**
 * One-time rewrite of pitch declines stored before November 2026 (owner
 * decision, 2026-11-08): `session_pitches.status` `rejected` becomes
 * `declined`, and the decline email record `notices.rejected` moves to
 * `notices.declined`. The code already reads both (shared/pitch
 * pitchStatusOf and pitchNoticesOf), so this only lets that legacy read go.
 *
 * deploy-client.yml runs it after the functions deploy, so the new code is
 * live first. A marker makes it run once. When a pitch already has a
 * `notices.declined` record, the newer record wins and the old one is left
 * as it is, so no delivery history is lost. Review revisions are not bumped:
 * the decision is the same, only its spelling changes.
 */

const MARKER = ['data_migrations', 'pitch-declined-2026-11-08'];

async function eachDocument(collection, visit) {
  let cursor;
  for (;;) {
    let query = collection.orderBy('__name__').limit(200);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    for (const doc of page.docs) await visit(doc);
    if (page.size < 200) return;
    cursor = page.docs.at(-1);
  }
}

async function migratePitchDeclined({ db }) {
  const marker = db.collection(MARKER[0]).doc(MARKER[1]);
  if ((await marker.get()).data()?.complete === true) return { skipped: true };
  const totals = { statusRewritten: 0, noticeMoved: 0, noticeKept: 0 };
  await eachDocument(db.collection('session_pitches'), async (doc) => {
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(doc.ref);
      const pitch = snap.data();
      if (!pitch) return null;
      const patch = {};
      const outcome = { status: false, moved: false, kept: false };
      if (pitch.status === 'rejected') {
        patch.status = 'declined';
        outcome.status = true;
      }
      const notices = pitch.notices && typeof pitch.notices === 'object' ? pitch.notices : null;
      if (notices && Object.hasOwn(notices, 'rejected')) {
        if (Object.hasOwn(notices, 'declined')) {
          outcome.kept = true;
        } else {
          const { rejected, ...rest } = notices;
          patch.notices = { ...rest, declined: rejected };
          outcome.moved = true;
        }
      }
      if (Object.keys(patch).length) tx.update(doc.ref, patch);
      return outcome;
    });
    if (!result) return;
    if (result.status) totals.statusRewritten += 1;
    if (result.moved) totals.noticeMoved += 1;
    if (result.kept) totals.noticeKept += 1;
  });
  await marker.set({ complete: true, totals, completedAt: new Date() });
  return totals;
}

if (require.main === module) {
  const { initializeApp } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const projectId = process.env.EVENT_FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error('EVENT_FIREBASE_PROJECT_ID is required');
  initializeApp({ projectId });
  migratePitchDeclined({ db: getFirestore() })
    .then((totals) => console.log(JSON.stringify(totals)))
    .catch(() => { console.error('Pitch decline rewrite failed; retry this deployment.'); process.exitCode = 1; });
}
module.exports = { migratePitchDeclined };
