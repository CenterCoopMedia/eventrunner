'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyCreateSpeaker,
  applyUpdateSpeaker,
  createCreateSpeakerHandler,
  createUpdateSpeakerHandler,
} = require('./profile.cjs');
const { makeSpeakersDb } = require('./speakersFake.cjs');

const ACTOR = { uid: 'admin-1', email: 'admin@example.org' };
const NOW = () => Date.parse('2026-08-21T12:00:00Z');
const AT = new Date('2026-08-21T12:00:00Z');

test('create writes a canonical record with server-owned defaults', async () => {
  const db = makeSpeakersDb();
  const result = await applyCreateSpeaker({
    db,
    payload: { firstName: 'Rae', lastName: 'Okonkwo', email: 'RAE@Example.org ', bio: 'Reporter.' },
    actor: ACTOR,
    now: NOW,
  });

  assert.deepEqual(result, { ok: true, speakerId: 'rae-okonkwo', docPath: 'speakers/rae-okonkwo' });
  const stored = db.read('speakers', 'rae-okonkwo');
  assert.equal(stored.slug, 'rae-okonkwo');
  assert.equal(stored.email, 'rae@example.org');
  assert.equal(stored.status, 'draft');
  assert.equal(stored.uid, null);
  assert.equal(stored.inviteToken, null);
  assert.equal(stored.approvedAt, null);
  assert.deepEqual(stored.createdAt, AT);
  assert.equal(stored.updatedBy, ACTOR.email);
  assert.deepEqual(stored.socialHandles, {});
});

test('create never writes speakers_public — the projection is the trigger', async () => {
  const db = makeSpeakersDb();
  await applyCreateSpeaker({
    db,
    payload: { firstName: 'Rae', lastName: 'Okonkwo', status: 'approved' },
    actor: ACTOR,
    now: NOW,
  });
  assert.deepEqual(db.writes.filter((w) => w.path.startsWith('speakers_public/')), []);
});

test('creating as approved stamps approvedAt', async () => {
  const db = makeSpeakersDb();
  await applyCreateSpeaker({
    db,
    payload: { firstName: 'Rae', lastName: 'Okonkwo', status: 'approved' },
    actor: ACTOR,
    now: NOW,
  });
  assert.deepEqual(db.read('speakers', 'rae-okonkwo').approvedAt, AT);
});

test('an explicit speakerId is honoured; an invalid one is refused', async () => {
  const db = makeSpeakersDb();
  const ok = await applyCreateSpeaker({
    db, speakerId: 'spk-7', payload: { firstName: 'A', lastName: 'B' }, actor: ACTOR, now: NOW,
  });
  assert.equal(ok.speakerId, 'spk-7');

  const bad = await applyCreateSpeaker({
    db, speakerId: 'a/b', payload: { firstName: 'C', lastName: 'D' }, actor: ACTOR, now: NOW,
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.status, 400);
  assert.match(bad.message, /^speakerId: /);
});

test('a duplicate id is a 409 and does not clobber the first record', async () => {
  const db = makeSpeakersDb();
  await applyCreateSpeaker({ db, payload: { firstName: 'Rae', lastName: 'Okonkwo' }, actor: ACTOR, now: NOW });
  const again = await applyCreateSpeaker({
    db, payload: { firstName: 'Rae', lastName: 'Okonkwo', bio: 'clobber' }, actor: ACTOR, now: NOW,
  });
  assert.equal(again.ok, false);
  assert.equal(again.status, 409);
  assert.equal(db.read('speakers', 'rae-okonkwo').bio, '');
});

test('a slug already owned by another speaker is a 409 naming the owner', async () => {
  const db = makeSpeakersDb({
    'speakers/existing': { firstName: 'Rae', lastName: 'Okonkwo', slug: 'rae-okonkwo', status: 'draft' },
  });
  const result = await applyCreateSpeaker({
    db, speakerId: 'other', payload: { firstName: 'Rae', lastName: 'Okonkwo' }, actor: ACTOR, now: NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.match(result.message, /^slug: "rae-okonkwo" is already used by speaker "existing"$/);
  assert.equal(db.read('speakers', 'other'), undefined);
});

test('a payload carrying a server-owned field is rejected by name', async () => {
  const db = makeSpeakersDb();
  const result = await applyCreateSpeaker({
    db, payload: { firstName: 'A', lastName: 'B', uid: 'u1' }, actor: ACTOR, now: NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.match(result.message, /^uid: read-only/);
  assert.deepEqual(db.writes, []);
});

test('update merges only the keys sent and stamps the actor', async () => {
  const db = makeSpeakersDb({
    'speakers/s1': {
      firstName: 'Rae', lastName: 'Okonkwo', slug: 'rae-okonkwo', bio: 'old',
      status: 'draft', uid: 'u1', inviteToken: 'tok', approvedAt: null,
    },
  });
  const result = await applyUpdateSpeaker({
    db, speakerId: 's1', payload: { bio: 'new' }, actor: ACTOR, now: NOW,
  });
  assert.equal(result.ok, true);
  const stored = db.read('speakers', 's1');
  assert.equal(stored.bio, 'new');
  assert.equal(stored.firstName, 'Rae');
  assert.equal(stored.uid, 'u1', 'the linkage half must survive an unrelated edit');
  assert.equal(stored.updatedBy, ACTOR.email);
});

test('a name change re-derives the slug unless one is sent explicitly', async () => {
  const db = makeSpeakersDb({
    'speakers/s1': { firstName: 'Rae', lastName: 'Okonkwo', slug: 'rae-okonkwo', status: 'draft' },
  });
  await applyUpdateSpeaker({ db, speakerId: 's1', payload: { lastName: 'Adeyemi' }, actor: ACTOR, now: NOW });
  assert.equal(db.read('speakers', 's1').slug, 'rae-adeyemi');

  await applyUpdateSpeaker({
    db, speakerId: 's1', payload: { lastName: 'Bello', slug: 'kept-slug' }, actor: ACTOR, now: NOW,
  });
  assert.equal(db.read('speakers', 's1').slug, 'kept-slug');
});

test('a rename onto another speaker slug is a 409', async () => {
  const db = makeSpeakersDb({
    'speakers/s1': { firstName: 'Rae', lastName: 'Okonkwo', slug: 'rae-okonkwo', status: 'draft' },
    'speakers/s2': { firstName: 'Sam', lastName: 'Example', slug: 'sam-example', status: 'draft' },
  });
  const result = await applyUpdateSpeaker({
    db, speakerId: 's1', payload: { slug: 'sam-example' }, actor: ACTOR, now: NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.equal(db.read('speakers', 's1').slug, 'rae-okonkwo');
});

test('approvedAt is stamped on entering approved and not rewritten afterwards', async () => {
  const db = makeSpeakersDb({
    'speakers/s1': { firstName: 'A', lastName: 'B', slug: 'a-b', status: 'draft', approvedAt: null },
  });
  await applyUpdateSpeaker({ db, speakerId: 's1', payload: { status: 'approved' }, actor: ACTOR, now: NOW });
  assert.deepEqual(db.read('speakers', 's1').approvedAt, AT);

  const later = () => Date.parse('2026-09-01T00:00:00Z');
  await applyUpdateSpeaker({ db, speakerId: 's1', payload: { status: 'approved', bio: 'x' }, actor: ACTOR, now: later });
  assert.deepEqual(db.read('speakers', 's1').approvedAt, AT);
});

test('updating a speaker that does not exist is a 404', async () => {
  const db = makeSpeakersDb();
  const result = await applyUpdateSpeaker({ db, speakerId: 'nope', payload: { bio: 'x' }, actor: ACTOR, now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
});

test('an update with nothing editable in it is refused rather than stamped', async () => {
  const db = makeSpeakersDb({ 'speakers/s1': { firstName: 'A', lastName: 'B', slug: 'a-b' } });
  const result = await applyUpdateSpeaker({ db, speakerId: 's1', payload: {}, actor: ACTOR, now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.deepEqual(db.writes, []);
});

// --- handlers -----------------------------------------------------------

function fakeRes() {
  const res = { statusCode: null, body: null, headers: {} };
  res.set = (k, v) => { res.headers[k] = v; return res; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

function adminDeps(db, { admin = true } = {}) {
  return {
    db,
    auth: { verifyIdToken: async () => ({ uid: ACTOR.uid, email: ACTOR.email, email_verified: true }) },
    getConfig: async () => ({ bootstrap: { adminEmails: admin ? [ACTOR.email] : [] } }),
    now: NOW,
    log: { error() {}, warn() {} },
  };
}

const adminReq = (body) => ({ method: 'POST', body, headers: { authorization: 'Bearer t' } });

test('both handlers are admin-gated and POST-only', async () => {
  for (const create of [createCreateSpeakerHandler, createUpdateSpeakerHandler]) {
    const db = makeSpeakersDb();
    const denied = fakeRes();
    await create(adminDeps(db, { admin: false }))(adminReq({ speaker: { firstName: 'A', lastName: 'B' } }), denied);
    assert.equal(denied.statusCode, 403);

    const wrongMethod = fakeRes();
    await create(adminDeps(db))({ method: 'GET' }, wrongMethod);
    assert.equal(wrongMethod.statusCode, 405);
    assert.deepEqual(db.writes, []);
  }
});

test('a successful create is audited and answers with the id', async () => {
  const db = makeSpeakersDb();
  const res = fakeRes();
  await createCreateSpeakerHandler(adminDeps(db))(
    adminReq({ speaker: { firstName: 'Rae', lastName: 'Okonkwo' } }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.speakerId, 'rae-okonkwo');
  const logs = db.ids('admin_logs').map((id) => db.read('admin_logs', id));
  assert.equal(logs[0].action, 'createSpeaker');
});

test('a validation failure is returned verbatim so the form can mark the field', async () => {
  const db = makeSpeakersDb();
  const res = fakeRes();
  await createCreateSpeakerHandler(adminDeps(db))(adminReq({ speaker: { bio: 'x' } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.message, 'firstName: required; lastName: required');
});

test('a successful update is audited', async () => {
  const db = makeSpeakersDb({ 'speakers/s1': { firstName: 'A', lastName: 'B', slug: 'a-b', status: 'draft' } });
  const res = fakeRes();
  await createUpdateSpeakerHandler(adminDeps(db))(adminReq({ speakerId: 's1', speaker: { bio: 'x' } }), res);
  assert.equal(res.statusCode, 200);
  const logs = db.ids('admin_logs').map((id) => db.read('admin_logs', id));
  assert.equal(logs[0].action, 'updateSpeaker');
});

test('updating a missing speaker answers 404 through the handler', async () => {
  const res = fakeRes();
  await createUpdateSpeakerHandler(adminDeps(makeSpeakersDb()))(
    adminReq({ speakerId: 'nope', speaker: { bio: 'x' } }),
    res,
  );
  assert.equal(res.statusCode, 404);
});
