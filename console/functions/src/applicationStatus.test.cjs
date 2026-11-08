'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { withdrawApplication } = require('./applicationStatus.cjs');
const { NOW, ana, applicationDoc, ben, fakeMailer, quietLog, seededDb } = require('./testData.cjs');

const SECOND_OWNER = { 'organizations/o1/members/dee': { uid: 'dee', email: 'dee@example.org', role: 'owner' } };
const NAME_HELD = { 'site_names/nclocal': { appId: 'a1', orgId: 'o1', reservedAt: new Date(NOW) } };

function ready(extra = {}) {
  return seededDb({ 'applications/a1': applicationDoc(), ...SECOND_OWNER, ...NAME_HELD, ...extra });
}

function deps(db, mailer = fakeMailer(), log = quietLog()) {
  return { db, mailer, log, now: () => NOW, publicUrl: 'https://console.eventrunner.org' };
}

const withdraw = (d, user = ana) => withdrawApplication(d, { body: { orgId: 'o1', appId: 'a1' }, user });

test('an Owner withdraws a draft: the status changes and the name is released', async () => {
  const db = ready();
  const mailer = fakeMailer();
  const result = await withdraw(deps(db, mailer));
  assert.equal(result.body.status, 'withdrawn');
  const stored = db.read('applications/a1');
  assert.equal(stored.status, 'withdrawn');
  assert.deepEqual(stored.history.at(-1), { status: 'withdrawn', at: new Date(NOW), by: 'ana', note: null });
  assert.deepEqual(db.paths('site_names/'), []);
  assert.ok(mailer.sent.every((m) => m.kind === 'status' && m.status === 'withdrawn'));
  assert.equal(mailer.sent.length, 2);
});

test('withdraw is refused once the build has started, for a closed request, and for an Editor', async () => {
  for (const status of ['approved', 'building', 'ready', 'launched', 'withdrawn', 'declined']) {
    const db = ready({ 'applications/a1': applicationDoc({ status }) });
    await assert.rejects(withdraw(deps(db)), { status: 409 }, status);
    assert.ok(db.read('site_names/nclocal'), 'the name stays');
  }
  await assert.rejects(withdraw(deps(ready({ 'applications/a1': applicationDoc({ status: 'approved' }) }))), {
    message: 'Your site is being built, so you cannot withdraw it here.',
  });
  await assert.rejects(withdraw(deps(ready()), ben), { status: 403 });
  // An archived site is not being built: the refusal says what happened.
  const archived = ready({ 'applications/a1': applicationDoc({ status: 'archived' }) });
  await assert.rejects(withdraw(deps(archived)), {
    status: 409, message: 'This site is archived. Ask the hosting team to restore it.',
  });
  assert.ok(archived.read('site_names/nclocal'), 'the name stays');
});
