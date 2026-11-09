'use strict';

/**
 * One-time correction of ticket dates (audit 2026-11-09, 01 #1). Before the
 * fix, the CSV ticket import stored `tickets/{id}.createdAt` and `updatedAt`
 * as epoch-millisecond numbers. Firestore orders numbers before timestamps,
 * and the manual provider's page cursor needs a date, so those rows sorted
 * apart and stopped a full sync after its first page.
 *
 * Each numeric value becomes a Date (stored as a Timestamp) for the same
 * instant. Every other field, and any value that is not a number, is left as
 * it is. deploy-client.yml runs it after the functions deploy, so the fixed
 * import is live first. A marker makes it run once; `--dry-run` counts and
 * writes nothing. The log shows only counts.
 *
 *   EVENT_FIREBASE_PROJECT_ID=... node scripts/migrate-ticket-dates.cjs [--dry-run]
 */

const MARKER = ['data_migrations', 'ticket-dates-2026-11-09'];
const FIELDS = ['createdAt', 'updatedAt'];

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

/** The fields of one ticket that hold a number for a real instant. */
function numericFields(ticket) {
  return FIELDS.filter((field) => typeof ticket?.[field] === 'number'
    && Number.isFinite(new Date(ticket[field]).getTime()));
}

async function migrateTicketDates({ db, dryRun = false }) {
  const marker = db.collection(MARKER[0]).doc(MARKER[1]);
  if ((await marker.get()).data()?.complete === true) return { skipped: true };
  const totals = { ticketsRewritten: 0, createdAtRewritten: 0, updatedAtRewritten: 0 };
  const count = (fields) => {
    if (!fields.length) return;
    totals.ticketsRewritten += 1;
    for (const field of fields) totals[`${field}Rewritten`] += 1;
  };
  await eachDocument(db.collection('tickets'), async (doc) => {
    // Most tickets are fine; only those read as numeric open a transaction.
    if (!numericFields(doc.data()).length) return;
    if (dryRun) {
      count(numericFields(doc.data()));
      return;
    }
    const fields = await db.runTransaction(async (tx) => {
      const snap = await tx.get(doc.ref);
      const found = numericFields(snap.data());
      if (found.length) tx.update(doc.ref, Object.fromEntries(found.map((field) => [field, new Date(snap.data()[field])])));
      return found;
    });
    count(fields);
  });
  if (dryRun) return { ...totals, dryRun: true };
  await marker.set({ complete: true, totals, completedAt: new Date() });
  return totals;
}

if (require.main === module) {
  const { initializeApp } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const projectId = process.env.EVENT_FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error('EVENT_FIREBASE_PROJECT_ID is required');
  initializeApp({ projectId });
  migrateTicketDates({ db: getFirestore(), dryRun: process.argv.includes('--dry-run') })
    .then((totals) => console.log(JSON.stringify(totals)))
    .catch(() => { console.error('Ticket date correction failed; retry this deployment.'); process.exitCode = 1; });
}
module.exports = { migrateTicketDates };
