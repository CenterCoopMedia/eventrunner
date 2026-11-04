'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { submitApplication, withdrawApplication } = require('./applicationStatus.cjs');
const { makeFakeStripe } = require('./fakes.cjs');
const { NOW, ana, applicationDoc, ben, fakeMailer, ops, quietLog, seededDb, validAnswers } = require('./testData.cjs');

const PUBLIC_URL = 'https://console.eventrunner.org';
const SECOND_OWNER = { 'organizations/o1/members/dee': { uid: 'dee', email: 'dee@example.org', role: 'owner' } };
const NAME_HELD = { 'site_names/nclocal': { appId: 'a1', orgId: 'o1', reservedAt: new Date(NOW) } };

// A send now goes back to the hosting team after they asked for changes.
function ready(extra = {}) {
  return seededDb({ 'applications/a1': applicationDoc({ status: 'changes_requested' }), ...SECOND_OWNER, ...NAME_HELD, ...extra });
}

function deps(db, mailer = fakeMailer(), log = quietLog()) {
  return { db, mailer, log, now: () => NOW, publicUrl: PUBLIC_URL };
}

const submit = (d, user = ana) => submitApplication(d, { body: { orgId: 'o1', appId: 'a1' }, user });
const withdraw = (d, user = ana) => withdrawApplication(d, { body: { orgId: 'o1', appId: 'a1' }, user });

test('a new request cannot be sent around the agreement', async () => {
  const db = ready({ 'applications/a1': applicationDoc() });
  await assert.rejects(submit(deps(db)), { status: 409, code: 'agreement-required' });
  assert.equal(db.read('applications/a1').status, 'draft');
  assert.equal(db.read('applications/a1').frozen, null);
});

test('an Owner sends a complete request: the answers freeze, the status and history change, and email goes out', async () => {
  const db = ready();
  const mailer = fakeMailer();
  const result = await submit(deps(db, mailer));
  assert.deepEqual(result.body, { status: 'submitted', submittedAt: new Date(NOW).toISOString(), emailed: true });
  const stored = db.read('applications/a1');
  assert.equal(stored.status, 'submitted');
  assert.deepEqual(stored.frozen, validAnswers());
  assert.deepEqual(stored.submittedAt, new Date(NOW));
  assert.equal(stored.submittedBy, 'ana');
  assert.equal(stored.updatedBy, 'ana');
  assert.deepEqual(stored.history.at(-1), { status: 'submitted', at: new Date(NOW), by: 'ana', note: null });
  assert.equal(stored.history.length, 2);

  const link = `${PUBLIC_URL}/organizations/o1/applications/a1`;
  const toOwners = mailer.sent.filter((m) => m.kind === 'status');
  assert.deepEqual(toOwners.map((m) => m.to).sort(), ['ana@example.org', 'dee@example.org']);
  assert.deepEqual(toOwners[0], {
    kind: 'status', to: toOwners[0].to, organizationName: 'NC Local', eventName: 'NC Local News Summit',
    status: 'submitted', link, note: null,
  });
  const toOperators = mailer.sent.filter((m) => m.kind === 'operator');
  assert.deepEqual(toOperators.map((m) => m.to), ['ops@ccm.example', 'two@ccm.example']);
  assert.equal(toOperators[0].link, `${PUBLIC_URL}/review/a1`, 'operators open the review page');
});

test('only an Owner sends', async () => {
  const db = ready();
  await assert.rejects(submit(deps(db), ben), { status: 403, message: 'Only an Owner can send the request.' });
  await assert.rejects(submit(deps(db), ops), { status: 404 });
  assert.equal(db.read('applications/a1').status, 'changes_requested');
});

test('a team with one Owner can send: the second Owner is a launch check', async () => {
  const db = seededDb({ 'applications/a1': applicationDoc({ status: 'changes_requested' }), ...NAME_HELD });
  await submit(deps(db));
  assert.equal(db.read('applications/a1').status, 'submitted');
});

test('every step must pass; the refusal lists the fields', async () => {
  const answers = validAnswers();
  answers.event.days = [];
  answers.tickets.choice = null;
  const db = ready({ 'applications/a1': applicationDoc({ answers, status: 'changes_requested' }) });
  const mailer = fakeMailer();
  await assert.rejects(submit(deps(db, mailer)), (err) => {
    assert.equal(err.status, 400);
    assert.equal(err.code, 'incomplete');
    assert.deepEqual(Object.keys(err.fields).sort(), ['event.days', 'tickets.choice']);
    return true;
  });
  assert.equal(db.read('applications/a1').status, 'changes_requested');
  assert.equal(mailer.sent.length, 0);
  assert.equal(db.read('console_rate_limits/submit-app-ana'), undefined, 'a refused send does not use a slot');
});

test('the web-address name must still be held by this request', async () => {
  const db = ready({ 'site_names/nclocal': { appId: 'other', orgId: 'o2', reservedAt: new Date(NOW) } });
  await assert.rejects(submit(deps(db)), (err) => {
    assert.match(err.fields['webAddress.name'], /Another event already uses this name/);
    return true;
  });
});

test('a sent request cannot be sent again; one with changes requested can', async () => {
  const sent = ready({ 'applications/a1': applicationDoc({ status: 'submitted' }) });
  await assert.rejects(submit(deps(sent)), { status: 409, code: 'locked' });
  const changes = ready({ 'applications/a1': applicationDoc({ status: 'changes_requested' }) });
  await submit(deps(changes));
  assert.equal(changes.read('applications/a1').status, 'submitted');
});

test('five sends a day for one account', async () => {
  const db = ready({ 'console_rate_limits/submit-app-ana': { count: 5, windowStart: new Date(NOW - 1000) } });
  await assert.rejects(submit(deps(db)), { status: 429, code: 'rate-limited' });
  assert.equal(db.read('applications/a1').status, 'changes_requested');
});

test('a failed email does not undo the send; it is logged', async () => {
  const db = ready();
  const log = quietLog();
  const result = await submit(deps(db, fakeMailer({ fail: true }), log));
  assert.equal(result.body.emailed, false);
  assert.equal(db.read('applications/a1').status, 'submitted');
  assert.ok(log.errors.length >= 1);
});

test('an Owner withdraws before approval: the status changes and the name is released', async () => {
  for (const status of ['draft', 'awaiting_payment', 'submitted', 'changes_requested']) {
    const db = ready({ 'applications/a1': applicationDoc({ status }) });
    const mailer = fakeMailer();
    const result = await withdraw(deps(db, mailer));
    assert.equal(result.body.status, 'withdrawn');
    const stored = db.read('applications/a1');
    assert.equal(stored.status, 'withdrawn');
    assert.deepEqual(stored.history.at(-1), { status: 'withdrawn', at: new Date(NOW), by: 'ana', note: null });
    assert.deepEqual(db.paths('site_names/'), [], status);
    assert.ok(mailer.sent.every((m) => m.kind === 'status' && m.status === 'withdrawn'));
    assert.equal(mailer.sent.length, 2);
  }
});

test('withdraw is refused after approval, for a closed request, and for an Editor', async () => {
  for (const status of ['approved', 'building', 'ready', 'launched', 'withdrawn', 'declined']) {
    const db = ready({ 'applications/a1': applicationDoc({ status }) });
    await assert.rejects(withdraw(deps(db)), { status: 409 }, status);
    assert.ok(db.read('site_names/nclocal'), 'the name stays');
  }
  await assert.rejects(withdraw(deps(ready()), ben), { status: 403 });
});

test('a withdrawal closes an open payment page, and a paid one refuses it', async () => {
  const stripe = makeFakeStripe();
  stripe.sessions.set('cs_open', { id: 'cs_open', status: 'open' });
  stripe.sessions.set('cs_paid', { id: 'cs_paid', status: 'complete' });
  const held = (sessionId) => ready({ 'applications/a1': applicationDoc({ status: 'awaiting_payment', feeCheckout: { sessionId } }) });

  const open = held('cs_open');
  await withdraw({ ...deps(open), stripe });
  assert.equal(open.read('applications/a1').status, 'withdrawn');
  assert.equal(stripe.sessions.get('cs_open').status, 'expired');

  const paid = held('cs_paid');
  await assert.rejects(withdraw({ ...deps(paid), stripe }), { status: 409, code: 'payment-received' });
  assert.equal(paid.read('applications/a1').status, 'awaiting_payment');
  assert.ok(paid.read('site_names/nclocal'), 'the name stays');
});
