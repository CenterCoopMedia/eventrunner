'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { test } = require('node:test');
const { hostName } = require('./hostName.cjs');
const {
  EXPIRES_IN_DAYS, createLink, createSignupLink, getSignupLink, listSignupLinks, redeemSignupLink, revokeSignupLink,
} = require('./signupLinks.cjs');
const { listApplications } = require('./applications.cjs');
const { NOW, ana, applicationDoc, ben, cy, fakeMailer, ops, quietLog, seededDb, signupTerms } = require('./testData.cjs');

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
  assert.deepEqual(Object.keys(links[0]).sort(), ['appId', 'confirmationVersion', 'createdAt', 'expiresAt', 'id', 'orgId', 'organizationName', 'status', 'usedAt', 'usedEmail']);
  assert.match(links[0].confirmationVersion, /^[a-f0-9]{64}$/);
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
  assert.deepEqual((await getSignupLink(deps(db), { body: { linkId, token }, user: ana })).body, {
    organizationName: 'Example Press', status: 'open', organizations: [{ id: 'o1', name: 'NC Local' }],
  });
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

/** o1 has an older open request and a newer withdrawn one; o2, another organization, has the newest. */
function withRequests() {
  const answers = (website, address, replyTo) => {
    const a = applicationDoc().answers;
    return { ...a, organization: { ...a.organization, website, address }, email: { ...a.email, replyTo } };
  };
  return seededDb({
    ...signupTerms(),
    'applications/o1-first': applicationDoc({ status: 'launched', createdAt: new Date(NOW - 3000), answers: answers('first.example', '1 First St', 'first@example.org') }),
    'applications/o1-withdrawn': applicationDoc({ status: 'withdrawn', createdAt: new Date(NOW - 2000), answers: answers('withdrawn.example', '2 Gone St', 'gone@example.org') }),
    'applications/o2-newest': applicationDoc({ orgId: 'o2', createdBy: 'cy', createdAt: new Date(NOW - 1000), answers: answers('other.example', '9 Other St', 'other@example.org') }),
  });
}

test('the link lists only the organizations the signed-in person is an Owner of', async () => {
  const db = withRequests();
  const { linkId, token } = await made(db);
  const listed = async (user) => (await getSignupLink(deps(db), { body: { linkId, token }, user })).body.organizations;
  assert.deepEqual(await listed(ana), [{ id: 'o1', name: 'NC Local' }]);
  assert.deepEqual(await listed(ben), [], 'an Editor is not offered the organization');
  assert.deepEqual(await listed(cy), [{ id: 'o2', name: 'Org two' }]);
  assert.deepEqual(await listed({ uid: 'newbie', email: 'new@example.org' }), []);
});

test('an Owner adds the event to their organization, which carries answers from its own latest open request only', async () => {
  const db = withRequests();
  const { linkId, token } = await made(db);
  const organizations = orgsBefore(db);
  const result = await redeemSignupLink(deps(db), { body: { linkId, token, orgId: 'o1', organizationName: 'Ignored', timezone: 'America/Chicago' }, user: ana });
  assert.equal(result.status, 201);
  const { orgId, appId } = result.body;
  assert.equal(orgId, 'o1');
  assert.equal(orgsBefore(db), organizations, 'no new organization');
  assert.deepEqual(db.paths('organizations/o1/members/'), ['organizations/o1/members/ana', 'organizations/o1/members/ben'], 'the team is unchanged');
  const app = db.read(`applications/${appId}`);
  assert.equal(app.orgId, 'o1');
  assert.equal(app.status, 'draft');
  assert.equal(app.signupLinkId, linkId);
  assert.deepEqual(app.answers.organization, { name: 'NC Local', website: 'first.example', address: '1 First St' });
  assert.equal(app.answers.email.replyTo, 'first@example.org');
  assert.equal(app.answers.email.senderName, '');
  assert.equal(app.answers.event.name, '', 'event answers start empty');
  assert.equal(app.answers.event.timezone, 'America/Chicago');
  const text = JSON.stringify(app.answers);
  for (const other of ['other.example', '9 Other St', 'other@example.org', 'withdrawn.example', 'gone@example.org']) {
    assert.ok(!text.includes(other), `${other} is not carried`);
  }
  const link = db.read(`signup_links/${linkId}`);
  assert.equal(link.status, 'used');
  assert.equal(link.orgId, 'o1');
  assert.equal(link.appId, appId);
  const { applications } = (await listApplications(deps(db), { body: { orgId: 'o1' }, user: ben })).body;
  assert.ok(applications.some((r) => r.id === appId), 'the existing Editor sees the new event without an invite');

  const again = await redeemSignupLink(deps(db), { body: { linkId, token, orgId: 'o1' }, user: ana });
  assert.equal(again.status, 200);
  assert.deepEqual(again.body, result.body);
});

test('an organization with no open request carries nothing', async () => {
  const db = seededDb({ ...signupTerms(), 'applications/gone': applicationDoc({ status: 'declined' }) });
  const { linkId, token } = await made(db);
  const { appId } = (await redeemSignupLink(deps(db), { body: { linkId, token, orgId: 'o1' }, user: ana })).body;
  const { answers } = db.read(`applications/${appId}`);
  assert.deepEqual(answers.organization, { name: 'NC Local', website: '', address: '' });
  assert.equal(answers.email.replyTo, '');
});

test('only a current Owner can add the event to an organization, and a refusal leaves the link open', async () => {
  const db = withRequests();
  const { linkId, token } = await made(db);
  const before = db.paths('').length;
  const redeem = (orgId, user) => redeemSignupLink(deps(db), { body: { linkId, token, orgId, ...REDEEM }, user });
  await assert.rejects(redeem('o1', ben), { status: 403, code: 'forbidden', message: /Only an Owner/ });
  await assert.rejects(redeem('o1', cy), { status: 404 }, 'an Owner of another organization reads it as missing');
  await assert.rejects(redeem('o2', ana), { status: 404 });
  await assert.rejects(redeem('nope', ana), { status: 404 });
  await assert.rejects(redeem('a/b', ana), { status: 400 });
  await assert.rejects(redeem(42, ana), { status: 400 });
  await db.collection('organizations').doc('o1').collection('members').doc('ana').delete();
  await assert.rejects(redeem('o1', ana), { status: 404 }, 'a removed Owner is refused');
  assert.equal(db.paths('').length, before - 1, 'only the removed membership is gone');
  assert.equal(db.read(`signup_links/${linkId}`).status, 'open');
  assert.deepEqual(db.paths('applications/'), ['applications/o1-first', 'applications/o1-withdrawn', 'applications/o2-newest']);
});

test('a refusal names the person the deployment names, or the team', () => {
  assert.equal(hostName({}), 'the hosting team');
  assert.equal(hostName({ CONSOLE_HELP_NAME: '  Sam Host ' }), 'Sam Host');
});
