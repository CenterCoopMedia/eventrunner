'use strict';

// A redeemed operator link is the only evidence that can backfill a paid
// draft. Never infer payment from ownership, answers, or an email address.
// Every draft made since has its link, so a marker makes it run once; without
// it each console deploy rewrote every quarantined draft again.
const MARKER = ['data_migrations', 'console-signup-links-2026-11-06'];

async function migrateDrafts({ db, now = () => new Date() }) {
  const marker = db.collection(MARKER[0]).doc(MARKER[1]);
  if ((await marker.get()).data()?.complete === true) return { skipped: true };
  const drafts = db.collection('applications').where('status', '==', 'draft');
  let cursor;
  const totals = { linked: 0, quarantined: 0 };
  for (;;) {
    let query = drafts.orderBy('__name__').limit(200);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    for (const doc of page.docs) {
      const result = await db.runTransaction(async (tx) => {
        const snap = await tx.get(doc.ref);
        const app = snap.data();
        if (!snap.exists || app.status !== 'draft' || app.signupLinkId) return null;
        const links = await tx.get(db.collection('signup_links').where('appId', '==', doc.id).limit(2));
        const matching = links.docs.filter((link) => {
          const data = link.data();
          return data.status === 'used' && data.orgId === app.orgId && data.usedBy === app.createdBy;
        });
        if (links.size === 1 && matching.length === 1) {
          tx.update(doc.ref, { signupLinkId: matching[0].id, legacyQuarantined: false });
          return 'linked';
        }
        tx.update(doc.ref, { legacyQuarantined: true, quarantinedAt: now() });
        return 'quarantined';
      });
      if (result) totals[result] += 1;
    }
    if (page.size < 200) break;
    cursor = page.docs.at(-1);
  }
  await marker.set({ complete: true, totals, completedAt: new Date() });
  return totals;
}

if (require.main === module) {
  const { initializeApp } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const projectId = process.env.CONSOLE_PROJECT_ID;
  if (!projectId) throw new Error('CONSOLE_PROJECT_ID is required');
  initializeApp({ projectId });
  migrateDrafts({ db: getFirestore() }).then((totals) => console.log(JSON.stringify(totals)))
    .catch(() => { console.error('Signup provenance migration failed. Deployment stopped.'); process.exitCode = 1; });
}
module.exports = { migrateDrafts };
