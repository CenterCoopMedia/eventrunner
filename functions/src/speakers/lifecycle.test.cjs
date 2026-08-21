'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyDeleteSpeaker,
  linkSpeakerToUser,
  unlinkSpeakerFromUser,
  createDeleteSpeakerHandler,
  internals,
} = require('./lifecycle.cjs');
const { makeSpeakersDb } = require('./speakersFake.cjs');

const ACTOR = { uid: 'admin-1', email: 'admin@example.org' };
const NOW = () => Date.parse('2026-08-21T12:00:00Z');

function baseWorld(overrides = {}) {
  return {
    'speakers/s1': { firstName: 'Rae', lastName: 'Okonkwo', slug: 'rae-okonkwo', status: 'approved', uid: 'u1' },
    'speakers/s2': { firstName: 'Sam', lastName: 'Example', slug: 'sam-example', status: 'approved', uid: null },
    'speakers_public/s1': { speakerId: 's1', displayName: 'Rae Okonkwo' },
    'users/u1': { uid: 'u1', speakerId: 's1', registrationStatus: 'approved' },
    'cmsSchedule/sess-1': { title: 'Opening', speakerIds: ['s1', 's2'], visible: true },
    'cmsSchedule/sess-2': { title: 'Closing', speakerIds: ['s1'], visible: true },
    'cmsSchedule/sess-3': { title: 'Break', speakerIds: [], visible: true },
    'cmsSchedule_drafts/sess-4': { title: 'Draft panel', speakerIds: ['s1'], status: 'dirty' },
    ...overrides,
  };
}

test('one transaction unlinks sessions, drafts, the account, and both documents', async () => {
  const db = makeSpeakersDb(baseWorld());
  const result = await applyDeleteSpeaker({ db, speakerId: 's1', actor: ACTOR, now: NOW });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'hard');
  assert.deepEqual(result.unlinkedSessions.sort(), ['sess-1', 'sess-2']);
  assert.deepEqual(result.unlinkedDrafts, ['sess-4']);
  assert.equal(result.clearedUid, 'u1');

  assert.deepEqual(db.read('cmsSchedule', 'sess-1').speakerIds, ['s2']);
  assert.deepEqual(db.read('cmsSchedule', 'sess-2').speakerIds, []);
  assert.deepEqual(db.read('cmsSchedule', 'sess-3').speakerIds, []);
  assert.deepEqual(db.read('cmsSchedule_drafts', 'sess-4').speakerIds, []);
  assert.equal(db.read('users', 'u1').speakerId, null);
  assert.equal(db.read('speakers_public', 's1'), undefined);
  assert.equal(db.read('speakers', 's1'), undefined);
});

test('deleting a speaker leaves zero dangling references anywhere', async () => {
  const db = makeSpeakersDb(baseWorld());
  await applyDeleteSpeaker({ db, speakerId: 's1', actor: ACTOR, now: NOW });
  for (const collection of ['cmsSchedule', 'cmsSchedule_drafts']) {
    for (const id of db.ids(collection)) {
      assert.equal(
        (db.read(collection, id).speakerIds ?? []).includes('s1'),
        false,
        `${collection}/${id} still names the deleted speaker`,
      );
    }
  }
  assert.equal(db.read('users', 'u1').speakerId, null);
});

test('a speaker with no account and no sessions deletes cleanly', async () => {
  const db = makeSpeakersDb({ 'speakers/s9': { firstName: 'A', lastName: 'B', status: 'draft', uid: null } });
  const result = await applyDeleteSpeaker({ db, speakerId: 's9', actor: ACTOR, now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.clearedUid, null);
  assert.deepEqual(result.unlinkedSessions, []);
  assert.equal(db.read('speakers', 's9'), undefined);
});

test('a uid naming an account that no longer exists does not fail the delete', async () => {
  const db = makeSpeakersDb({
    'speakers/s1': { firstName: 'A', lastName: 'B', status: 'draft', uid: 'ghost' },
  });
  const result = await applyDeleteSpeaker({ db, speakerId: 's1', actor: ACTOR, now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.clearedUid, null);
  assert.equal(db.read('speakers', 's1'), undefined);
});

test('above the transaction limit it refuses, names the count, and changes NOTHING', async () => {
  const seed = {
    'speakers/s1': { firstName: 'A', lastName: 'B', status: 'approved', uid: 'u1' },
    'speakers_public/s1': { speakerId: 's1' },
    'users/u1': { uid: 'u1', speakerId: 's1' },
  };
  const overLimit = internals.MAX_UNLINKED_SESSIONS + 1;
  for (let i = 0; i < overLimit; i += 1) {
    seed[`cmsSchedule/sess-${i}`] = { speakerIds: ['s1'] };
  }
  const db = makeSpeakersDb(seed);
  const result = await applyDeleteSpeaker({ db, speakerId: 's1', actor: ACTOR, now: NOW });

  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.equal(result.code, 'too-many-references');
  assert.match(result.message, new RegExp(`${overLimit} session documents`));
  assert.match(result.message, /"soft": true/);
  assert.deepEqual(db.writes, [], 'a refused unlink must be a no-op, not a half-applied one');
  assert.notEqual(db.read('speakers', 's1'), undefined);
  assert.deepEqual(db.read('cmsSchedule', 'sess-0').speakerIds, ['s1']);
});

test('the soft delete hides the speaker without touching sessions', async () => {
  const db = makeSpeakersDb(baseWorld());
  const result = await applyDeleteSpeaker({ db, speakerId: 's1', soft: true, actor: ACTOR, now: NOW });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'soft');
  assert.equal(db.read('speakers', 's1').status, 'removed');
  assert.equal(db.read('speakers', 's1').updatedBy, ACTOR.email);
  // The projection is the trigger's job, not the delete's — the record
  // changing status is what makes it fire.
  assert.deepEqual(db.read('cmsSchedule', 'sess-1').speakerIds, ['s1', 's2']);
  assert.equal(db.read('users', 'u1').speakerId, 's1');
  assert.deepEqual(db.writes, [{ type: 'set', path: 'speakers/s1' }]);
});

test('deleting a speaker that does not exist is a 404', async () => {
  const db = makeSpeakersDb();
  const result = await applyDeleteSpeaker({ db, speakerId: 'nope', actor: ACTOR, now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
});

test('an invalid speakerId is refused before any read', async () => {
  const db = makeSpeakersDb();
  for (const speakerId of [undefined, '', 'a/b', 42]) {
    const result = await applyDeleteSpeaker({ db, speakerId, actor: ACTOR, now: NOW });
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
  }
  assert.deepEqual(db.reads, []);
});

test('linkSpeakerToUser sets both halves of the pair in one commit', async () => {
  const db = makeSpeakersDb({
    'speakers/s1': { firstName: 'A', lastName: 'B', uid: null, status: 'accepted' },
    'users/u1': { uid: 'u1', speakerId: null },
  });
  assert.deepEqual(await linkSpeakerToUser({ db, speakerId: 's1', uid: 'u1', now: NOW }), { ok: true });
  assert.equal(db.read('speakers', 's1').uid, 'u1');
  assert.equal(db.read('users', 'u1').speakerId, 's1');
});

test('relinking a speaker clears the previous account in the same commit', async () => {
  const db = makeSpeakersDb({
    'speakers/s1': { firstName: 'A', lastName: 'B', uid: 'u1' },
    'users/u1': { uid: 'u1', speakerId: 's1' },
    'users/u2': { uid: 'u2', speakerId: null },
  });
  await linkSpeakerToUser({ db, speakerId: 's1', uid: 'u2', now: NOW });
  assert.equal(db.read('users', 'u1').speakerId, null);
  assert.equal(db.read('users', 'u2').speakerId, 's1');
  assert.equal(db.read('speakers', 's1').uid, 'u2');
});

test('unlinkSpeakerFromUser clears both halves', async () => {
  const db = makeSpeakersDb({
    'speakers/s1': { firstName: 'A', lastName: 'B', uid: 'u1' },
    'users/u1': { uid: 'u1', speakerId: 's1' },
  });
  assert.deepEqual(await unlinkSpeakerFromUser({ db, speakerId: 's1', now: NOW }), { ok: true });
  assert.equal(db.read('speakers', 's1').uid, null);
  assert.equal(db.read('users', 'u1').speakerId, null);
});

test('linking a speaker that does not exist is a 404 and writes nothing', async () => {
  const db = makeSpeakersDb({ 'users/u1': { uid: 'u1', speakerId: null } });
  const result = await linkSpeakerToUser({ db, speakerId: 'ghost', uid: 'u1', now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.deepEqual(db.writes, []);
});

// --- handler ------------------------------------------------------------

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

function adminReq(body) {
  return { method: 'POST', body, headers: { authorization: 'Bearer t' } };
}

test('the handler is admin-gated', async () => {
  const db = makeSpeakersDb(baseWorld());
  const res = fakeRes();
  await createDeleteSpeakerHandler(adminDeps(db, { admin: false }))(adminReq({ speakerId: 's1' }), res);
  assert.equal(res.statusCode, 403);
  assert.notEqual(db.read('speakers', 's1'), undefined);
});

test('the handler rejects anything but POST', async () => {
  const res = fakeRes();
  await createDeleteSpeakerHandler(adminDeps(makeSpeakersDb()))({ method: 'GET' }, res);
  assert.equal(res.statusCode, 405);
});

test('a successful delete writes an admin_logs audit row', async () => {
  const db = makeSpeakersDb(baseWorld());
  const res = fakeRes();
  await createDeleteSpeakerHandler(adminDeps(db))(adminReq({ speakerId: 's1' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.mode, 'hard');
  const logs = db.ids('admin_logs').map((id) => db.read('admin_logs', id));
  assert.equal(logs.length, 1);
  assert.equal(logs[0].action, 'deleteSpeaker');
  assert.equal(logs[0].email, ACTOR.email);
});

test('a soft delete is audited under its own action name', async () => {
  const db = makeSpeakersDb(baseWorld());
  const res = fakeRes();
  await createDeleteSpeakerHandler(adminDeps(db))(adminReq({ speakerId: 's1', soft: true }), res);
  assert.equal(res.statusCode, 200);
  const logs = db.ids('admin_logs').map((id) => db.read('admin_logs', id));
  assert.equal(logs[0].action, 'softDeleteSpeaker');
});

test('a non-boolean soft flag is refused', async () => {
  const res = fakeRes();
  await createDeleteSpeakerHandler(adminDeps(makeSpeakersDb(baseWorld())))(
    adminReq({ speakerId: 's1', soft: 'yes' }),
    res,
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error.message, /^soft: /);
});
