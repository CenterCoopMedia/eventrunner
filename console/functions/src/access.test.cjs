'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { makeFakeDb } = require('./fakes.cjs');
const {
  ROLES, isOperator, normalizeEmail, readMember, requireMemberOrOperator, requireOwner, toIso, validOrgId,
} = require('./access.cjs');

const seed = {
  'console_config/operators': { emails: ['ops@ccm.example', ' Mixed@CCM.example '] },
  'organizations/o1': { name: 'Org one' },
  'organizations/o1/members/owner1': { uid: 'owner1', email: 'owner@example.org', role: 'owner' },
  'organizations/o1/members/ed1': { uid: 'ed1', email: 'ed@example.org', role: 'editor' },
};

test('roles are owner and editor only', () => {
  assert.deepEqual(ROLES, ['owner', 'editor']);
});

test('normalizeEmail trims, lowercases and refuses a malformed address', () => {
  assert.equal(normalizeEmail('  Ana@Example.ORG '), 'ana@example.org');
  for (const bad of ['', 'ana', 'ana@', '@x.org', 'a b@x.org', 42, null, `${'a'.repeat(250)}@x.org`]) {
    assert.equal(normalizeEmail(bad), null, String(bad));
  }
});

test('validOrgId accepts a document id and refuses a path', () => {
  assert.equal(validOrgId('o1'), true);
  for (const bad of ['', 'a/b', '..', '.', 7, null, 'x'.repeat(200)]) assert.equal(validOrgId(bad), false, String(bad));
});

test('isOperator reads the allowlist live and compares lowercase', async () => {
  const db = makeFakeDb(seed);
  assert.equal(await isOperator(db, 'ops@ccm.example'), true);
  assert.equal(await isOperator(db, 'mixed@ccm.example'), true);
  assert.equal(await isOperator(db, 'owner@example.org'), false);
  assert.equal(await isOperator(makeFakeDb(), 'ops@ccm.example'), false);
  assert.equal(await isOperator(makeFakeDb({ 'console_config/operators': { emails: 'ops@ccm.example' } }), 'ops@ccm.example'), false);
});

test('readMember returns the member record or null', async () => {
  const db = makeFakeDb(seed);
  assert.equal((await readMember(db, 'o1', 'ed1')).role, 'editor');
  assert.equal(await readMember(db, 'o1', 'nobody'), null);
});

test('requireOwner admits an owner and refuses an editor, a stranger and an operator', async () => {
  const db = makeFakeDb(seed);
  assert.equal((await requireOwner(db, 'o1', { uid: 'owner1', email: 'owner@example.org' })).role, 'owner');
  for (const user of [
    { uid: 'ed1', email: 'ed@example.org' },
    { uid: 'x', email: 'x@example.org' },
    { uid: 'op', email: 'ops@ccm.example' },
  ]) {
    await assert.rejects(requireOwner(db, 'o1', user), (err) => err.status === 403 || err.status === 404);
  }
});

test('requireOwner answers 404 for an organization that does not exist', async () => {
  await assert.rejects(requireOwner(makeFakeDb(seed), 'missing', { uid: 'owner1' }), { status: 404 });
  await assert.rejects(requireOwner(makeFakeDb(seed), 'a/b', { uid: 'owner1' }), { status: 400 });
});

test('requireMemberOrOperator admits members and operators, and hides the org from others', async () => {
  const db = makeFakeDb(seed);
  assert.deepEqual(
    await requireMemberOrOperator(db, 'o1', { uid: 'ed1', email: 'ed@example.org' }),
    { role: 'editor', operator: false },
  );
  assert.deepEqual(
    await requireMemberOrOperator(db, 'o1', { uid: 'op', email: 'ops@ccm.example' }),
    { role: null, operator: true },
  );
  await assert.rejects(requireMemberOrOperator(db, 'o1', { uid: 'x', email: 'x@example.org' }), { status: 404 });
});

test('toIso reads a Date, a Firestore Timestamp and a missing value', () => {
  const at = new Date('2026-11-04T12:00:00Z');
  assert.equal(toIso(at), '2026-11-04T12:00:00.000Z');
  assert.equal(toIso({ toDate: () => at }), '2026-11-04T12:00:00.000Z');
  assert.equal(toIso(undefined), null);
});
