'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { acceptAgreement, getAgreement } = require('./agreementAcceptance.cjs');
const { agreementHash, saveAgreement } = require('./consoleSettings.cjs');
const { NOW, ana, applicationDoc, ben, fakeMailer, ops, quietLog, seededDb, signupTerms, stripeConnection, validAnswers, zed } = require('./testData.cjs');

const NAME_HELD = { 'site_names/nclocal': { appId: 'a1', orgId: 'o1', reservedAt: new Date(NOW) } };
const ACCEPT = { orgId: 'o1', appId: 'a1', accept: true, name: 'Ana Owner', legalName: 'NC Local Inc.', title: 'Director', version: 1 };
const IDS = { orgId: 'o1', appId: 'a1' };

function ready(extra = {}) {
  return seededDb({ 'applications/a1': applicationDoc(), ...NAME_HELD, ...signupTerms(), ...extra });
}

function deps(db, more = {}) {
  return { db, mailer: fakeMailer(), log: quietLog(), now: () => NOW, publicUrl: 'https://console.example', startBuild: async () => {}, ...more };
}

const accept = (d, body = ACCEPT, user = ana) => acceptAgreement(d, { body, user });
const records = (db) => db.paths('agreement_acceptances/').map((path) => ({ id: path.split('/')[1], ...db.read(path) }));

test('an Owner accepts: the answers freeze, the record is written and the build starts', async () => {
  const db = ready();
  const mailer = fakeMailer();
  const result = await accept(deps(db, { mailer }));
  assert.equal(result.body.status, 'approved');
  assert.equal(result.body.copySent, true);
  assert.equal(result.body.emailed, true);
  assert.equal(result.body.buildStarted, true);

  const [record] = records(db);
  const { title, body } = { title: 'Test agreement', body: 'First test paragraph.\n\nSecond test paragraph.' };
  assert.deepEqual(record, {
    id: result.body.acceptanceId,
    version: 1,
    sha256: agreementHash(title, body),
    typedName: 'Ana Owner',
    legalName: 'NC Local Inc.',
    title: 'Director',
    email: 'ana@example.org',
    uid: 'ana',
    orgId: 'o1',
    appId: 'a1',
    at: new Date(NOW),
  });

  const stored = db.read('applications/a1');
  assert.equal(stored.status, 'approved');
  assert.deepEqual(stored.frozen, validAnswers());
  assert.deepEqual(stored.buildStart, { state: 'started', at: new Date(NOW) });
  assert.deepEqual(stored.submittedAt, new Date(NOW));
  assert.equal(stored.submittedBy, 'ana');
  assert.deepEqual(stored.agreementAcceptance, {
    id: record.id, version: 1, sha256: record.sha256, name: 'Ana Owner', legalName: 'NC Local Inc.', title: 'Director', email: 'ana@example.org', at: new Date(NOW),
  });
  assert.deepEqual(stored.history.at(-1), { status: 'approved', at: new Date(NOW), by: 'ana', note: null });

  const copy = mailer.sent.find((m) => m.kind === 'agreement');
  assert.equal(copy.to, 'ana@example.org');
  assert.equal(copy.body, body);
  assert.equal(copy.version, 1);
  assert.equal(copy.sha256, record.sha256);
  assert.equal(copy.typedName, 'Ana Owner');
  assert.ok(mailer.sent.some((m) => m.kind === 'status' && m.status === 'approved'));
  const notice = mailer.sent.find((m) => m.kind === 'operator');
  assert.equal(notice.noticeKind, 'started');
  assert.equal(notice.organizationName, 'NC Local');
  assert.equal(notice.eventName, 'NC Local News Summit');
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
  assert.equal(db.read('applications/a1').status, 'approved');
});

test('fail closed: with no agreement or a setting missing, the request stays and nothing is written', async () => {
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
  await assert.rejects(accept(deps(db), { ...ACCEPT, legalName: ' ' }), { status: 400, code: 'legalName-required', field: 'legalName' });
  await assert.rejects(accept(deps(db), { ...ACCEPT, title: undefined }), { status: 400, code: 'title-required', field: 'title' });
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
  for (const status of ['approved', 'building', 'withdrawn', 'declined']) {
    const db = ready({ 'applications/a1': applicationDoc({ status }) });
    await assert.rejects(accept(deps(db)), { status: 409, code: 'locked' }, status);
    assert.deepEqual(records(db), []);
  }
});

test('a failed email does not undo the acceptance or lose the build; it is logged', async () => {
  const db = ready();
  const log = quietLog();
  const started = [];
  const result = await accept(deps(db, { mailer: fakeMailer({ fail: true }), log, startBuild: async (input) => started.push(input) }));
  assert.equal(result.body.copySent, false);
  assert.equal(result.body.emailed, false);
  assert.equal(result.body.buildStarted, true);
  assert.deepEqual(started, [{ orgId: 'o1', appId: 'a1' }]);
  assert.equal(db.read('applications/a1').status, 'approved');
  assert.equal(records(db).length, 1);
  assert.ok(log.errors.length >= 2);
});

test('the build starts before any email goes out', async () => {
  const db = ready();
  const mailer = fakeMailer();
  let sentAtStart = null;
  await accept(deps(db, { mailer, startBuild: async () => { sentAtStart = mailer.sent.length; } }));
  assert.equal(sentAtStart, 0);
});

test('a failed start still accepts: the client is told through the status, not an error', async () => {
  const db = ready();
  const mailer = fakeMailer();
  const result = await accept(deps(db, { mailer, startBuild: async () => { throw new Error('dispatch down'); } }));
  assert.equal(result.body.status, 'approved');
  assert.equal(result.body.buildStarted, false);
  assert.equal(result.body.copySent, true);
  const stored = db.read('applications/a1');
  assert.equal(stored.status, 'approved');
  assert.equal(stored.buildStart.state, 'failed');
  assert.equal(records(db).length, 1);
  assert.ok(mailer.sent.some((m) => m.kind === 'status' && m.status === 'build-failed'));
  assert.ok(!mailer.sent.some((m) => m.kind === 'status' && m.status === 'approved'));
  assert.ok(!mailer.sent.some((m) => m.noticeKind === 'started'));
});

test('a throw from one step after the commit does not skip the next', async () => {
  const db = ready();
  const mailer = fakeMailer();
  mailer.sendAgreementCopy = async () => { throw new Error('provider down'); };
  const result = await accept(deps(db, { mailer }));
  assert.equal(result.body.copySent, false);
  assert.ok(mailer.sent.some((m) => m.kind === 'status'));
  assert.ok(mailer.sent.some((m) => m.kind === 'operator'));
});

test('a connection dropped since the first check refuses inside the transaction', async () => {
  const db = ready();
  const realTransaction = db.runTransaction.bind(db);
  db.runTransaction = async (work) => {
    db.runTransaction = realTransaction;
    await db.collection('applications').doc('a1').update({ connections: {} });
    return realTransaction(work);
  };
  await assert.rejects(accept(deps(db)), (err) => {
    assert.ok(err.fields['tickets.connection']);
    return true;
  });
  assert.equal(db.read('applications/a1').status, 'draft');
  assert.deepEqual(records(db), []);
});

test('a test-mode ticket account cannot accept on a live console, and can on a rehearsal one', async () => {
  const testAccount = { connections: { stripe: stripeConnection({ livemode: false }) } };
  const live = ready({ 'applications/a1': applicationDoc(testAccount) });
  const started = [];
  await assert.rejects(accept(deps(live, { startBuild: async (input) => started.push(input) })), (err) => {
    assert.match(err.fields['tickets.connection'], /test mode/);
    return true;
  });
  assert.equal(live.read('applications/a1').status, 'draft');
  assert.deepEqual(started, []);

  const rehearsal = ready({ 'applications/a1': applicationDoc(testAccount) });
  await accept(deps(rehearsal, { consoleTestMode: true }));
  assert.equal(rehearsal.read('applications/a1').status, 'approved');
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

test('legacy, quarantined, forged and mismatched signup provenance cannot approve or dispatch', async () => {
  for (const extra of [
    { 'applications/a1': applicationDoc({ signupLinkId: null }) },
    { 'applications/a1': applicationDoc({ legacyQuarantined: true }) },
    { 'applications/a1': applicationDoc({ signupLinkId: 'missing' }) },
    ...[
      { status: 'open' }, { orgId: 'other' }, { appId: 'other' }, { usedBy: 'other' },
    ].map((patch) => ({ 'signup_links/paid-o1': { status: 'used', orgId: 'o1', appId: 'a1', usedBy: 'ana', ...patch } })),
  ]) {
    const db = ready(extra);
    let dispatched = false;
    await assert.rejects(accept(deps(db, { startBuild: async () => { dispatched = true; } })), { code: 'signup-link-required' });
    assert.equal(dispatched, false);
    assert.equal(db.read('applications/a1').status, 'draft');
    assert.deepEqual(records(db), []);
  }
});
