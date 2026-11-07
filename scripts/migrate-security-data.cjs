'use strict';

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

async function migrateSecurityData({ db, bucket }) {
  const marker = db.collection('security_migrations').doc('2026-11-06');
  if ((await marker.get()).data()?.complete === true) return { skipped: true };
  const totals = { publicActorRemoved: 0, orphanLogisticsRemoved: 0, orphanSharesRemoved: 0, photoMetadataCleaned: 0, checkoutConsentRemoved: 0, inheritedVisibilityReset: 0 };
  const formRef = db.collection('config').doc('registration_form');
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(formRef);
    if (!snap.exists || !Object.hasOwn(snap.data(), 'updatedBy')) return;
    const { updatedBy: _actor, ...publicForm } = snap.data();
    tx.set(formRef, publicForm);
    totals.publicActorRemoved = 1;
  });
  for (const [projection, canonical, counter] of [
    ['speaker_logistics', 'speakers', 'orphanLogisticsRemoved'],
    ['schedule_shares', 'users', 'orphanSharesRemoved'],
  ]) {
    await eachDocument(db.collection(projection), async (doc) => {
      const removed = await db.runTransaction(async (tx) => {
        const parent = await tx.get(db.collection(canonical).doc(doc.id));
        if (parent.exists) return false;
        tx.delete(doc.ref);
        return true;
      });
      if (removed) totals[counter] += 1;
    });
  }
  await eachDocument(db.collection('ticket_answers').where('updatedBy', '==', 'checkout'), async (doc) => {
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(doc.ref);
      const record = snap.data();
      if (!record || record.updatedBy !== 'checkout' || !record.answers
          || !['directoryListing', 'photoConsent'].some((key) => Object.hasOwn(record.answers, key))) return null;
      const userRef = typeof record.uid === 'string' && record.uid ? db.collection('users').doc(record.uid) : null;
      const user = userRef ? await tx.get(userRef) : null;
      const { directoryListing: inherited, photoConsent: _consent, ...answers } = record.answers;
      const questions = (record.questions || []).filter((question) => !['directoryListing', 'photoConsent'].includes(question.id));
      const reset = user?.exists && inherited === 'public' && user.data().profileVisibility === 'public';
      tx.set(doc.ref, { ...record, answers, questions });
      // These records still attribute consent to checkout, not the holder.
      // Narrow visibility until the holder explicitly chooses it again.
      if (reset) tx.update(userRef, { profileVisibility: 'private', updatedAt: new Date() });
      return { reset };
    });
    if (result) {
      totals.checkoutConsentRemoved += 1;
      if (result.reset) totals.inheritedVisibilityReset += 1;
    }
  });
  let pageToken;
  do {
    const [files, next] = await bucket.getFiles({ prefix: 'speaker-photos/', autoPaginate: false, maxResults: 200, ...(pageToken ? { pageToken } : {}) });
    for (const file of files) {
      const [meta] = await file.getMetadata();
      if (!meta.metadata?.uploadedBy && !meta.metadata?.uploadedByUid) continue;
      await file.setMetadata({ metadata: { uploadedBy: null, uploadedByUid: null } }, { ifMetagenerationMatch: meta.metageneration });
      totals.photoMetadataCleaned += 1;
    }
    pageToken = next?.pageToken;
  } while (pageToken);
  await marker.set({ complete: true, totals, completedAt: new Date() });
  return totals;
}

if (require.main === module) {
  const { initializeApp } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const { getStorage } = require('firebase-admin/storage');
  const projectId = process.env.EVENT_FIREBASE_PROJECT_ID;
  const storageBucket = process.env.EVENT_STORAGE_BUCKET;
  if (!projectId || !storageBucket) throw new Error('EVENT_FIREBASE_PROJECT_ID and EVENT_STORAGE_BUCKET are required');
  initializeApp({ projectId, storageBucket });
  migrateSecurityData({ db: getFirestore(), bucket: getStorage().bucket() })
    .then((totals) => console.log(JSON.stringify(totals)))
    .catch(() => { console.error('Security data migration failed; retry this deployment.'); process.exitCode = 1; });
}
module.exports = { migrateSecurityData };
