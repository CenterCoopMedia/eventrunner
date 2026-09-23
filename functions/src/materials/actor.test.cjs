'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveActor, resolveActorOptional } = require('./actor.cjs');

const TOKENS = {
  ops: { uid: 'ops-1', email: 'ops@example.org', email_verified: true },
  staff: { uid: 'staff-1', email: 'staff@example.org', email_verified: true },
  attendee: { uid: 'att-1', email: 'attendee@example.org', email_verified: true },
};

const auth = {
  async verifyIdToken(token) {
    if (TOKENS[token]) return TOKENS[token];
    throw new Error('bad token');
  },
};

const getConfig = async () => ({
  bootstrap: { adminEmails: ['ops@example.org'], staffEmails: ['staff@example.org'] },
});

const BOOTSTRAP = { adminEmails: ['ops@example.org'], staffEmails: ['staff@example.org'] };

/**
 * A db serving `users/{uid}` and the live `config/bootstrap` requireAdmin
 * reads. `bootstrap` is the document (null for absent) or an Error the read
 * throws with.
 */
function usersDb(profiles, bootstrap = BOOTSTRAP) {
  return {
    collection(name) {
      if (name === 'config') {
        return {
          doc: (id) => ({
            async get() {
              assert.equal(id, 'bootstrap');
              if (bootstrap instanceof Error) throw bootstrap;
              return { exists: bootstrap !== null, data: () => bootstrap ?? undefined };
            },
          }),
        };
      }
      assert.equal(name, 'users');
      return {
        doc: (uid) => ({
          async get() {
            const data = profiles[uid];
            return { exists: data !== undefined, data: () => data };
          },
        }),
      };
    },
  };
}

const req = (token) => ({ headers: token ? { authorization: `Bearer ${token}` } : {} });

test('resolveActor: both admin tiers resolve as isAdmin — materials are staff work (issue 186)', async () => {
  const db = usersDb({});
  for (const token of ['ops', 'staff']) {
    const actor = await resolveActor({ auth, db, getConfig }, req(token));
    assert.equal(actor.ok, true);
    assert.equal(actor.isAdmin, true, token);
    assert.equal(actor.speakerId, null);
  }
});

test('resolveActor: a signed-in non-admin carries their speakerId and no admin flag', async () => {
  const db = usersDb({ 'att-1': { speakerId: 'spk-1' } });
  const actor = await resolveActor({ auth, db, getConfig }, req('attendee'));
  assert.deepEqual(actor, { ok: true, uid: 'att-1', isAdmin: false, speakerId: 'spk-1' });
});

test('resolveActor refuses a missing token; resolveActorOptional resolves it to an anonymous actor', async () => {
  const db = usersDb({});
  const refused = await resolveActor({ auth, db, getConfig }, req(null));
  assert.equal(refused.ok, false);
  assert.equal(refused.status, 401);
  const anonymous = await resolveActorOptional({ auth, db, getConfig }, req(null));
  assert.deepEqual(anonymous, { ok: true, uid: null, isAdmin: false, speakerId: null });
});

test('resolveActor: a failed bootstrap read is a 500 on a write, never "not an admin"', async () => {
  const db = usersDb({}, new Error('firestore down'));
  const verdict = await resolveActor({ auth, db, getConfig }, req('staff'));
  assert.equal(verdict.ok, false);
  assert.equal(verdict.status, 500);
});

test('resolveActorOptional: a failed bootstrap read reads as not-admin, so an anonymous fetch still works', async () => {
  const db = usersDb({ 'staff-1': { speakerId: null } }, new Error('firestore down'));
  const actor = await resolveActorOptional({ auth, db, getConfig }, req('staff'));
  assert.deepEqual(actor, { ok: true, uid: 'staff-1', isAdmin: false, speakerId: null });
});

test('resolveActor: an absent bootstrap document admits no admin, whatever the cached copy says', async () => {
  const db = usersDb({}, null);
  const actor = await resolveActor({ auth, db, getConfig }, req('ops'));
  assert.deepEqual(actor, { ok: true, uid: 'ops-1', isAdmin: false, speakerId: null });
});
