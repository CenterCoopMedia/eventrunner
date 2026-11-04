'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { test } = require('node:test');
const {
  EXPIRES_IN_DAYS, createLink, createSignupLink, getSignupLink, listSignupLinks, redeemSignupLink, revokeSignupLink,
} = require('./signupLinks.cjs');
const { NOW, ana, ben, fakeMailer, ops, quietLog, seededDb, signupTerms } = require('./testData.cjs');

const DAY = 24 * 60 * 60 * 1000;
const PUBLIC_URL = 'https://console.example';
const REDEEM = { organizationName: 'Example Press', timezone: 'America/New_York' };

const deps = (db, more = {}) => ({ db, now: () => NOW, publicUrl: PUBLIC_URL, mailer: fakeMailer(), log: quietLog(), ...more });

function open() {
  return seededDb(signupTerms());
}

/** Make a link the way an operator does. @returns the link's id and token, read from the url */
async function made(db, name = 'Example Press') {
  const { body } = await createSignupLink(deps(db), { body: { organizationName: name }, user: ops });
  const url = new URL(body.url);
  return { linkId: body.link.id, token: url.hash.replace('#token=', ''), url: body.url };
}

const orgsBefore = (db) => db.paths('organizations/').filter((p) => p.split('/').length === 2).length;

test('an operator makes a link: the url holds the token after the hash, and only its hash is stored', async () => {
  const db = open();
  const result = await createSignupLink(deps(db), { body: { organizationName: '  Example   Press ' }, user: ops });
  assert.equal(result.status, 201);
  const { link, url } = result.body;
  const at = new Date(NOW).toISOString();
  assert.deepEqual(link, {
    id: link.id, organizationName: 'Example Press', status: 'open', createdAt: at,
    expiresAt: new Date(NOW + EXPIRES_IN_DAYS * DAY).toISOString(),
  });
  const parsed = new URL(url);
  assert.equal(`${parsed.origin}${parsed.pathname}`, `${PUBLIC_URL}/start/${link.id}`);
  const token = parsed.hash.replace('#token=', '');
  assert.equal(Buffer.from(token, 'base64url').length, 32);

  const stored = db.read(`signup_links/${link.id}`);
  assert.equal(stored.tokenHash, createHash('sha256').update(token).digest('hex'));
  assert.ok(!JSON.stringify(stored).includes(token), 'the token is not stored');
  assert.equal(stored.createdBy, 'ops');
  assert.equal(stored.status, 'open');
  const audit = db.paths('console_audit/').map((p) => db.read(p));
  assert.deepEqual(audit, [{ action: 'create-signup-link', linkId: link.id, by: 'ops', at: new Date(NOW) }]);
});

test('createLink can be called with no signed-in person, for automatic invoices later', async () => {
  const db = open();
  const { link, url } = await createLink(deps(db), { organizationName: 'Example Press', by: 'invoicing' });
  assert.ok(url.includes(link.id));
  assert.equal(db.read(`signup_links/${link.id}`).createdBy, 'invoicing');
});

test('only an operator can make, list or revoke a link', async () => {
  const db = open();
  const { linkId } = await made(db);
  await assert.rejects(createSignupLink(deps(db), { body: { organizationName: 'Example Press' }, user: ana }), { status: 403 });
  await assert.rejects(listSignupLinks(deps(db), { body: {}, user: ana }), { status: 403 });
  await assert.rejects(revokeSignupLink(deps(db), { body: { linkId }, user: ana }), { status: 403 });
  assert.equal(db.read(`signup_links/${linkId}`).status, 'open');
  assert.equal(db.paths('signup_links/').length, 1);
});

test('a link is refused while sign-ups are closed, and the message names what is missing', async () => {
  const terms = signupTerms();
  const db = seededDb({ 'console_config/agreement': terms['console_config/agreement'], 'console_config/settings': { region: 'us-central1' } });
  await assert.rejects(createSignupLink(deps(db), { body: { organizationName: 'Example Press' }, user: ops }), (err) => {
    assert.equal(err.status, 409);
    assert.equal(err.code, 'signups-closed');
    assert.match(err.message, /the Google Cloud folder, the billing account/);
    return true;
  });
  await assert.rejects(
    createSignupLink(deps(seededDb({ 'console_config/settings': terms['console_config/settings'] })), { body: { organizationName: 'Example Press' }, user: ops }),
    /the agreement/,
  );
  assert.deepEqual(db.paths('signup_links/'), []);
});

test('a link needs the console address and a usable name', async () => {
  const db = open();
  await assert.rejects(createSignupLink(deps(db, { publicUrl: '' }), { body: { organizationName: 'Example Press' }, user: ops }), { status: 502, code: 'not-configured' });
  for (const organizationName of ['', ' a ', 'x'.repeat(101), 42, undefined]) {
    await assert.rejects(createSignupLink(deps(db), { body: { organizationName }, user: ops }), { status: 400, code: 'bad-request', field: 'organizationName' });
  }
  assert.deepEqual(db.paths('signup_links/'), []);
});

test('the list is newest first, shows an expired link as expired, and never holds a token, a hash or a url', async () => {
  const db = open();
  const first = await made(db, 'First org');
  const second = await made(db, 'Second org');
  await db.collection('signup_links').doc(first.linkId).update({ createdAt: new Date(NOW - 40 * DAY), expiresAt: new Date(NOW - 10 * DAY) });
  const { links } = (await listSignupLinks(deps(db), { body: {}, user: ops })).body;
  assert.deepEqual(links.map((l) => [l.organizationName, l.status]), [['Second org', 'open'], ['First org', 'expired']]);
  assert.deepEqual(Object.keys(links[0]).sort(), ['appId', 'createdAt', 'expiresAt', 'id', 'orgId', 'organizationName', 'status', 'usedAt', 'usedEmail']);
  const text = JSON.stringify(links);
  for (const { token, url } of [first, second]) {
    assert.ok(!text.includes(token));
    assert.ok(!text.includes(url));
  }
  assert.ok(!text.includes('tokenHash'));
});

test('a revoked link stops working, is audited, and only an open link can be revoked', async () => {
  const db = open();
  const { linkId, token } = await made(db);
  assert.deepEqual((await revokeSignupLink(deps(db), { body: { linkId }, user: ops })).body, { linkId, status: 'revoked' });
  assert.ok(db.paths('console_audit/').map((p) => db.read(p)).some((a) => a.action === 'revoke-signup-link' && a.linkId === linkId && a.by === 'ops'));
  await assert.rejects(revokeSignupLink(deps(db), { body: { linkId }, user: ops }), { status: 409, code: 'link-not-open' });
  await assert.rejects(revokeSignupLink(deps(db), { body: { linkId: 'nope' }, user: ops }), { status: 404 });
  await assert.rejects(getSignupLink(deps(db), { body: { linkId, token }, user: ana }), { status: 410, code: 'link-revoked', message: /new link/ });
  await assert.rejects(redeemSignupLink(deps(db), { body: { linkId, token, ...REDEEM }, user: ana }), { status: 410, code: 'link-revoked' });
  assert.equal(orgsBefore(db), 2, 'only the seeded organizations');
});

test('a wrong token and a missing link read the same, whatever state the link is in', async () => {
  const db = open();
  const { linkId, token } = await made(db);
  const invalid = { status: 404, code: 'link-invalid' };
  const wrong = [
    { linkId, token: 'wrong' },
    { linkId, token: '' },
    { linkId, token: 42 },
    { linkId, token: 'x'.repeat(201) },
    { linkId, token: token.slice(0, -1) },
    { linkId: 'nope', token },
    { linkId: 'a/b', token },
    { token },
  ];
  for (const body of wrong) {
    await assert.rejects(getSignupLink(deps(db), { body, user: ana }), invalid);
    await assert.rejects(redeemSignupLink(deps(db), { body: { ...body, ...REDEEM }, user: ana }), invalid);
  }
  await revokeSignupLink(deps(db), { body: { linkId }, user: ops });
  await assert.rejects(getSignupLink(deps(db), { body: { linkId, token: 'wrong' }, user: ana }), invalid, 'a wrong token learns nothing about a revoked link');
});

test('a client reads the name, and an expired link says so', async () => {
  const db = open();
  const { linkId, token } = await made(db);
  assert.deepEqual((await getSignupLink(deps(db), { body: { linkId, token }, user: ana })).body, { organizationName: 'Example Press', status: 'open' });
  const later = { now: () => NOW + EXPIRES_IN_DAYS * DAY };
  await assert.rejects(getSignupLink(deps(db, later), { body: { linkId, token }, user: ana }), { status: 410, code: 'link-expired', message: /new link/ });
  await assert.rejects(redeemSignupLink(deps(db, later), { body: { linkId, token, ...REDEEM }, user: ana }), { status: 410, code: 'link-expired' });
  assert.equal(db.read(`signup_links/${linkId}`).status, 'open');
});

test('redeeming makes the organization, its Owner and a draft together, and uses the link', async () => {
  const db = open();
  const { linkId, token } = await made(db);
  const user = { uid: 'newbie', email: 'new@example.org' };
  const result = await redeemSignupLink(deps(db), { body: { linkId, token, organizationName: '  Example  Press News ', timezone: 'America/New_York' }, user });
  assert.equal(result.status, 201);
  const { orgId, appId } = result.body;
  const at = new Date(NOW);
  assert.deepEqual(db.read(`organizations/${orgId}`), { name: 'Example Press News', createdAt: at, createdBy: 'newbie' });
  assert.deepEqual(db.read(`organizations/${orgId}/members/newbie`), { uid: 'newbie', email: 'new@example.org', role: 'owner', joinedAt: at });
  const app = db.read(`applications/${appId}`);
  assert.equal(app.orgId, orgId);
  assert.equal(app.status, 'draft');
  assert.equal(app.answers.organization.name, 'Example Press News');
  assert.equal(app.answers.event.timezone, 'America/New_York');
  const link = db.read(`signup_links/${linkId}`);
  assert.equal(link.status, 'used');
  assert.equal(link.usedBy, 'newbie');
  assert.equal(link.usedEmail, 'new@example.org');
  assert.deepEqual(link.usedAt, at);
  assert.equal(link.orgId, orgId);
  assert.equal(link.appId, appId);
});

test('the same person repeating gets the same ids and nothing new', async () => {
  const db = open();
  const { linkId, token } = await made(db);
  const first = await redeemSignupLink(deps(db), { body: { linkId, token, ...REDEEM }, user: ana });
  const organizations = db.paths('organizations/').length;
  const applications = db.paths('applications/').length;
  const again = await redeemSignupLink(deps(db), { body: { linkId, token, ...REDEEM }, user: ana });
  assert.equal(again.status, 200);
  assert.deepEqual(again.body, first.body);
  assert.equal(db.paths('organizations/').length, organizations);
  assert.equal(db.paths('applications/').length, applications);
  assert.deepEqual((await getSignupLink(deps(db), { body: { linkId, token }, user: ana })).body, { status: 'used', ...first.body });
});

test('a link works once: anyone else who opens a used link is told so', async () => {
  const db = open();
  const { linkId, token } = await made(db);
  const { body: { orgId } } = await redeemSignupLink(deps(db), { body: { linkId, token, ...REDEEM }, user: ana });
  for (const call of [getSignupLink, redeemSignupLink]) {
    await assert.rejects(call(deps(db), { body: { linkId, token, ...REDEEM }, user: ben }), (err) => {
      assert.equal(err.status, 410);
      assert.equal(err.code, 'link-used');
      assert.match(err.message, /new link/);
      assert.ok(!err.message.includes(orgId), 'says nothing of the organization');
      return true;
    });
  }
  assert.equal(db.read(`organizations/${orgId}/members/ben`), undefined);
});

test('a refused redeem leaves nothing behind', async () => {
  const db = open();
  const { linkId, token } = await made(db);
  const before = db.paths('').length;
  await assert.rejects(redeemSignupLink(deps(db), { body: { linkId, token, organizationName: ' a ' }, user: ana }), { status: 400, code: 'bad-request', field: 'organizationName' });
  await db.collection('console_config').doc('settings').update({ billingAccount: '' });
  const after = db.paths('').length;
  assert.equal(after, before);
  await assert.rejects(redeemSignupLink(deps(db), { body: { linkId, token, ...REDEEM }, user: ana }), { status: 409, code: 'signups-closed' });
  assert.equal(db.paths('').length, before, 'no organization, member or draft');
  assert.equal(db.read(`signup_links/${linkId}`).status, 'open', 'the link can still be used');
});
