'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  takeRateLimitSlot,
  createChallenge,
  verifyChallenge,
  finalizeChallenge,
  releaseChallenge,
  sweepExpired,
  normalizeEmail,
  emailHash,
  hashCode,
  internals,
} = require('./challenges.cjs');

/** Minimal in-memory Firestore fake with transactions and range queries. */
function fakeDb() {
  const store = new Map(); // "collection/id" -> data
  const key = (c, id) => `${c}/${id}`;
  const docRef = (c, id) => ({
    __c: c,
    __id: id,
    async set(data) { store.set(key(c, id), data); },
    async delete() { store.delete(key(c, id)); },
  });
  return {
    store,
    collection: (c) => ({
      doc: (id) => docRef(c, id),
      where: (field, op, value) => ({
        limit: (n) => ({
          async get() {
            const docs = [];
            for (const [k, data] of store) {
              if (!k.startsWith(`${c}/`)) continue;
              const fieldValue = data[field];
              const ms = fieldValue instanceof Date ? fieldValue.getTime() : NaN;
              const boundMs = value instanceof Date ? value.getTime() : NaN;
              if (op === '<' && ms < boundMs) {
                docs.push({ ref: docRef(c, k.slice(c.length + 1)) });
                if (docs.length >= n) break;
              }
            }
            return { docs, empty: docs.length === 0 };
          },
        }),
      }),
    }),
    async runTransaction(fn) {
      return fn({
        get: async (ref) => {
          const data = store.get(key(ref.__c, ref.__id));
          return { exists: data !== undefined, data: () => data };
        },
        set: (ref, data) => { store.set(key(ref.__c, ref.__id), data); },
        update: (ref, patch) => {
          Object.assign(store.get(key(ref.__c, ref.__id)), patch);
        },
        delete: (ref) => { store.delete(key(ref.__c, ref.__id)); },
      });
    },
  };
}

test('normalizeEmail trims and lowercases; emailHash keys never store the address', () => {
  assert.equal(normalizeEmail('  A@Example.ORG '), 'a@example.org');
  assert.equal(emailHash('A@Example.ORG'), emailHash('a@example.org'));
  assert.match(emailHash('a@example.org'), /^[0-9a-f]{64}$/);
});

test('hashCode is salted by token', () => {
  assert.notEqual(hashCode('token-a', '123456'), hashCode('token-b', '123456'));
});

test('rate limit: 5 slots pass, the 6th is limited with a retry hint', async () => {
  const db = fakeDb();
  let clock = 1_000_000;
  const now = () => clock;
  for (let i = 0; i < internals.RATE_LIMIT_MAX; i += 1) {
    const slot = await takeRateLimitSlot({ db, email: 'a@example.org', now });
    assert.equal(slot.limited, false);
    clock += 1000;
  }
  const sixth = await takeRateLimitSlot({ db, email: 'a@example.org', now });
  assert.equal(sixth.limited, true);
  assert.ok(sixth.retryAfterMs > 0 && sixth.retryAfterMs <= internals.RATE_LIMIT_WINDOW_MS);
});

test('rate limit: slots expire after the window', async () => {
  const db = fakeDb();
  let clock = 0;
  const now = () => clock;
  for (let i = 0; i < internals.RATE_LIMIT_MAX; i += 1) {
    await takeRateLimitSlot({ db, email: 'a@example.org', now });
  }
  clock = internals.RATE_LIMIT_WINDOW_MS + 1;
  const slot = await takeRateLimitSlot({ db, email: 'a@example.org', now });
  assert.equal(slot.limited, false);
});

test('plus-addressed variants share one rate bucket; challenges keep the full address', async () => {
  const db = fakeDb();
  const { takeRateLimitSlot: take, rateBucketHash } = require('./challenges.cjs');
  assert.equal(rateBucketHash('victim+1@gmail.com'), rateBucketHash('victim+2@gmail.com'));
  assert.equal(rateBucketHash('victim+tag@gmail.com'), rateBucketHash('victim@gmail.com'));
  assert.notEqual(rateBucketHash('victim@gmail.com'), rateBucketHash('other@gmail.com'));
  for (let i = 0; i < internals.RATE_LIMIT_MAX; i += 1) {
    await take({ db, email: `victim+${i}@gmail.com` });
  }
  const bypass = await take({ db, email: 'victim+next@gmail.com' });
  assert.equal(bypass.limited, true);
  // The challenge itself preserves the sub-address so mail routes correctly.
  const { token } = await createChallenge({ db, email: 'victim+tag@gmail.com', code: '123456' });
  assert.equal(db.store.get(`auth_challenges/${token}`).email, 'victim+tag@gmail.com');
});

test('rate limit buckets are per address', async () => {
  const db = fakeDb();
  for (let i = 0; i < internals.RATE_LIMIT_MAX; i += 1) {
    await takeRateLimitSlot({ db, email: 'a@example.org' });
  }
  const other = await takeRateLimitSlot({ db, email: 'b@example.org' });
  assert.equal(other.limited, false);
});

test('createChallenge stores the salted hash, never the code or raw email casing', async () => {
  const db = fakeDb();
  const { token } = await createChallenge({ db, email: ' A@Example.org ', code: '123456' });
  const stored = db.store.get(`auth_challenges/${token}`);
  assert.equal(stored.kind, 'otp');
  assert.equal(stored.email, 'a@example.org');
  assert.equal(stored.attempts, 0);
  assert.equal(stored.codeHash, hashCode(token, '123456'));
  assert.ok(!JSON.stringify(stored).includes('123456'));
});

test('verify: correct code marks consumed; concurrent replay fails; finalize deletes', async () => {
  const db = fakeDb();
  const { token } = await createChallenge({ db, email: 'a@example.org', code: '123456' });
  const first = await verifyChallenge({ db, token, email: 'a@example.org', code: '123456' });
  assert.deepEqual(first, { ok: true, email: 'a@example.org' });
  // Consumed but not yet finalized: a concurrent replay is blocked.
  const replay = await verifyChallenge({ db, token, email: 'a@example.org', code: '123456' });
  assert.deepEqual(replay, { ok: false });
  await finalizeChallenge({ db, token });
  assert.equal(db.store.has(`auth_challenges/${token}`), false);
});

test('verify: release after a failed token issuance lets the same code retry', async () => {
  const db = fakeDb();
  const { token } = await createChallenge({ db, email: 'a@example.org', code: '123456' });
  assert.equal((await verifyChallenge({ db, token, email: 'a@example.org', code: '123456' })).ok, true);
  await releaseChallenge({ db, token });
  const retry = await verifyChallenge({ db, token, email: 'a@example.org', code: '123456' });
  assert.deepEqual(retry, { ok: true, email: 'a@example.org' });
});

test('verify: wrong code fails, burns an attempt, and locks out at the cap', async () => {
  const db = fakeDb();
  const { token } = await createChallenge({ db, email: 'a@example.org', code: '123456' });
  for (let i = 0; i < internals.MAX_ATTEMPTS; i += 1) {
    const miss = await verifyChallenge({ db, token, email: 'a@example.org', code: '000000' });
    assert.deepEqual(miss, { ok: false });
  }
  // Attempts exhausted: even the CORRECT code is now rejected.
  const late = await verifyChallenge({ db, token, email: 'a@example.org', code: '123456' });
  assert.deepEqual(late, { ok: false });
});

test('verify: email mismatch fails and burns an attempt', async () => {
  const db = fakeDb();
  const { token } = await createChallenge({ db, email: 'a@example.org', code: '123456' });
  const miss = await verifyChallenge({ db, token, email: 'b@example.org', code: '123456' });
  assert.deepEqual(miss, { ok: false });
  assert.equal(db.store.get(`auth_challenges/${token}`).attempts, 1);
});

test('verify: expired challenge fails even with the correct code', async () => {
  const db = fakeDb();
  let clock = 0;
  const { token } = await createChallenge({ db, email: 'a@example.org', code: '123456', now: () => clock });
  clock = internals.CHALLENGE_TTL_MS + 1;
  const late = await verifyChallenge({ db, token, email: 'a@example.org', code: '123456', now: () => clock });
  assert.deepEqual(late, { ok: false });
});

test('verify: unknown or malformed token fails without touching the store', async () => {
  const db = fakeDb();
  assert.deepEqual(await verifyChallenge({ db, token: 'nope', email: 'a@example.org', code: '123456' }), { ok: false });
  assert.deepEqual(await verifyChallenge({ db, token: 'f'.repeat(64), email: 'a@example.org', code: '123456' }), { ok: false });
});

test('sweepExpired deletes expired challenges and stale rate buckets only', async () => {
  const db = fakeDb();
  let clock = 0;
  const now = () => clock;
  const { token: oldToken } = await createChallenge({ db, email: 'a@example.org', code: '111111', now });
  await takeRateLimitSlot({ db, email: 'a@example.org', now });
  clock = internals.CHALLENGE_TTL_MS + internals.RATE_LIMIT_WINDOW_MS + 1000;
  const { token: freshToken } = await createChallenge({ db, email: 'b@example.org', code: '222222', now });
  await takeRateLimitSlot({ db, email: 'b@example.org', now });

  const swept = await sweepExpired({ db, now });
  assert.equal(swept.challenges, 1);
  assert.equal(swept.rateLimits, 1);
  assert.equal(db.store.has(`auth_challenges/${oldToken}`), false);
  assert.equal(db.store.has(`auth_challenges/${freshToken}`), true);
});
