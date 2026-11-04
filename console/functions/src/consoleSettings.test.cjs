'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  approvalDefaults, checkSettings, environmentFor, getConsoleSettings, normalizeBilling, normalizeFolder,
  normalizeProjectId, projectIdFor, saveConsoleSettings, APPROVAL_FIELDS,
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
