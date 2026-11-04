'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { approveApplication, declineApplication, requestChanges } = require('./reviewDecisions.cjs');
const { NOW, PUBLIC_URL, ana, application, deps, fakeMailer, ops, ops2, seeded } = require('./fakeReview.cjs');

const lastHistory = (db, id = 'a1') => db.read(`applications/${id}`).history.at(-1);

test('requestChanges moves a submitted request to changes_requested, records the note and emails each Owner', async () => {
  const db = seeded();
  const d = deps(db);
  const result = await requestChanges(d, { body: { appId: 'a1', note: '  Add the venue address.  ' }, user: ops });
  assert.deepEqual(result.body, { application: { id: 'a1', status: 'changes_requested' }, emailed: 2, mailFailed: false });
  const app = db.read('applications/a1');
  assert.equal(app.status, 'changes_requested');
  assert.equal(app.updatedBy, 'ops');
  assert.deepEqual(app.updatedAt, new Date(NOW));
  assert.equal(app.history.length, 3, 'appended, oldest first');
  assert.deepEqual(lastHistory(db), { status: 'changes_requested', at: new Date(NOW), by: 'ops', note: 'Add the venue address.' });
  assert.deepEqual(app.review, { note: 'Add the venue address.', by: 'ops', at: new Date(NOW), settings: null });
  assert.deepEqual(d.mailer.sent.map((m) => m.to).sort(), ['ana@example.org', 'bo@example.org'], 'Owners only, not the Editor');
  assert.deepEqual(d.mailer.sent[0], {
    to: d.mailer.sent[0].to,
    organizationName: 'NC Local',
    eventName: 'NC Local Summit',
    status: 'changes_requested',
    note: 'Add the venue address.',
    link: `${PUBLIC_URL}/organizations/o1/applications/a1`,
  });
});

test('a note is required and has at most 2,000 characters', async () => {
  const db = seeded();
  for (const fn of [requestChanges, declineApplication]) {
    await assert.rejects(fn(deps(db), { body: { appId: 'a1', note: '   ' }, user: ops }), { status: 400, code: 'note-required' });
    await assert.rejects(fn(deps(db), { body: { appId: 'a1' }, user: ops }), { status: 400, code: 'note-required' });
    await assert.rejects(fn(deps(db), { body: { appId: 'a1', note: 'x'.repeat(2001) }, user: ops }), { status: 400, code: 'note-too-long' });
  }
  await requestChanges(deps(db), { body: { appId: 'a1', note: 'x'.repeat(2000) }, user: ops });
  assert.equal(db.read('applications/a1').status, 'changes_requested');
});

test('only a submitted request can have changes requested', async () => {
  const db = seeded({ 'applications/a2': application({ status: 'draft' }) });
  await assert.rejects(requestChanges(deps(db), { body: { appId: 'a2', note: 'n' }, user: ops }), { status: 409, code: 'status-changed' });
  assert.equal(db.read('applications/a2').status, 'draft');
});

test('two operators cannot act twice: the second gets status-changed and nothing more is written or sent', async () => {
  const db = seeded();
  const first = deps(db);
  const second = deps(db);
  await requestChanges(first, { body: { appId: 'a1', note: 'One' }, user: ops });
  await assert.rejects(approveApplication(second, { body: { appId: 'a1' }, user: ops2 }), { status: 409, code: 'status-changed' });
  await assert.rejects(requestChanges(second, { body: { appId: 'a1', note: 'Two' }, user: ops2 }), { status: 409 });
  assert.equal(db.read('applications/a1').history.length, 3);
  assert.equal(second.mailer.sent.length, 0);
});

test('a client cannot decide on a request', async () => {
  const db = seeded();
  await assert.rejects(requestChanges(deps(db), { body: { appId: 'a1', note: 'n' }, user: ana }), { status: 403, code: 'not-operator' });
  await assert.rejects(declineApplication(deps(db), { body: { appId: 'a1', note: 'n' }, user: ana }), { status: 403 });
  await assert.rejects(approveApplication(deps(db), { body: { appId: 'a1' }, user: ana }), { status: 403 });
  assert.equal(db.read('applications/a1').status, 'submitted');
});

test('declineApplication works from submitted and changes_requested, frees the name and emails the Owners', async () => {
  const db = seeded({ 'applications/a2': application({ status: 'changes_requested', frozen: { webAddress: { name: 'other' } } }), 'site_names/other': { appId: 'a2', orgId: 'o1' } });
  const d = deps(db);
  const result = await declineApplication(d, { body: { appId: 'a1', note: 'Not an event.' }, user: ops });
  assert.equal(result.body.application.status, 'declined');
  assert.equal(db.read('applications/a1').status, 'declined');
  assert.equal(db.read('site_names/nclocal'), undefined, 'the name is free again');
  assert.deepEqual(lastHistory(db), { status: 'declined', at: new Date(NOW), by: 'ops', note: 'Not an event.' });
  assert.equal(d.mailer.sent.length, 2);
  assert.equal(d.mailer.sent[0].status, 'declined');

  await declineApplication(deps(db), { body: { appId: 'a2', note: 'Duplicate.' }, user: ops });
  assert.equal(db.read('applications/a2').status, 'declined');
  assert.equal(db.read('site_names/other'), undefined);
});

test('declineApplication keeps a name that another request holds', async () => {
  const db = seeded({ 'site_names/nclocal': { appId: 'someone-else', orgId: 'o9' } });
  await declineApplication(deps(db), { body: { appId: 'a1', note: 'No.' }, user: ops });
  assert.deepEqual(db.read('site_names/nclocal'), { appId: 'someone-else', orgId: 'o9' });
});

test('declineApplication refuses an approved request', async () => {
  const db = seeded({ 'applications/a1': application({ status: 'approved' }) });
  await assert.rejects(declineApplication(deps(db), { body: { appId: 'a1', note: 'No.' }, user: ops }), { status: 409 });
  assert.ok(db.read('site_names/nclocal'));
});

test('approveApplication records the default build settings and emails "We are building your site"', async () => {
  const db = seeded();
  const d = deps(db);
  const result = await approveApplication(d, { body: { appId: 'a1' }, user: ops });
  assert.deepEqual(result.body, { application: { id: 'a1', status: 'approved' }, emailed: 2, mailFailed: false });
  const app = db.read('applications/a1');
  assert.equal(app.status, 'approved');
  assert.deepEqual(app.review, {
    note: null,
    by: 'ops',
    at: new Date(NOW),
    settings: {
      gcpFolder: 'folders/123456789012', billingAccount: '012345-6789AB-CDEF01', region: 'us-central1', projectId: 'er-nclocal', environment: 'nclocal',
    },
  });
  assert.deepEqual(lastHistory(db), { status: 'approved', at: new Date(NOW), by: 'ops', note: null });
  assert.ok(db.read('site_names/nclocal'), 'approval keeps the name');
  assert.equal(d.mailer.sent[0].status, 'approved');
});

test('approveApplication takes the operator changes and checks every value', async () => {
  const db = seeded();
  await assert.rejects(
    approveApplication(deps(db), { body: { appId: 'a1', settings: { projectId: 'er-nclocal-' } }, user: ops }),
    { status: 400, code: 'invalid-setting', field: 'projectId' },
  );
  await assert.rejects(
    approveApplication(deps(db), { body: { appId: 'a1', settings: { region: 'mars' } }, user: ops }),
    { field: 'region' },
  );
  assert.equal(db.read('applications/a1').status, 'submitted', 'a bad value changes nothing');
  await approveApplication(deps(db), {
    body: { appId: 'a1', settings: { projectId: 'nclocal-summit-2027', environment: 'nclocal-2027', gcpFolder: '555555555' } },
    user: ops,
  });
  const { settings } = db.read('applications/a1').review;
  assert.equal(settings.projectId, 'nclocal-summit-2027');
  assert.equal(settings.environment, 'nclocal-2027');
  assert.equal(settings.gcpFolder, 'folders/555555555');
  assert.equal(settings.region, 'us-central1');
});

test('approveApplication without console settings asks for the missing value', async () => {
  const db = seeded({ 'console_config/settings': {} });
  await assert.rejects(approveApplication(deps(db), { body: { appId: 'a1' }, user: ops }), { status: 400, field: 'gcpFolder' });
});

test('only a submitted request can be approved', async () => {
  for (const status of ['draft', 'changes_requested', 'declined', 'withdrawn', 'approved']) {
    const db = seeded({ 'applications/a1': application({ status }) });
    await assert.rejects(approveApplication(deps(db), { body: { appId: 'a1' }, user: ops }), { status: 409 }, status);
  }
});

test('a failed email does not undo the decision, and the answer says so', async () => {
  const db = seeded();
  const logged = [];
  const d = deps(db, { mailer: fakeMailer({ fail: true }), log: { info() {}, error: (...a) => logged.push(a) } });
  const result = await approveApplication(d, { body: { appId: 'a1' }, user: ops });
  assert.equal(result.body.mailFailed, true);
  assert.equal(db.read('applications/a1').status, 'approved');
  assert.equal(logged.length, 1);
});

test('a missing request is a 404', async () => {
  await assert.rejects(approveApplication(deps(seeded()), { body: { appId: 'nope' }, user: ops }), { status: 404 });
});

test('declining frees the name the client picked after changes were asked for, not only the frozen one', async () => {
  const live = { ...application().answers, webAddress: { name: 'nclocal2' } };
  const db = seeded({
    'applications/a1': application({ status: 'changes_requested', answers: live }),
    'site_names/nclocal2': { appId: 'a1', orgId: 'o1' },
  });
  await declineApplication(deps(db), { body: { appId: 'a1', note: 'No.' }, user: ops });
  assert.equal(db.read('site_names/nclocal2'), undefined, 'the current name is free');
  assert.equal(db.read('site_names/nclocal'), undefined, 'the frozen name is free too');
});
