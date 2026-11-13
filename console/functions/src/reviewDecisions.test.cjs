'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { closeApplication, declineApplication, launchApplication } = require('./reviewDecisions.cjs');
const { makeFakeConnector, makeFakeSecrets } = require('./fakes.cjs');
const { NOW, PUBLIC_URL, ana, application, deps, fakeMailer, ops, ops2, seeded } = require('./fakeReview.cjs');

const DRAFT = { status: 'draft', frozen: null };
const draft = (extra = {}) => seeded({ 'applications/a1': application(DRAFT), ...extra });
const decline = (d, note = 'Not an event.', user = ops, appId = 'a1') => declineApplication(d, { body: { appId, revision: 2, note }, user });

test('declineApplication closes a draft, keeps the note, frees the name and emails each Owner', async () => {
  const db = draft();
  const d = deps(db);
  const result = await decline(d, '  Not an event.  ');
  assert.deepEqual(result.body, { application: { id: 'a1', status: 'declined' }, emailed: 2, mailFailed: false });
  const app = db.read('applications/a1');
  assert.equal(app.status, 'declined');
  assert.equal(app.updatedBy, 'ops');
  assert.equal(app.history.length, 3, 'appended, oldest first');
  assert.deepEqual(app.history.at(-1), { status: 'declined', at: new Date(NOW), by: 'ops', note: 'Not an event.' });
  assert.deepEqual(app.review, { note: 'Not an event.', by: 'ops', at: new Date(NOW), settings: null });
  assert.equal(db.read('site_names/nclocal'), undefined, 'the name is free again');
  assert.deepEqual(d.mailer.sent.map((m) => m.to).sort(), ['ana@example.org', 'bo@example.org'], 'Owners only, not the Editor');
  assert.deepEqual(d.mailer.sent[0], {
    to: d.mailer.sent[0].to,
    organizationName: 'NC Local',
    eventName: 'NC Local Summit',
    status: 'declined',
    note: 'Not an event.',
    link: `${PUBLIC_URL}/organizations/o1/applications/a1`,
  });
});

test('a note is required and has at most 2,000 characters', async () => {
  const db = draft();
  await assert.rejects(decline(deps(db), '   '), { status: 400, code: 'note-required' });
  await assert.rejects(declineApplication(deps(db), { body: { appId: 'a1', revision: 2 }, user: ops }), { status: 400, code: 'note-required' });
  await assert.rejects(decline(deps(db), 'x'.repeat(2001)), { status: 400, code: 'note-too-long' });
  await decline(deps(db), 'x'.repeat(2000));
  assert.equal(db.read('applications/a1').status, 'declined');
});

test('only a draft can be declined: a build is under way after that', async () => {
  for (const status of ['approved', 'building', 'ready', 'launched', 'withdrawn', 'declined']) {
    const db = seeded({ 'applications/a1': application({ status }) });
    await assert.rejects(decline(deps(db)), { status: 409, code: 'status-changed' }, status);
    assert.ok(db.read('site_names/nclocal'), 'the name stays');
  }
});

test('two operators cannot act twice: the second gets status-changed and nothing more is written or sent', async () => {
  const db = draft();
  const second = deps(db);
  await decline(deps(db));
  await assert.rejects(decline(second, 'Two', ops2), { status: 409, code: 'status-changed' });
  assert.equal(db.read('applications/a1').history.length, 3);
  assert.equal(second.mailer.sent.length, 0);
});

test('a decision on a page opened before the request changed is refused', async () => {
  const db = draft();
  const app = db.read('applications/a1');
  await db.collection('applications').doc('a1').update({
    history: [...app.history, { status: 'draft', at: new Date(NOW), by: 'ana', note: null }],
  });
  await assert.rejects(decline(deps(db)), { status: 409, code: 'status-changed' });
  assert.equal(db.read('applications/a1').status, 'draft');
  await declineApplication(deps(db), { body: { appId: 'a1', revision: 3, note: 'No.' }, user: ops });
  assert.equal(db.read('applications/a1').status, 'declined');
});

test('a decision needs the revision the operator saw', async () => {
  const db = draft();
  for (const revision of [undefined, -1, 1.5, '2']) {
    await assert.rejects(declineApplication(deps(db), { body: { appId: 'a1', revision, note: 'n' }, user: ops }), { status: 400, code: 'bad-request' });
  }
  assert.equal(db.read('applications/a1').status, 'draft');
});

test('a client cannot decide on a request', async () => {
  const db = draft();
  await assert.rejects(decline(deps(db), 'n', ana), { status: 403, code: 'not-operator' });
  assert.equal(db.read('applications/a1').status, 'draft');
});

test('declining keeps a name that another request holds', async () => {
  const db = draft({ 'site_names/nclocal': { appId: 'someone-else', orgId: 'o9' } });
  await decline(deps(db), 'No.');
  assert.deepEqual(db.read('site_names/nclocal'), { appId: 'someone-else', orgId: 'o9' });
});

test('declining frees the name in the live answers of a draft', async () => {
  const live = { ...application().answers, webAddress: { name: 'nclocal2' } };
  const db = seeded({
    'applications/a1': application({ ...DRAFT, answers: live }),
    'site_names/nclocal2': { appId: 'a1', orgId: 'o1' },
  });
  await decline(deps(db), 'No.');
  assert.equal(db.read('site_names/nclocal2'), undefined);
});

test('a failed email does not undo the decision, and the answer says so', async () => {
  const db = draft();
  const logged = [];
  const result = await decline(deps(db, { mailer: fakeMailer({ fail: true }), log: { info() {}, error: (...a) => logged.push(a) } }));
  assert.equal(result.body.mailFailed, true);
  assert.equal(result.body.emailed, 0);
  assert.equal(db.read('applications/a1').status, 'declined');
  assert.equal(logged.length, 2, 'one log line for each failed Owner');
});

test('one refused address does not stop the email to the other Owners', async () => {
  const db = draft();
  const mailer = fakeMailer();
  const send = mailer.sendStatusChange.bind(mailer);
  mailer.sendStatusChange = async (message) => {
    if (message.to === 'ana@example.org') throw new Error('recipient refused');
    return send(message);
  };
  const result = await decline(deps(db, { mailer }));
  assert.equal(result.body.emailed, 1);
  assert.equal(result.body.mailFailed, true);
  assert.deepEqual(mailer.sent.map((m) => m.to), ['bo@example.org']);
});

test('a missing request is a 404', async () => {
  await assert.rejects(decline(deps(draft()), 'n', ops, 'nope'), { status: 404 });
});

const FAILED = { status: 'building', buildStart: { state: 'started', at: new Date(NOW - 1000) } };
const closeDb = (app = FAILED, record = { state: 'failed' }) => seeded({
  'applications/a1': application(app),
  'console_builds/a1': record,
  'console_connections/a1': { stripe: { accountId: 'acct_1' } },
});
const closeDeps = (db) => ({ ...deps(db), secrets: makeFakeSecrets(), log: { error() {} } });
const close = (d, user = ops, body = {}) => closeApplication(d, { body: { appId: 'a1', revision: 2, note: 'Wrong person.', ...body }, user });

test('closeApplication closes an accepted request whose build stopped', async () => {
  const db = closeDb();
  const d = closeDeps(db);
  const result = await close(d);
  assert.equal(result.body.application.status, 'declined');
  const app = db.read('applications/a1');
  assert.equal(app.status, 'declined');
  assert.deepEqual(app.connections, {});
  assert.equal(app.review.note, 'Wrong person.');
  assert.ok(db.read('site_names/nclocal'), 'a run may have made its project, so the name stays taken');
  assert.equal(db.read('console_connections/a1'), undefined);
  assert.equal(db.read('console_token_deletions/a1'), undefined, 'the tokens went, so no row is left');
  assert.ok(d.mailer.sent.every((m) => m.status === 'declined'));
  assert.ok(db.paths('console_audit/').some((p) => db.read(p).action === 'close-request'));
});

test('closing a failed build releases its own Stripe route and preserves another application\'s route', async () => {
  for (const routeOwner of ['a1', 'a2']) {
    const db = closeDb();
    const route = { appId: routeOwner, projectId: 'er-first', region: 'us-central1' };
    await db.doc('console_stripe_routes/acct_1').set(route);
    const stripe = makeFakeConnector();
    const d = { ...closeDeps(db), connectors: { stripe } };
    assert.equal((await close(d)).body.application.status, 'declined');
    assert.deepEqual(stripe.revoked, routeOwner === 'a1' ? ['acct_1'] : []);
    assert.deepEqual(db.read('console_stripe_routes/acct_1'), routeOwner === 'a1' ? undefined : route);
    assert.equal(db.read('console_connections/a1'), undefined);
    assert.equal(db.read('console_token_deletions/a1'), undefined);
  }
});

test('closeApplication frees the name when no run ever began', async () => {
  const db = closeDb({ ...FAILED, buildStart: { state: 'failed', at: new Date(NOW) } });
  await db.doc('console_builds/a1').delete();
  await close(closeDeps(db));
  assert.equal(db.read('site_names/nclocal'), undefined);
});

test('closeApplication refuses while a run may be alive, and leaves everything alone', async () => {
  for (const record of [{ state: 'queued' }, { state: 'running', startedAt: new Date(NOW - 1000) }]) {
    const db = closeDb({ ...FAILED }, record);
    await assert.rejects(close(closeDeps(db)), { status: 409, code: 'build-running' });
    assert.equal(db.read('applications/a1').status, 'building');
    assert.ok(db.read('console_connections/a1'));
  }
});

test('closeApplication is for operators, on an accepted request the page still shows', async () => {
  await assert.rejects(close(closeDeps(closeDb()), ana), { status: 403 });
  await assert.rejects(close(closeDeps(closeDb()), ops, { revision: 1 }), { status: 409, code: 'status-changed' });
  await assert.rejects(close(closeDeps(closeDb({ status: 'ready' }))), { status: 409, code: 'status-changed' });
});

// The Launch action (state machine plan S1b): the hosting team marks a ready
// site as open to the public. Nothing set 'launched' before this.
const READY = { status: 'ready' };
const launch = (d, { user = ops, revision = 2 } = {}) => launchApplication(d, { body: { appId: 'a1', revision }, user });

test('launchApplication moves a ready site to launched, keeps its name and emails each Owner', async () => {
  const db = seeded({ 'applications/a1': application(READY) });
  const d = deps(db);
  const result = await launch(d);
  assert.deepEqual(result.body, { application: { id: 'a1', status: 'launched' }, emailed: 2, mailFailed: false });
  const app = db.read('applications/a1');
  assert.equal(app.status, 'launched');
  assert.deepEqual(app.history.at(-1), { status: 'launched', at: new Date(NOW), by: 'ops', note: null });
  assert.ok(db.read('site_names/nclocal'), 'a launched site keeps its address');
  assert.deepEqual(d.mailer.sent.map((m) => m.status), ['launched', 'launched']);
});

test('only a ready site can be launched, only by the hosting team, and only from the page the operator saw', async () => {
  for (const status of ['draft', 'approved', 'building', 'launched', 'withdrawn', 'declined', 'archived']) {
    const db = seeded({ 'applications/a1': application({ status }) });
    await assert.rejects(launch(deps(db)), { status: 409, code: 'status-changed' }, status);
    assert.equal(db.read('applications/a1').status, status);
  }
  const db = seeded({ 'applications/a1': application(READY) });
  await assert.rejects(launch(deps(db), { user: ana }), { status: 403 });
  await assert.rejects(launch(deps(db), { revision: 1 }), { status: 409, code: 'status-changed' });
  assert.equal(db.read('applications/a1').status, 'ready');
});
