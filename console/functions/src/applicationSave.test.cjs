'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { saveApplicationStep } = require('./applicationSave.cjs');
const { emptyAnswers } = require('./answers.cjs');
const { NOW, ana, applicationDoc, ben, cy, ops, seededDb, zed } = require('./testData.cjs');

const deps = (db) => ({ db, now: () => NOW });
const save = (db, user, step, answers, appId = 'a1', orgId = 'o1') => (
  saveApplicationStep(deps(db), { body: { orgId, appId, step, answers }, user })
);

function draftDb(extra = {}) {
  return seededDb({ 'applications/a1': applicationDoc({ answers: emptyAnswers({ organizationName: 'NC Local' }) }), ...extra });
}

test('a member saves one step; the reply carries that step\'s errors by field', async () => {
  const db = draftDb();
  const result = await save(db, ben, 'event', { name: 'NC Local News Summit', shortName: '', timezone: 'America/New_York' });
  assert.equal(result.body.saved, true);
  assert.equal(result.body.updatedAt, new Date(NOW).toISOString());
  assert.deepEqual(Object.keys(result.body.errors).sort(), ['event.days', 'event.shortName']);
  const stored = db.read('applications/a1');
  assert.equal(stored.answers.event.name, 'NC Local News Summit');
  assert.equal(stored.answers.organization.name, 'NC Local', 'other steps are kept');
  assert.equal(stored.updatedBy, 'ben');
  assert.deepEqual(stored.updatedAt, new Date(NOW));
});

test('an unknown step, an operator, a stranger and another organization are refused', async () => {
  const db = draftDb();
  await assert.rejects(save(db, ana, 'team', {}), { status: 400 });
  await assert.rejects(save(db, ana, '__proto__', {}), { status: 400 });
  await assert.rejects(save(db, ops, 'event', {}), { status: 403 });
  await assert.rejects(save(db, zed, 'event', {}), { status: 404 });
  await assert.rejects(save(db, cy, 'event', {}, 'a1', 'o2'), { status: 404 });
});

test('a step saves only while the request is a draft or has changes requested', async () => {
  for (const status of ['submitted', 'approved', 'building', 'ready', 'launched', 'withdrawn', 'declined']) {
    const db = seededDb({ 'applications/a1': applicationDoc({ status }) });
    await assert.rejects(save(db, ana, 'tickets', { choice: 'none' }), { status: 409, code: 'locked' }, status);
  }
  const db = seededDb({ 'applications/a1': applicationDoc({ status: 'changes_requested' }) });
  const result = await save(db, ana, 'tickets', { choice: 'none' });
  assert.equal(result.body.saved, true);
  assert.equal(db.read('applications/a1').status, 'changes_requested');
});

test('saving the web address reserves the name and releases the old one', async () => {
  const db = draftDb();
  await save(db, ana, 'webAddress', { name: 'NCLocal' });
  assert.deepEqual(db.read('site_names/nclocal'), { appId: 'a1', orgId: 'o1', reservedAt: new Date(NOW) });
  assert.equal(db.read('applications/a1').answers.webAddress.name, 'nclocal');

  await save(db, ana, 'webAddress', { name: 'nclocal-2027' });
  assert.equal(db.read('site_names/nclocal'), undefined);
  assert.equal(db.read('site_names/nclocal-2027').appId, 'a1');

  await save(db, ana, 'webAddress', { name: 'nclocal-2027' });
  assert.deepEqual(db.paths('site_names/'), ['site_names/nclocal-2027'], 'saving the same name keeps it');

  await save(db, ana, 'webAddress', { name: '' });
  assert.deepEqual(db.paths('site_names/'), []);
  assert.equal(db.read('applications/a1').answers.webAddress.name, '');
});

test('a name another request holds is not saved, and the request keeps its own name', async () => {
  const db = draftDb({
    'applications/a2': applicationDoc({ orgId: 'o2' }),
    'site_names/taken': { appId: 'a2', orgId: 'o2', reservedAt: new Date(NOW) },
  });
  await save(db, ana, 'webAddress', { name: 'mine' });
  const result = await save(db, ana, 'webAddress', { name: 'taken' });
  assert.equal(result.body.saved, false);
  assert.equal(result.body.updatedAt, null);
  assert.match(result.body.errors['webAddress.name'], /Another event already uses this name/);
  assert.equal(db.read('site_names/taken').appId, 'a2');
  assert.equal(db.read('site_names/mine').appId, 'a1');
  assert.equal(db.read('applications/a1').answers.webAddress.name, 'mine');
});

test('a name with a bad format or on the reserved list is not saved', async () => {
  const db = draftDb();
  for (const name of ['ab', '-abc', 'admin']) {
    const result = await save(db, ana, 'webAddress', { name });
    assert.equal(result.body.saved, false, name);
    assert.ok(result.body.errors['webAddress.name'], name);
  }
  assert.deepEqual(db.paths('site_names/'), []);
});

test('two requests that save one name at the same time: one gets it', async () => {
  const db = draftDb({ 'applications/a2': applicationDoc({ answers: emptyAnswers() }) });
  const [first, second] = await Promise.all([
    save(db, ana, 'webAddress', { name: 'samename' }, 'a1'),
    save(db, ana, 'webAddress', { name: 'samename' }, 'a2'),
  ].map((p) => p.catch((err) => ({ failed: err }))));
  const winners = [first, second].filter((r) => r.body?.saved);
  assert.equal(winners.length, 1);
  assert.equal(db.paths('site_names/').length, 1);
});
