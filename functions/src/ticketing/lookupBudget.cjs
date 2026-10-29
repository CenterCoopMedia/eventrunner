'use strict';
const { createHash } = require('node:crypto');

// A separate self-service budget leaves the provider's remaining quota
// available to webhooks and reconciliation. Shared Firestore transactions
// enforce both limits across instances and cold starts.
async function acquireLookupBudget({ db, uid, now = () => new Date() }) {
  const at = now().getTime();
  const key = createHash('sha256').update(uid).digest('hex');
  const specs = [
    { id: 'user-' + key, window: 60000, limit: 5 },
    { id: 'global', window: 3600000, limit: 100 },
  ];
  return db.runTransaction(async (tx) => {
    const refs = specs.map((s) => db.collection('ticketLookupBudgets').doc(s.id));
    const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));
    const states = specs.map((s, i) => {
      const data = snaps[i].exists ? snaps[i].data() : {};
      const start = Math.floor(at / s.window) * s.window;
      return { start, count: data.start === start ? Number(data.count) || 0 : 0 };
    });
    const retry = specs.reduce((wait, s, i) => states[i].count >= s.limit
      ? Math.max(wait, Math.ceil((states[i].start + s.window - at) / 1000)) : wait, 0);
    if (retry) return { allowed: false, retryAfter: retry };
    refs.forEach((ref, i) => tx.set(ref, { start: states[i].start, count: states[i].count + 1 }));
    return { allowed: true };
  });
}
module.exports = { acquireLookupBudget };
