'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  approvalDefaults, checkSettings, environmentFor, getConsoleSettings, normalizeBilling, normalizeFolder,
  normalizeProjectId, projectIdFor, readSignupTerms, saveAgreement, saveConsoleSettings, saveEventFee, APPROVAL_FIELDS,
} = require('./consoleSettings.cjs');
const { NOW, ana, ops, seeded } = require('./fakeReview.cjs');

const PROJECT_ID_RULE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

test('projectIdFor makes er-<name> and always meets the project-id rules', () => {
  assert.equal(projectIdFor('nclocal'), 'er-nclocal');
  assert.equal(environmentFor('nclocal'), 'nclocal');
  for (const name of ['a', 'ab', 'nc', 'x'.repeat(40), 'abc-def-ghi-jkl-mno-pqr-stu-vwx', 'a-b-c-d-e-f-g-h-i-j-k-l-m-n-o-', 'NCLocal']) {
    const id = projectIdFor(name);
    assert.match(id, PROJECT_ID_RULE, `${name} -> ${id}`);
    assert.ok(id.length >= 6 && id.length <= 30, id);
    assert.ok(!id.endsWith('-'), id);
  }
  assert.equal(projectIdFor('ab'), 'er-ab-site');
});

test('normalizeProjectId follows the GCP rules', () => {
  for (const good of ['er-nclocal', 'abcdef', `a${'b'.repeat(29)}`]) assert.equal(normalizeProjectId(good), good, good);
  for (const bad of ['abcde', `a${'b'.repeat(30)}`, '1abcdef', 'Er-nclocal', 'er-nclocal-', 'er_nclocal', '', null]) {
    assert.equal(normalizeProjectId(bad), null, String(bad));
  }
});

test('the folder and billing account accept the forms people paste, and store one form', () => {
  assert.equal(normalizeFolder('123456789012'), 'folders/123456789012');
  assert.equal(normalizeFolder(' folders/123456789012 '), 'folders/123456789012');
  assert.equal(normalizeFolder('folders/abc'), null);
  assert.equal(normalizeBilling('billingAccounts/012345-6789ab-cdef01'), '012345-6789AB-CDEF01');
  assert.equal(normalizeBilling('012345-6789AB'), null);
});

test('checkSettings uses the default, lets the operator change it, and names a bad field', () => {
  const defaults = approvalDefaults({ gcpFolder: 'folders/123456789012', billingAccount: '012345-6789AB-CDEF01', region: 'us-central1' }, 'nclocal');
  assert.deepEqual(checkSettings(APPROVAL_FIELDS, defaults), {
    gcpFolder: 'folders/123456789012',
    billingAccount: '012345-6789AB-CDEF01',
    region: 'us-central1',
    projectId: 'er-nclocal',
    environment: 'nclocal',
  });
  assert.equal(checkSettings(APPROVAL_FIELDS, defaults, { region: 'europe-west1' }).region, 'europe-west1');
  assert.throws(() => checkSettings(APPROVAL_FIELDS, defaults, { projectId: 'er-' }), { status: 400, code: 'invalid-setting', field: 'projectId' });
  assert.throws(() => checkSettings(APPROVAL_FIELDS, defaults, { environment: 'Bad Name' }), { field: 'environment' });
  assert.throws(() => checkSettings(APPROVAL_FIELDS, { ...defaults, gcpFolder: '' }), { field: 'gcpFolder' });
});

test('getConsoleSettings returns the settings to an operator, and empty values when none are saved', async () => {
  const result = await getConsoleSettings({ db: seeded() }, { body: {}, user: ops });
  assert.deepEqual(result.body.settings, { gcpFolder: 'folders/123456789012', billingAccount: '012345-6789AB-CDEF01', region: 'us-central1' });
  const empty = seeded({ 'console_config/settings': {} });
  assert.deepEqual((await getConsoleSettings({ db: empty }, { body: {}, user: ops })).body.settings, { gcpFolder: '', billingAccount: '', region: '' });
});

test('only an operator reads or saves the settings', async () => {
  const db = seeded();
  await assert.rejects(getConsoleSettings({ db }, { body: {}, user: ana }), { status: 403, code: 'not-operator' });
  await assert.rejects(
    saveConsoleSettings({ db }, { body: { settings: { gcpFolder: '1234567', billingAccount: '012345-6789AB-CDEF01', region: 'us-east1' } }, user: ana }),
    { status: 403 },
  );
  assert.equal(db.read('console_config/settings').region, 'us-central1');
});

test('saveConsoleSettings checks each value, stores only the three fields, and audits the change', async () => {
  const db = seeded();
  const result = await saveConsoleSettings({ db, now: () => NOW }, {
    body: { settings: { gcpFolder: '987654321', billingAccount: 'aaaaaa-bbbbbb-cccccc', region: 'US-EAST1', extra: 'x' } },
    user: ops,
  });
  const stored = { gcpFolder: 'folders/987654321', billingAccount: 'AAAAAA-BBBBBB-CCCCCC', region: 'us-east1' };
  assert.deepEqual(result.body.settings, stored);
  assert.deepEqual(db.read('console_config/settings'), stored);
  const audit = db.paths('console_audit/').map((p) => db.read(p));
  assert.deepEqual(audit, [{ action: 'save-settings', appId: null, by: 'ops', at: new Date(NOW) }]);

  await assert.rejects(
    saveConsoleSettings({ db }, { body: { settings: { gcpFolder: '987654321', billingAccount: 'nope', region: 'us-east1' } }, user: ops }),
    { status: 400, field: 'billingAccount' },
  );
  assert.deepEqual(db.read('console_config/settings'), stored);
});

const FEE = { amount: 12345, currency: 'usd' };
const AGREEMENT = { title: 'Test agreement', body: 'First test paragraph.\n\nSecond test paragraph.' };
const dep = (db) => ({ db, now: () => NOW });
const audits = (db) => db.paths('console_audit/').map((path) => db.read(path));

test('an operator sets the fee, and the settings and the fee keep each other', async () => {
  const db = seeded();
  const result = await saveEventFee(dep(db), { body: { fee: { amount: FEE.amount, currency: 'USD' } }, user: ops });
  assert.deepEqual(result.body.fee, FEE);
  const stored = db.read('console_config/settings');
  assert.equal(stored.feeAmount, FEE.amount);
  assert.equal(stored.feeCurrency, 'usd');
  assert.equal(stored.region, 'us-central1');
  await saveConsoleSettings(dep(db), {
    body: { settings: { gcpFolder: 'folders/123456789012', billingAccount: '012345-6789AB-CDEF01', region: 'us-east1' } }, user: ops,
  });
  assert.equal(db.read('console_config/settings').feeAmount, FEE.amount, 'saving settings keeps the fee');
  assert.deepEqual(audits(db).map((a) => a.action).sort(), ['save-fee', 'save-settings']);
  assert.deepEqual((await getConsoleSettings(dep(db), { body: {}, user: ops })).body.fee, FEE);
});

test('a fee that is not a positive whole number, or a bad currency, is refused', async () => {
  const db = seeded();
  for (const amount of [0, -1, 10.5, '100', null, 100000000]) {
    await assert.rejects(saveEventFee(dep(db), { body: { fee: { amount, currency: 'usd' } }, user: ops }), { status: 400, field: 'feeAmount' }, String(amount));
  }
  for (const currency of ['', 'dollars', 'us', 7]) {
    await assert.rejects(saveEventFee(dep(db), { body: { fee: { amount: 100, currency } }, user: ops }), { status: 400, field: 'feeCurrency' }, String(currency));
  }
  assert.equal(db.read('console_config/settings').feeAmount, undefined);
  assert.deepEqual(audits(db), []);
});

test('each saved agreement is a new version, and an old version never changes', async () => {
  const db = seeded();
  const first = await saveAgreement(dep(db), { body: { agreement: AGREEMENT }, user: ops });
  assert.equal(first.body.created, true);
  assert.equal(first.body.agreement.version, 1);
  const kept = db.read('console_config/agreement/versions/1');
  assert.equal(kept.body, AGREEMENT.body);

  const second = await saveAgreement(dep(db), { body: { agreement: { ...AGREEMENT, body: 'A changed test paragraph.' } }, user: ops });
  assert.equal(second.body.agreement.version, 2);
  assert.deepEqual(db.read('console_config/agreement/versions/1'), kept, 'version 1 is unchanged');
  assert.equal(db.read('console_config/agreement/versions/2').body, 'A changed test paragraph.');
  assert.equal(db.read('console_config/agreement').version, 2);
  assert.deepEqual(audits(db).map((a) => [a.action, a.version]).sort(), [['save-agreement', 1], ['save-agreement', 2]]);
});

test('the same text saves nothing, and line endings do not make a new version', async () => {
  const db = seeded();
  await saveAgreement(dep(db), { body: { agreement: AGREEMENT }, user: ops });
  const again = await saveAgreement(dep(db), {
    body: { agreement: { title: ` ${AGREEMENT.title} `, body: `${AGREEMENT.body.replace('\n\n', '\r\n\r\n')}\n` } }, user: ops,
  });
  assert.equal(again.body.created, false);
  assert.equal(again.body.agreement.version, 1);
  assert.deepEqual(db.paths('console_config/agreement/versions/'), ['console_config/agreement/versions/1']);
  assert.equal(audits(db).length, 1);
});

test('an agreement needs a title and a text, and only an operator saves one', async () => {
  const db = seeded();
  await assert.rejects(saveAgreement(dep(db), { body: { agreement: { title: '', body: 'x' } }, user: ops }), { field: 'agreementTitle' });
  await assert.rejects(saveAgreement(dep(db), { body: { agreement: { title: 't', body: ' ' } }, user: ops }), { field: 'agreementBody' });
  await assert.rejects(saveAgreement(dep(db), { body: { agreement: AGREEMENT }, user: ana }), { status: 403 });
  await assert.rejects(saveEventFee(dep(db), { body: { fee: FEE }, user: ana }), { status: 403 });
  assert.equal(db.read('console_config/agreement'), undefined);
});

test('sign-ups open only with a usable fee and an agreement that matches its hash', async () => {
  const get = (r) => r.get();
  const db = seeded();
  assert.equal((await readSignupTerms(get, db)).open, false);
  await saveEventFee(dep(db), { body: { fee: FEE }, user: ops });
  assert.equal((await readSignupTerms(get, db)).open, false);
  await saveAgreement(dep(db), { body: { agreement: AGREEMENT }, user: ops });
  assert.equal((await readSignupTerms(get, db)).open, true);
  await db.collection('console_config').doc('agreement').update({ body: 'Changed outside the console.' });
  const closed = await readSignupTerms(get, db);
  assert.equal(closed.open, false);
  assert.equal(closed.agreement, null);
});
