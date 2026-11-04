'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createApplication, getApplication, listApplications } = require('./applications.cjs');
const { FAKE_FEE, NOW, ana, applicationDoc, ben, cy, ops, seededDb, signupTerms, zed } = require('./testData.cjs');

const deps = (db) => ({ db, now: () => NOW });

test('an Owner starts a draft, with the organization name and the browser time zone preset', async () => {
  const db = seededDb();
  const result = await createApplication(deps(db), { body: { orgId: 'o1', timezone: 'America/New_York' }, user: ana });
  assert.equal(result.status, 201);
  const { id } = result.body.application;
  const stored = db.read(`applications/${id}`);
  assert.equal(stored.orgId, 'o1');
  assert.equal(stored.status, 'draft');
  assert.equal(stored.frozen, null);
  assert.equal(stored.review, null);
  assert.equal(stored.createdBy, 'ana');
  assert.equal(stored.updatedBy, 'ana');
  assert.equal(stored.submittedAt, null);
  assert.equal(stored.submittedBy, null);
  assert.deepEqual(stored.createdAt, new Date(NOW));
  assert.equal(stored.answers.organization.name, 'NC Local');
  assert.equal(stored.answers.event.timezone, 'America/New_York');
  assert.deepEqual(stored.answers.tickets, { choice: null });
  assert.deepEqual(stored.history, [{ status: 'draft', at: new Date(NOW), by: 'ana', note: null }]);
});

test('only an Owner starts one; an Editor, an operator and a stranger cannot', async () => {
  const db = seededDb();
  await assert.rejects(createApplication(deps(db), { body: { orgId: 'o1' }, user: ben }), {
    status: 403, message: 'Only an Owner can start a new event site.',
  });
  await assert.rejects(createApplication(deps(db), { body: { orgId: 'o1' }, user: ops }), { status: 404 });
  await assert.rejects(createApplication(deps(db), { body: { orgId: 'o1' }, user: zed }), { status: 404 });
  assert.deepEqual(db.paths('applications/'), []);
});

test('an organization has at most 3 open requests; withdrawn and declined ones do not count', async () => {
  const db = seededDb({
    'applications/a1': applicationDoc({ status: 'submitted' }),
    'applications/a2': applicationDoc({ status: 'withdrawn' }),
    'applications/a3': applicationDoc({ status: 'declined' }),
    'applications/a4': applicationDoc({ status: 'ready' }),
    'applications/b1': applicationDoc({ orgId: 'o2' }),
  });
  await createApplication(deps(db), { body: { orgId: 'o1' }, user: ana });
  await assert.rejects(createApplication(deps(db), { body: { orgId: 'o1' }, user: ana }), {
    status: 409, code: 'too-many-open',
  });
  assert.equal(db.paths('applications/').length, 6);
});

test('a member and an operator read a request; a stranger and another organization cannot', async () => {
  const db = seededDb({ 'applications/a1': applicationDoc() });
  const forAna = (await getApplication(deps(db), { body: { orgId: 'o1', appId: 'a1' }, user: ana })).body.application;
  assert.equal(forAna.id, 'a1');
  assert.equal(forAna.status, 'draft');
  assert.equal(forAna.address, 'nclocal.eventrunner.org');
  assert.deepEqual(forAna.errors, {});
  assert.equal(forAna.ownersNeeded, 1, 'still shown, for launch');
  assert.equal(forAna.progress.team, true, 'a second Owner does not hold the setup');
  assert.equal(forAna.progress.event, true);
  assert.equal(forAna.progress.review, true);
  assert.equal(forAna.progress.agreement, false);
  assert.equal(forAna.progress.fee, false);
  assert.deepEqual(forAna.signups, { open: false, fee: null }, 'nothing set: closed');
  assert.equal(forAna.canEdit, true);
  assert.equal(forAna.canAccept, true);
  assert.equal(forAna.canPay, false);
  assert.equal(forAna.canSubmit, false, 'a draft goes through the agreement');
  assert.equal(forAna.canWithdraw, true);
  assert.equal(forAna.frozen, undefined, 'a client does not get the operator fields');
  assert.equal(forAna.review, undefined);
  assert.equal(forAna.history[0].by, undefined);

  const forBen = (await getApplication(deps(db), { body: { orgId: 'o1', appId: 'a1' }, user: ben })).body.application;
  assert.equal(forBen.canEdit, true);
  assert.equal(forBen.canAccept, false);
  assert.equal(forBen.canSubmit, false);
  assert.equal(forBen.canWithdraw, false);

  const forOps = (await getApplication(deps(db), { body: { orgId: 'o1', appId: 'a1' }, user: ops })).body.application;
  assert.equal(forOps.operator, true);
  assert.equal(forOps.canEdit, false);
  assert.equal(forOps.frozen, null);
  assert.equal(forOps.history[0].by, 'ana');

  await assert.rejects(getApplication(deps(db), { body: { orgId: 'o1', appId: 'a1' }, user: zed }), { status: 404 });
  await assert.rejects(getApplication(deps(db), { body: { orgId: 'o2', appId: 'a1' }, user: cy }), { status: 404 });
  await assert.rejects(getApplication(deps(db), { body: { orgId: 'o1', appId: 'nope' }, user: ana }), { status: 404 });
  await assert.rejects(getApplication(deps(db), { body: { orgId: 'o1', appId: 'a/b' }, user: ana }), { status: 400 });
});

test('a request waiting for payment is locked, can be paid, and tells the client the fee', async () => {
  const db = seededDb({
    ...signupTerms(),
    'applications/a1': applicationDoc({
      status: 'awaiting_payment',
      agreementAcceptance: { id: 'r1', version: 1, sha256: 'x', name: 'Ana Owner', email: 'ana@example.org', at: new Date(NOW) },
      feeCheckout: { sessionId: 'cs_secret_to_client', amount: FAKE_FEE.amount, currency: FAKE_FEE.currency },
    }),
  });
  const forAna = (await getApplication(deps(db), { body: { orgId: 'o1', appId: 'a1' }, user: ana })).body.application;
  assert.equal(forAna.canEdit, false);
  assert.equal(forAna.canAccept, false);
  assert.equal(forAna.canPay, true);
  assert.equal(forAna.canWithdraw, true);
  assert.equal(forAna.progress.agreement, true);
  assert.deepEqual(forAna.signups, { open: true, fee: FAKE_FEE });
  assert.deepEqual(forAna.acceptance, { version: 1, name: 'Ana Owner', at: new Date(NOW).toISOString() });
  assert.ok(!JSON.stringify(forAna).includes('cs_secret_to_client'), 'the session id stays on the server');
  const forBen = (await getApplication(deps(db), { body: { orgId: 'o1', appId: 'a1' }, user: ben })).body.application;
  assert.equal(forBen.canPay, false);
});

test('getApplication shows the note of a change request, from the history or the review', async () => {
  const at = new Date(NOW);
  const db = seededDb({
    'applications/a1': applicationDoc({
      status: 'changes_requested',
      history: [
        { status: 'draft', at, by: 'ana', note: null },
        { status: 'submitted', at, by: 'ana', note: null },
        { status: 'changes_requested', at, by: 'ops@ccm.example', note: 'Add the venue address.' },
      ],
    }),
    'applications/a2': applicationDoc({
      status: 'changes_requested',
      review: { note: 'Pick another name.', by: 'ops@ccm.example', at, settings: { region: 'us-central1' } },
    }),
  });
  const a1 = (await getApplication(deps(db), { body: { orgId: 'o1', appId: 'a1' }, user: ana })).body.application;
  assert.equal(a1.note, 'Add the venue address.');
  assert.equal(a1.canEdit, true);
  const a2 = (await getApplication(deps(db), { body: { orgId: 'o1', appId: 'a2' }, user: ana })).body.application;
  assert.equal(a2.note, 'Pick another name.');
  const a2ops = (await getApplication(deps(db), { body: { orgId: 'o1', appId: 'a2' }, user: ops })).body.application;
  assert.deepEqual(a2ops.review.settings, { region: 'us-central1' });
});

test('a sent request is locked for editing but can still be withdrawn', async () => {
  const db = seededDb({ 'applications/a1': applicationDoc({ status: 'submitted' }) });
  const app = (await getApplication(deps(db), { body: { orgId: 'o1', appId: 'a1' }, user: ana })).body.application;
  assert.equal(app.canEdit, false);
  assert.equal(app.canSubmit, false);
  assert.equal(app.canWithdraw, true);
});

test('listApplications lists the organization\'s own requests, newest first', async () => {
  const db = seededDb({
    'applications/a1': applicationDoc({ createdAt: new Date(NOW - 5000) }),
    'applications/a2': applicationDoc({ createdAt: new Date(NOW - 1000), status: 'withdrawn', answers: {} }),
    'applications/b1': applicationDoc({ orgId: 'o2' }),
  });
  const result = await listApplications(deps(db), { body: { orgId: 'o1' }, user: ben });
  assert.deepEqual(result.body.applications.map((a) => a.id), ['a2', 'a1']);
  assert.equal(result.body.applications[1].eventName, 'NC Local News Summit');
  assert.equal(result.body.applications[1].address, 'nclocal.eventrunner.org');
  assert.equal(result.body.applications[0].address, null);
  assert.equal(result.body.canCreate, false, 'an Editor cannot start one');
  const forAna = await listApplications(deps(db), { body: { orgId: 'o1' }, user: ana });
  assert.equal(forAna.body.canCreate, true);
  const forOps = await listApplications(deps(db), { body: { orgId: 'o1' }, user: ops });
  assert.equal(forOps.body.applications.length, 2);
  await assert.rejects(listApplications(deps(db), { body: { orgId: 'o1' }, user: zed }), { status: 404 });
});
