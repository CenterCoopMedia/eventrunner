'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { makeFakeStripe } = require('./fakes.cjs');
const { acceptAgreement, getAgreement, reopenApplication } = require('./agreementAcceptance.cjs');
const { agreementHash, saveAgreement } = require('./consoleSettings.cjs');
const { NOW, ana, applicationDoc, ben, fakeMailer, ops, quietLog, seededDb, signupTerms, validAnswers, zed } = require('./testData.cjs');

const NAME_HELD = { 'site_names/nclocal': { appId: 'a1', orgId: 'o1', reservedAt: new Date(NOW) } };
const ACCEPT = { orgId: 'o1', appId: 'a1', accept: true, name: 'Ana Owner', version: 1 };
const IDS = { orgId: 'o1', appId: 'a1' };

function ready(extra = {}) {
  return seededDb({ 'applications/a1': applicationDoc(), ...NAME_HELD, ...signupTerms(), ...extra });
}

function deps(db, more = {}) {
  return { db, mailer: fakeMailer(), log: quietLog(), now: () => NOW, publicUrl: 'https://console.example', ...more };
}

const accept = (d, body = ACCEPT, user = ana) => acceptAgreement(d, { body, user });
const records = (db) => db.paths('agreement_acceptances/').map((path) => ({ id: path.split('/')[1], ...db.read(path) }));

test('an Owner accepts: the answers freeze, the record is written and the request waits for payment', async () => {
  const db = ready();
  const mailer = fakeMailer();
  const result = await accept(deps(db, { mailer }));
  assert.equal(result.body.status, 'awaiting_payment');
  assert.equal(result.body.copySent, true);

  const [record] = records(db);
  const { title, body } = { title: 'Test agreement', body: 'First test paragraph.\n\nSecond test paragraph.' };
  assert.deepEqual(record, {
    id: result.body.acceptanceId,
    version: 1,
    sha256: agreementHash(title, body),
    typedName: 'Ana Owner',
    email: 'ana@example.org',
    uid: 'ana',
    orgId: 'o1',
    appId: 'a1',
    at: new Date(NOW),
  });

  const stored = db.read('applications/a1');
  assert.equal(stored.status, 'awaiting_payment');
  assert.deepEqual(stored.frozen, validAnswers());
  assert.deepEqual(stored.submittedAt, new Date(NOW));
  assert.equal(stored.submittedBy, 'ana');
  assert.deepEqual(stored.agreementAcceptance, {
    id: record.id, version: 1, sha256: record.sha256, name: 'Ana Owner', email: 'ana@example.org', at: new Date(NOW),
  });
  assert.deepEqual(stored.history.at(-1), { status: 'awaiting_payment', at: new Date(NOW), by: 'ana', note: null });

  const copy = mailer.sent.find((m) => m.kind === 'agreement');
  assert.equal(copy.to, 'ana@example.org');
  assert.equal(copy.body, body);
  assert.equal(copy.version, 1);
  assert.equal(copy.sha256, record.sha256);
  assert.equal(copy.typedName, 'Ana Owner');
  assert.ok(mailer.sent.some((m) => m.kind === 'status' && m.status === 'awaiting_payment'));
});

test('the email on the record comes from the sign-in, not the request', async () => {
  const db = ready();
  await accept(deps(db), { ...ACCEPT, email: 'forged@example.org', uid: 'forged', sha256: 'forged' });
  const [record] = records(db);
  assert.equal(record.email, 'ana@example.org');
  assert.equal(record.uid, 'ana');
  assert.notEqual(record.sha256, 'forged');
});

test('one Owner is enough to move on', async () => {
  const db = ready();
  assert.equal(db.paths('organizations/o1/members/').filter((p) => db.read(p).role === 'owner').length, 1);
  await accept(deps(db));
  assert.equal(db.read('applications/a1').status, 'awaiting_payment');
});

test('fail closed: with no agreement or no fee, the request stays and nothing is written', async () => {
  const terms = signupTerms();
  const missing = [
    { 'console_config/settings': { gcpFolder: 'folders/1' }, 'console_config/agreement': terms['console_config/agreement'] },
    { 'console_config/settings': terms['console_config/settings'] },
    { 'console_config/settings': terms['console_config/settings'], 'console_config/agreement': { ...terms['console_config/agreement'], body: 'Changed outside the console.' } },
  ];
  for (const extra of missing) {
    const db = seededDb({ 'applications/a1': applicationDoc(), ...NAME_HELD, ...extra });
    const mailer = fakeMailer();
    await assert.rejects(accept(deps(db, { mailer })), (err) => {
      assert.equal(err.status, 409);
      assert.equal(err.code, 'signups-closed');
      assert.match(err.message, /not taking sign-ups right now/);
      return true;
    });
    assert.equal(db.read('applications/a1').status, 'draft');
    assert.deepEqual(records(db), []);
    assert.equal(db.read('console_rate_limits/submit-app-ana'), undefined);
    assert.equal(mailer.sent.length, 0);
  }
});

test('a page showing an older version is told to read the new one', async () => {
  const db = ready();
  await saveAgreement({ db, now: () => NOW }, { body: { agreement: { title: 'Test agreement', body: 'A changed test paragraph.' } }, user: ops });
  await assert.rejects(accept(deps(db)), { status: 409, code: 'agreement-changed' });
  assert.equal(db.read('applications/a1').status, 'draft');
  assert.deepEqual(records(db), []);
  await accept(deps(db), { ...ACCEPT, version: 2 });
  assert.equal(records(db)[0].version, 2);
});

test('a typed name and an explicit accept are required', async () => {
  const db = ready();
  await assert.rejects(accept(deps(db), { ...ACCEPT, name: ' ' }), { status: 400, code: 'name-required', field: 'name' });
  await assert.rejects(accept(deps(db), { ...ACCEPT, name: undefined }), { code: 'name-required' });
  await assert.rejects(accept(deps(db), { ...ACCEPT, accept: 'yes' }), { status: 400, code: 'accept-required' });
  assert.equal(db.read('applications/a1').status, 'draft');
});

test('only an Owner accepts', async () => {
  const db = ready();
  await assert.rejects(accept(deps(db), ACCEPT, ben), { status: 403, message: 'Only an Owner can accept the agreement.' });
  await assert.rejects(accept(deps(db), ACCEPT, ops), { status: 404 });
  await assert.rejects(accept(deps(db), ACCEPT, zed), { status: 404 });
  assert.deepEqual(records(db), []);
});

test('the existing answer checks and rate limit still apply', async () => {
  const answers = validAnswers();
  answers.event.days = [];
  const incomplete = ready({ 'applications/a1': applicationDoc({ answers }) });
  await assert.rejects(accept(deps(incomplete)), (err) => {
    assert.equal(err.code, 'incomplete');
    assert.ok(err.fields['event.days']);
    return true;
  });
  const nameGone = ready({ 'site_names/nclocal': { appId: 'other', orgId: 'o2', reservedAt: new Date(NOW) } });
  await assert.rejects(accept(deps(nameGone)), (err) => {
    assert.match(err.fields['webAddress.name'], /Another event already uses this name/);
    return true;
  });
  const limited = ready({ 'console_rate_limits/submit-app-ana': { count: 5, windowStart: new Date(NOW - 1000) } });
  await assert.rejects(accept(deps(limited)), { status: 429, code: 'rate-limited' });
  for (const db of [incomplete, nameGone, limited]) assert.deepEqual(records(db), []);
});

test('only a draft can accept', async () => {
  for (const status of ['awaiting_payment', 'changes_requested', 'submitted', 'approved', 'withdrawn']) {
    const db = ready({ 'applications/a1': applicationDoc({ status }) });
    await assert.rejects(accept(deps(db)), { status: 409, code: 'locked' }, status);
    assert.deepEqual(records(db), []);
  }
});

test('a failed email does not undo the acceptance; it is logged', async () => {
  const db = ready();
  const log = quietLog();
  const result = await accept(deps(db, { mailer: fakeMailer({ fail: true }), log }));
  assert.equal(result.body.copySent, false);
  assert.equal(result.body.emailed, false);
  assert.equal(db.read('applications/a1').status, 'awaiting_payment');
  assert.equal(records(db).length, 1);
  assert.ok(log.errors.length >= 2);
});

test('going back to edit returns to draft, clears the pointer and keeps the record', async () => {
  const db = ready();
  const stripe = makeFakeStripe();
  await accept(deps(db));
  const before = records(db);
  const mailer = fakeMailer();
  const result = await reopenApplication(deps(db, { stripe, mailer }), { body: IDS, user: ana });
  assert.equal(result.body.status, 'draft');
  const stored = db.read('applications/a1');
  assert.equal(stored.status, 'draft');
  assert.equal(stored.agreementAcceptance, null);
  assert.equal(stored.feeCheckout, null);
  assert.equal(stored.frozen, null);
  assert.equal(stored.submittedAt, null);
  assert.deepEqual(stored.answers, validAnswers(), 'the answers stay');
  assert.deepEqual(stored.history.map((h) => h.status), ['draft', 'awaiting_payment', 'draft']);
  assert.deepEqual(records(db), before, 'the signed record is unchanged');
  assert.ok(db.read('site_names/nclocal'), 'the name stays held');
  assert.ok(mailer.sent.every((m) => m.status === 'draft'));

  await accept(deps(db));
  assert.equal(records(db).length, 2, 'accepting again adds a record');
  assert.equal(db.read('applications/a1').status, 'awaiting_payment');
});

test('going back closes an open payment page', async () => {
  const db = ready({ 'applications/a1': applicationDoc({ status: 'awaiting_payment', feeCheckout: { sessionId: 'cs_open' } }) });
  const stripe = makeFakeStripe();
  stripe.sessions.set('cs_open', { id: 'cs_open', status: 'open' });
  await reopenApplication(deps(db, { stripe }), { body: IDS, user: ana });
  assert.equal(stripe.sessions.get('cs_open').status, 'expired');
  assert.equal(db.read('applications/a1').status, 'draft');
});

test('after paying, or when the payment service cannot say, a request cannot go back', async () => {
  const paid = ready({ 'applications/a1': applicationDoc({ status: 'awaiting_payment', feeCheckout: { sessionId: 'cs_paid' } }) });
  const stripe = makeFakeStripe();
  stripe.sessions.set('cs_paid', { id: 'cs_paid', status: 'complete' });
  await assert.rejects(reopenApplication(deps(paid, { stripe }), { body: IDS, user: ana }), { status: 409, code: 'payment-received' });
  assert.equal(paid.read('applications/a1').status, 'awaiting_payment');

  const unknown = ready({ 'applications/a1': applicationDoc({ status: 'awaiting_payment', feeCheckout: { sessionId: 'cs_x' } }) });
  await assert.rejects(reopenApplication(deps(unknown, { stripe: makeFakeStripe({ down: true }) }), { body: IDS, user: ana }), { status: 502 });
  assert.equal(unknown.read('applications/a1').status, 'awaiting_payment');

  for (const status of ['draft', 'approved', 'withdrawn']) {
    const db = ready({ 'applications/a1': applicationDoc({ status }) });
    await assert.rejects(reopenApplication(deps(db, { stripe }), { body: IDS, user: ana }), { status: 409, code: 'locked' }, status);
  }
});

test('only an Owner goes back', async () => {
  const db = ready({ 'applications/a1': applicationDoc({ status: 'awaiting_payment' }) });
  await assert.rejects(reopenApplication(deps(db), { body: IDS, user: ben }), { status: 403 });
  assert.equal(db.read('applications/a1').status, 'awaiting_payment');
});

test('a member reads the current text, and after accepting the accepted version', async () => {
  const db = ready();
  const before = (await getAgreement({ db }, { body: IDS, user: ben })).body;
  assert.equal(before.agreement.version, 1);
  assert.equal(before.agreement.title, 'Test agreement');
  assert.equal(before.accepted, null);

  await accept(deps(db));
  await saveAgreement({ db, now: () => NOW }, { body: { agreement: { title: 'Test agreement', body: 'A changed test paragraph.' } }, user: ops });
  const after = (await getAgreement({ db }, { body: IDS, user: ben })).body;
  assert.equal(after.agreement.version, 1);
  assert.match(after.agreement.body, /First test paragraph/);
  assert.equal(after.accepted.name, 'Ana Owner');

  await assert.rejects(getAgreement({ db }, { body: IDS, user: zed }), { status: 404 });
});

test('with no agreement set, the read says so', async () => {
  const db = seededDb({ 'applications/a1': applicationDoc(), ...NAME_HELD });
  assert.equal((await getAgreement({ db }, { body: IDS, user: ana })).body.agreement, null);
});
