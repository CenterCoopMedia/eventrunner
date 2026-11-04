'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHash } = require('node:crypto');
const { makeFakeDb } = require('./fakes.cjs');
const { acceptInvite, inviteMember } = require('./invites.cjs');

const NOW = Date.parse('2026-11-04T15:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const ana = { uid: 'ana', email: 'ana@example.org' };
const ben = { uid: 'ben', email: 'ben@example.org' };
const sam = { uid: 'sam', email: 'sam@example.org' };
const PUBLIC_URL = 'https://console.eventrunner.org';
const sha = (t) => createHash('sha256').update(t).digest('hex');

function fakeMailer({ fail = false } = {}) {
  return {
    sent: [],
    async sendInvite(message) {
      if (fail) throw new Error('provider down');
      this.sent.push(message);
    },
  };
}

function seeded(extra = {}) {
  return makeFakeDb({
    'console_config/operators': { emails: ['ops@ccm.example'] },
    'organizations/o1': { name: 'Org one' },
    'organizations/o1/members/ana': { uid: 'ana', email: 'ana@example.org', role: 'owner' },
    'organizations/o1/members/ben': { uid: 'ben', email: 'ben@example.org', role: 'editor' },
    ...extra,
  });
}

function deps(db, mailer = fakeMailer(), now = () => NOW) {
  return { db, mailer, now, publicUrl: PUBLIC_URL };
}

/** Pull the id and token out of the link in the sent email. */
function linkParts(mailer) {
  const match = mailer.sent.at(-1).link.match(/\/invite\/([^#]+)#token=(.+)$/);
  return { inviteId: match[1], token: match[2] };
}

test('an Owner invites a teammate: the invite stores a hash of the token, and the email has the link', async () => {
  const db = seeded();
  const mailer = fakeMailer();
  const result = await inviteMember(deps(db, mailer), { body: { orgId: 'o1', email: ' Sam@Example.org ', role: 'owner' }, user: ana });
  assert.equal(result.status, 201);
  const { inviteId, token } = linkParts(mailer);
  assert.equal(result.body.invite.id, inviteId);
  assert.equal(result.body.invite.email, 'sam@example.org');
  assert.ok(token.length >= 40);
  const stored = db.read(`invites/${inviteId}`);
  assert.deepEqual(stored, {
    orgId: 'o1',
    email: 'sam@example.org',
    role: 'owner',
    tokenHash: sha(token),
    status: 'pending',
    invitedBy: 'ana',
    invitedByEmail: 'ana@example.org',
    createdAt: new Date(NOW),
    expiresAt: new Date(NOW + 7 * DAY),
  });
  assert.ok(!JSON.stringify(stored).includes(token), 'the token itself is never stored');
  assert.ok(!JSON.stringify(result.body).includes(token), 'the token is never in the response');
  assert.deepEqual(mailer.sent[0], {
    to: 'sam@example.org',
    organizationName: 'Org one',
    inviterEmail: 'ana@example.org',
    role: 'owner',
    link: `${PUBLIC_URL}/invite/${inviteId}#token=${token}`,
    expiresInDays: 7,
  });
});

test('inviteMember checks the email, the role and that the person is not on the team yet', async () => {
  const db = seeded();
  await assert.rejects(inviteMember(deps(db), { body: { orgId: 'o1', email: 'nope', role: 'editor' }, user: ana }), { status: 400 });
  await assert.rejects(inviteMember(deps(db), { body: { orgId: 'o1', email: 'x@example.org', role: 'boss' }, user: ana }), { status: 400 });
  await assert.rejects(
    inviteMember(deps(db), { body: { orgId: 'o1', email: 'BEN@example.org', role: 'owner' }, user: ana }),
    { status: 409, code: 'already-member' },
  );
});

test('only an Owner invites', async () => {
  const db = seeded();
  const mailer = fakeMailer();
  await assert.rejects(inviteMember(deps(db, mailer), { body: { orgId: 'o1', email: 'x@example.org', role: 'editor' }, user: ben }), { status: 403 });
  await assert.rejects(
    inviteMember(deps(db, mailer), { body: { orgId: 'o1', email: 'x@example.org', role: 'editor' }, user: { uid: 'ops', email: 'ops@ccm.example' } }),
    { status: 404 },
  );
  assert.equal(mailer.sent.length, 0);
});

test('a new invite to the same address replaces the open one', async () => {
  const db = seeded();
  const mailer = fakeMailer();
  await inviteMember(deps(db, mailer), { body: { orgId: 'o1', email: 'sam@example.org', role: 'editor' }, user: ana });
  const first = linkParts(mailer);
  await inviteMember(deps(db, mailer), { body: { orgId: 'o1', email: 'sam@example.org', role: 'owner' }, user: ana });
  const second = linkParts(mailer);
  assert.equal(db.read(`invites/${first.inviteId}`).status, 'replaced');
  assert.equal(db.read(`invites/${second.inviteId}`).status, 'pending');
  await assert.rejects(acceptInvite(deps(db), { body: first, user: sam }), { status: 410, code: 'invite-replaced' });
});

test('a failed send removes the new invite and keeps the open one', async () => {
  const db = seeded();
  const mailer = fakeMailer();
  await inviteMember(deps(db, mailer), { body: { orgId: 'o1', email: 'sam@example.org', role: 'editor' }, user: ana });
  const first = linkParts(mailer);
  await assert.rejects(
    inviteMember(deps(db, fakeMailer({ fail: true })), { body: { orgId: 'o1', email: 'sam@example.org', role: 'owner' }, user: ana }),
    { status: 502, code: 'mail-failed' },
  );
  assert.deepEqual(db.paths('invites/'), [`invites/${first.inviteId}`]);
  assert.equal(db.read(`invites/${first.inviteId}`).status, 'pending');
});

test('an organization can send 20 invites a day', async () => {
  const db = seeded();
  for (let i = 0; i < 20; i += 1) {
    await inviteMember(deps(db), { body: { orgId: 'o1', email: `p${i}@example.org`, role: 'editor' }, user: ana });
  }
  await assert.rejects(
    inviteMember(deps(db), { body: { orgId: 'o1', email: 'p21@example.org', role: 'editor' }, user: ana }),
    { status: 429, code: 'rate-limited' },
  );
  await inviteMember(deps(db, fakeMailer(), () => NOW + DAY), { body: { orgId: 'o1', email: 'p21@example.org', role: 'editor' }, user: ana });
});

test('the invitee accepts once and joins with the invited role', async () => {
  const db = seeded();
  const mailer = fakeMailer();
  await inviteMember(deps(db, mailer), { body: { orgId: 'o1', email: 'sam@example.org', role: 'owner' }, user: ana });
  const parts = linkParts(mailer);
  const result = await acceptInvite(deps(db, mailer, () => NOW + DAY), { body: parts, user: sam });
  assert.deepEqual(result.body, { organization: { id: 'o1', name: 'Org one' }, role: 'owner' });
  assert.deepEqual(db.read('organizations/o1/members/sam'), {
    uid: 'sam', email: 'sam@example.org', role: 'owner', joinedAt: new Date(NOW + DAY),
  });
  const invite = db.read(`invites/${parts.inviteId}`);
  assert.equal(invite.status, 'accepted');
  assert.equal(invite.acceptedBy, 'sam');
  await assert.rejects(acceptInvite(deps(db), { body: parts, user: sam }), { status: 410, code: 'invite-used' });
});

test('acceptInvite refuses a different signed-in email', async () => {
  const db = seeded();
  const mailer = fakeMailer();
  await inviteMember(deps(db, mailer), { body: { orgId: 'o1', email: 'sam@example.org', role: 'editor' }, user: ana });
  await assert.rejects(
    acceptInvite(deps(db), { body: linkParts(mailer), user: { uid: 'eve', email: 'eve@example.org' } }),
    { status: 403, code: 'wrong-email' },
  );
  assert.equal(db.read('organizations/o1/members/eve'), undefined);
});

test('acceptInvite refuses an expired invite', async () => {
  const db = seeded();
  const mailer = fakeMailer();
  await inviteMember(deps(db, mailer), { body: { orgId: 'o1', email: 'sam@example.org', role: 'editor' }, user: ana });
  await assert.rejects(
    acceptInvite(deps(db, mailer, () => NOW + 7 * DAY), { body: linkParts(mailer), user: sam }),
    { status: 410, code: 'invite-expired' },
  );
});

test('acceptInvite gives one answer for a wrong token and a missing invite', async () => {
  const db = seeded();
  const mailer = fakeMailer();
  await inviteMember(deps(db, mailer), { body: { orgId: 'o1', email: 'sam@example.org', role: 'editor' }, user: ana });
  const { inviteId } = linkParts(mailer);
  for (const body of [
    { inviteId, token: 'x'.repeat(43) },
    { inviteId: 'missing', token: 'x'.repeat(43) },
    { inviteId, token: '' },
    { inviteId: 'a/b', token: 'x'.repeat(43) },
  ]) {
    await assert.rejects(acceptInvite(deps(db), { body, user: sam }), { status: 404, code: 'invite-invalid' });
  }
});

test('acceptInvite keeps the role of someone who is already a member', async () => {
  const db = seeded({
    'invites/i9': {
      orgId: 'o1', email: 'ben@example.org', role: 'owner', tokenHash: sha('t'.repeat(43)), status: 'pending',
      expiresAt: new Date(NOW + DAY), invitedBy: 'ana', invitedByEmail: 'ana@example.org', createdAt: new Date(NOW),
    },
  });
  const result = await acceptInvite(deps(db), { body: { inviteId: 'i9', token: 't'.repeat(43) }, user: ben });
  assert.equal(result.body.role, 'editor');
  assert.equal(db.read('organizations/o1/members/ben').role, 'editor');
  assert.equal(db.read('invites/i9').status, 'accepted');
});

test('with no console address set, no invite is made and no email with a broken link is sent', async () => {
  const db = seeded();
  const mailer = fakeMailer();
  await assert.rejects(
    inviteMember({ ...deps(db, mailer), publicUrl: '' }, { body: { orgId: 'o1', email: 'sam@example.org', role: 'editor' }, user: ana }),
    (err) => err.status === 502 && err.code === 'mail-failed',
  );
  assert.equal(mailer.sent.length, 0);
  assert.equal((await db.collection('invites').get()).size, 0);
});
