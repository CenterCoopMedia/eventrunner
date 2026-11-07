'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createUpdateRegistrationFormHandler } = require('./registrationForm.cjs');
const { makeFakeDb } = require('../cms/firestoreFake.cjs');

const bootstrap = { adminEmails: ['operator@example.test'], staffEmails: ['staff@example.test'] };
const auth = { async verifyIdToken(token) {
  return { uid: token, email: `${token}@example.test`, email_verified: true };
} };
const FORM = {
  standard: { organization: { enabled: true, required: true }, dietary: { enabled: true, required: false } },
  custom: [{ id: 'q_shirt', kind: 'one_choice', label: 'T-shirt size', choices: ['S', 'M'], required: false }],
};
async function save(db, token, body) {
  const res = { statusCode: null, body: null, headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  await createUpdateRegistrationFormHandler({ db, auth, getConfig: async () => ({ bootstrap }), now: () => 1_800_000_000_000, log: { error() {} } })({
    method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body,
  }, res);
  return res;
}

test('an operator saves the form, the revision goes up, and an audit row names it', async () => {
  const db = makeFakeDb({ 'config/bootstrap': bootstrap });
  const first = await save(db, 'operator', { expectedRevision: 0, form: FORM });
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  assert.equal(first.body.revision, 1);
  const stored = db.read('config', 'registration_form');
  assert.equal(stored.revision, 1);
  assert.equal(stored.updatedBy, undefined);
  assert.deepEqual(stored.standard.organization, { enabled: true, required: true });
  assert.deepEqual(stored.standard.jobTitle, { enabled: false, required: false });
  assert.equal(stored.custom[0].id, 'q_shirt');
  const logPaths = db.writes.filter((write) => write.path.startsWith('admin_logs/')).map((write) => write.path);
  assert.equal(logPaths.length, 1);
  const log = db.read('admin_logs', logPaths[0].split('/')[1]);
  assert.equal(log.action, 'updateRegistrationForm');
  assert.deepEqual(log.details, { revision: 1, custom: 1 });
  assert.equal((await save(db, 'operator', { expectedRevision: 1, form: { ...FORM, custom: [] } })).body.revision, 2);
});

test('a save against an older revision is refused and changes nothing', async () => {
  const db = makeFakeDb({ 'config/bootstrap': bootstrap, 'config/registration_form': { ...FORM, revision: 3 } });
  const stale = await save(db, 'operator', { expectedRevision: 2, form: { ...FORM, custom: [] } });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.body.error.code, 'revision-conflict');
  assert.equal(db.read('config', 'registration_form').custom.length, 1);
});

test('only an operator saves, and a bad form or a missing revision is refused by field', async () => {
  const db = makeFakeDb({ 'config/bootstrap': bootstrap });
  assert.equal((await save(db, 'staff', { expectedRevision: 0, form: FORM })).statusCode, 403);
  assert.equal((await save(db, null, { expectedRevision: 0, form: FORM })).statusCode, 401);
  const bad = await save(db, 'operator', { expectedRevision: 0, form: { custom: [{ id: 'q_x1234', kind: 'one_choice', label: 'Pick' }] } });
  assert.equal(bad.statusCode, 400);
  assert.match(bad.body.error.message, /custom\.0\.choices/);
  assert.equal((await save(db, 'operator', { form: FORM })).statusCode, 400);
  assert.equal(db.read('config', 'registration_form'), undefined);
});
