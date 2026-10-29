'use strict';
const { createHash } = require('node:crypto');

// A separate self-service budget leaves the provider's remaining quota
// available to webhooks and reconciliation. Shared Firestore transactions
// enforce both limits across instances and cold starts.
async function acquireLookupBudget({ db, uid, now = () => new Date() }) {
  const key = createHash('sha256').update(uid).digest('hex');
  const specs = [
    { id: 'user-' + key, window: 60000, limit: 5 },
    { id: 'global', window: 3600000, limit: 100 },
  ];
  return db.runTransaction(async (tx) => {
    const refs = specs.map((s) => db.collection('ticketLookupBudgets').doc(s.id));
    const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));
    // Sample after reads on every retry so an older request cannot rewind a window.
    const nowMs = now().getTime();
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error('Invalid ticket lookup budget clock.');
    const states = specs.map((s, i) => {
      const currentStart = Math.floor(nowMs / s.window) * s.window;
      if (!snaps[i].exists) return { start: currentStart, count: 0 };
      const stored = snaps[i].data();
      const hasValidWindow = Number.isSafeInteger(stored?.start) && stored.start >= 0 && stored.start % s.window === 0;
      const hasValidCount = Number.isSafeInteger(stored?.count) && stored.count >= 0;
      if (!hasValidWindow || !hasValidCount) throw new Error('Invalid ticket lookup budget state.');
      // Another instance's clock may already have advanced this bucket.
      const start = Math.max(currentStart, stored.start);
      return { start, count: stored.start === start ? stored.count : 0 };
    });
    const retryAfter = specs.reduce((wait, s, i) => states[i].count >= s.limit
      ? Math.max(wait, Math.ceil((states[i].start + s.window - nowMs) / 1000)) : wait, 0);
    if (retryAfter) return { allowed: false, retryAfter };
    refs.forEach((ref, i) => tx.set(ref, { start: states[i].start, count: states[i].count + 1 }));
    return { allowed: true };
  });
}
module.exports = { acquireLookupBudget };
