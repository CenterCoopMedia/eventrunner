'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { makeFakeDb, makeFakeAuth, makeReq, makeRes } = require('./fakes.cjs');
const { postEndpoint } = require('./http.cjs');
const { getTeam, listOrganizations } = require('./organizations.cjs');

const NOW = new Date('2026-11-04T15:00:00Z');
const now = () => NOW.getTime();
const ana = { uid: 'ana', email: 'ana@example.org' };
const ops = { uid: 'ops', email: 'ops@ccm.example' };

function seeded() {
  return makeFakeDb({
    'console_config/operators': { emails: ['ops@ccm.example'] },
    'organizations/o1': { name: 'Org one', createdAt: new Date('2026-10-01'), createdBy: 'ana' },
    'organizations/o1/members/ana': { uid: 'ana', email: 'ana@example.org', role: 'owner', joinedAt: new Date('2026-10-01') },
    'organizations/o1/members/ben': { uid: 'ben', email: 'ben@example.org', role: 'editor', joinedAt: new Date('2026-10-02') },
    'organizations/o2': { name: 'Org two', createdAt: new Date('2026-10-05'), createdBy: 'cy' },
    'organizations/o2/members/cy': { uid: 'cy', email: 'cy@example.org', role: 'owner', joinedAt: new Date('2026-10-05') },
    'invites/i1': {
      orgId: 'o1', email: 'dee@example.org', role: 'editor', tokenHash: 'h', status: 'pending',
      expiresAt: new Date('2026-11-10'), invitedBy: 'ana', createdAt: new Date('2026-11-03'),
    },
    'invites/i2': {
      orgId: 'o1', email: 'old@example.org', role: 'editor', tokenHash: 'h', status: 'pending',
      expiresAt: new Date('2026-11-01'), invitedBy: 'ana', createdAt: new Date('2026-10-20'),
    },
    'invites/i3': {
      orgId: 'o1', email: 'ben@example.org', role: 'editor', tokenHash: 'h', status: 'accepted',
      expiresAt: new Date('2026-11-10'), invitedBy: 'ana', createdAt: new Date('2026-10-02'),
    },
  });
}

test('listOrganizations through the endpoint needs a verified email', async () => {
  const db = seeded();
  const auth = makeFakeAuth({ t: { uid: 'ana', email: 'ana@example.org', email_verified: false } });
  const res = makeRes();
  await postEndpoint({ auth }, (input) => listOrganizations({ db, now }, input))(
    makeReq({ token: 't', body: {} }), res,
  );
  assert.equal(res.statusCode, 403);
});

test('listOrganizations lists only the caller\'s organizations with the role', async () => {
  const result = await listOrganizations({ db: seeded() }, { body: {}, user: { uid: 'ben', email: 'ben@example.org' } });
  assert.deepEqual(result.body, {
    operator: false,
    organizations: [{ id: 'o1', name: 'Org one', role: 'editor' }],
  });
});

test('listOrganizations gives an operator every organization as well', async () => {
  const result = await listOrganizations({ db: seeded() }, { body: {}, user: ops });
  assert.equal(result.body.operator, true);
  assert.deepEqual(result.body.organizations, []);
  assert.deepEqual(result.body.allOrganizations.map((o) => o.id), ['o2', 'o1']);
  assert.equal(result.body.allOrganizations[0].createdAt, '2026-10-05T00:00:00.000Z');
});

test('getTeam lists members, Owners first, and open invites, and counts the Owners still needed', async () => {
  const result = await getTeam({ db: seeded(), now }, { body: { orgId: 'o1' }, user: { uid: 'ben', email: 'ben@example.org' } });
  assert.deepEqual(result.body.organization, { id: 'o1', name: 'Org one' });
  assert.equal(result.body.myRole, 'editor');
  assert.equal(result.body.operator, false);
  assert.deepEqual(result.body.members.map((m) => [m.uid, m.role]), [['ana', 'owner'], ['ben', 'editor']]);
  assert.equal(result.body.members[0].joinedAt, '2026-10-01T00:00:00.000Z');
  assert.deepEqual(result.body.invites, [
    { id: 'i1', email: 'dee@example.org', role: 'editor', expiresAt: '2026-11-10T00:00:00.000Z' },
  ]);
  assert.equal(result.body.ownersNeeded, 1);
  assert.ok(!JSON.stringify(result.body).includes('tokenHash'));
});

test('getTeam admits an operator and hides the organization from a stranger', async () => {
  const db = seeded();
  const asOps = await getTeam({ db, now }, { body: { orgId: 'o2' }, user: ops });
  assert.equal(asOps.body.operator, true);
  assert.equal(asOps.body.myRole, null);
  await assert.rejects(getTeam({ db, now }, { body: { orgId: 'o2' }, user: ana }), { status: 404 });
  await assert.rejects(getTeam({ db, now }, { body: { orgId: 'nope' }, user: ana }), { status: 404 });
});
