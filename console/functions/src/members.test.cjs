'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { makeFakeDb } = require('./fakes.cjs');
const { changeMemberRole, removeMember } = require('./members.cjs');

const ana = { uid: 'ana', email: 'ana@example.org' };
const ben = { uid: 'ben', email: 'ben@example.org' };

function seeded(extra = {}) {
  return makeFakeDb({
    'console_config/operators': { emails: ['ops@ccm.example'] },
    'organizations/o1': { name: 'Org one' },
    'organizations/o1/members/ana': { uid: 'ana', email: 'ana@example.org', role: 'owner' },
    'organizations/o1/members/ben': { uid: 'ben', email: 'ben@example.org', role: 'editor' },
    ...extra,
  });
}

test('an Owner makes an Editor an Owner, and back', async () => {
  const db = seeded();
  const result = await changeMemberRole({ db }, { body: { orgId: 'o1', uid: 'ben', role: 'owner' }, user: ana });
  assert.deepEqual(result.body, { uid: 'ben', role: 'owner' });
  assert.equal(db.read('organizations/o1/members/ben').role, 'owner');
  await changeMemberRole({ db }, { body: { orgId: 'o1', uid: 'ben', role: 'editor' }, user: ana });
  assert.equal(db.read('organizations/o1/members/ben').role, 'editor');
});

test('changeMemberRole refuses an unknown role and an unknown member', async () => {
  const db = seeded();
  await assert.rejects(changeMemberRole({ db }, { body: { orgId: 'o1', uid: 'ben', role: 'admin' }, user: ana }), { status: 400 });
  await assert.rejects(changeMemberRole({ db }, { body: { orgId: 'o1', uid: 'zed', role: 'owner' }, user: ana }), { status: 404 });
});

test('only an Owner changes a role; an Editor and an operator cannot', async () => {
  const db = seeded();
  await assert.rejects(changeMemberRole({ db }, { body: { orgId: 'o1', uid: 'ana', role: 'editor' }, user: ben }), { status: 403 });
  await assert.rejects(
    changeMemberRole({ db }, { body: { orgId: 'o1', uid: 'ben', role: 'owner' }, user: { uid: 'ops', email: 'ops@ccm.example' } }),
    { status: 404 },
  );
  assert.equal(db.read('organizations/o1/members/ana').role, 'owner');
});

test('the last Owner cannot step down to Editor', async () => {
  const db = seeded();
  await assert.rejects(
    changeMemberRole({ db }, { body: { orgId: 'o1', uid: 'ana', role: 'editor' }, user: ana }),
    { status: 409, code: 'last-owner' },
  );
  assert.equal(db.read('organizations/o1/members/ana').role, 'owner');
});

test('an Owner can step down when another Owner stays', async () => {
  const db = seeded({ 'organizations/o1/members/cy': { uid: 'cy', email: 'cy@example.org', role: 'owner' } });
  await changeMemberRole({ db }, { body: { orgId: 'o1', uid: 'ana', role: 'editor' }, user: ana });
  assert.equal(db.read('organizations/o1/members/ana').role, 'editor');
});

test('an Owner removes a member', async () => {
  const db = seeded();
  const result = await removeMember({ db }, { body: { orgId: 'o1', uid: 'ben' }, user: ana });
  assert.deepEqual(result.body, { uid: 'ben', removed: true });
  assert.equal(db.read('organizations/o1/members/ben'), undefined);
});

test('removeMember never leaves an organization with no Owner', async () => {
  const db = seeded();
  await assert.rejects(removeMember({ db }, { body: { orgId: 'o1', uid: 'ana' }, user: ana }), { status: 409, code: 'last-owner' });
  assert.ok(db.read('organizations/o1/members/ana'));
});

test('an Editor cannot remove anyone, and a missing member is a 404', async () => {
  const db = seeded();
  await assert.rejects(removeMember({ db }, { body: { orgId: 'o1', uid: 'ana' }, user: ben }), { status: 403 });
  await assert.rejects(removeMember({ db }, { body: { orgId: 'o1', uid: 'zed' }, user: ana }), { status: 404 });
  await assert.rejects(removeMember({ db }, { body: { orgId: 'o1', uid: 'a/b' }, user: ana }), { status: 400 });
});
