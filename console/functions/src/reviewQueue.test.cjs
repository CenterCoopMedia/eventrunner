'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { getApplicationForReview, listApplicationsForReview } = require('./reviewQueue.cjs');
const { DAY, NOW, ana, answers, application, deps, ops, seeded } = require('./fakeReview.cjs');

function withQueue() {
  return seeded({
    'organizations/o2': { name: 'Shore Press' },
    'applications/a2': application({
      orgId: 'o2', updatedAt: new Date(NOW - 2 * DAY), frozen: answers({ event: { name: 'Shore Fest' }, webAddress: { name: 'shore' } }),
    }),
    'applications/a3': application({ updatedAt: new Date(NOW - 10), status: 'declined' }),
    'applications/a4': application({ status: 'draft', frozen: null, submittedAt: null }),
  });
}

test('the queue lists requests with a build under way by default, newest first, with the organization name', async () => {
  const result = await listApplicationsForReview(deps(withQueue()), { body: {}, user: ops });
  assert.equal(result.body.status, 'approved');
  assert.deepEqual(result.body.applications.map((a) => a.id), ['a1', 'a2']);
  assert.deepEqual(result.body.applications[1], {
    id: 'a2',
    orgId: 'o2',
    organizationName: 'Shore Press',
    eventName: 'Shore Fest',
    webAddressName: 'shore',
    status: 'approved',
    submittedAt: new Date(NOW - DAY).toISOString(),
    updatedAt: new Date(NOW - 2 * DAY).toISOString(),
    buildStartFailed: false,
  });
});

test('the queue filters by any status and refuses an unknown one', async () => {
  const db = withQueue();
  const declined = await listApplicationsForReview(deps(db), { body: { status: 'declined' }, user: ops });
  assert.deepEqual(declined.body.applications.map((a) => a.id), ['a3']);
  const drafts = await listApplicationsForReview(deps(db), { body: { status: 'draft' }, user: ops });
  assert.equal(drafts.body.applications[0].eventName, 'NC Local Summit');
  await assert.rejects(listApplicationsForReview(deps(db), { body: { status: 'deleted' }, user: ops }), { status: 400 });
});

test('a client cannot read the queue or a request through review', async () => {
  const db = withQueue();
  await assert.rejects(listApplicationsForReview(deps(db), { body: {}, user: ana }), { status: 403, code: 'not-operator' });
  await assert.rejects(getApplicationForReview(deps(db), { body: { appId: 'a1' }, user: ana }), { status: 403, code: 'not-operator' });
});

test('an operator removed from the allowlist loses access at once', async () => {
  const db = withQueue();
  await db.doc('console_config/operators').set({ emails: [] });
  await assert.rejects(listApplicationsForReview(deps(db), { body: {}, user: ops }), { status: 403 });
});

test('one request comes with the frozen answers, the history, the team and the ticket choice', async () => {
  const db = seeded({
    'invites/i1': { orgId: 'o1', email: 'dee@example.org', role: 'editor', status: 'pending', expiresAt: new Date(NOW + DAY) },
    'invites/i2': { orgId: 'o1', email: 'old@example.org', role: 'editor', status: 'pending', expiresAt: new Date(NOW - DAY) },
  });
  await db.doc('applications/a1').update({ answers: answers({ event: { name: 'Changed after submit' } }) });
  const { body } = await getApplicationForReview(deps(db), { body: { appId: 'a1' }, user: ops });
  assert.equal(body.application.status, 'approved');
  assert.equal(body.application.answers.event.name, 'NC Local Summit', 'the frozen copy, not the live answers');
  assert.equal(body.application.ticketChoice, 'stripe');
  assert.equal(body.application.webAddressName, 'nclocal');
  assert.deepEqual(body.application.history.map((h) => [h.status, h.byEmail]), [['draft', 'ana@example.org'], ['approved', 'ana@example.org']]);
  assert.equal(body.application.revision, 2, 'a decision sends this back');
  assert.equal(body.organization.name, 'NC Local');
  assert.deepEqual(body.team.members.map((m) => `${m.role}:${m.email}`), ['owner:ana@example.org', 'owner:bo@example.org', 'editor:ben@example.org']);
  assert.deepEqual(body.team.invites.map((i) => i.email), ['dee@example.org']);
  assert.deepEqual(body.connection, { state: 'connected', label: 'Connected: NC Local' });
  assert.equal(body.approvalDefaults, undefined);
  assert.equal(body.application.review, null);
});

test('a draft has no frozen copy, so the page an operator declines it from shows the live answers', async () => {
  const db = seeded({ 'applications/a1': application({ status: 'draft', frozen: null }) });
  const { body } = await getApplicationForReview(deps(db), { body: { appId: 'a1' }, user: ops });
  assert.equal(body.application.answers.event.name, 'NC Local Summit');
  assert.equal(body.application.ticketChoice, 'stripe');
});

test('a missing request is a 404 and a bad id is a 400', async () => {
  const db = seeded();
  await assert.rejects(getApplicationForReview(deps(db), { body: { appId: 'zz' }, user: ops }), { status: 404 });
  await assert.rejects(getApplicationForReview(deps(db), { body: { appId: 'a/b' }, user: ops }), { status: 400 });
});
