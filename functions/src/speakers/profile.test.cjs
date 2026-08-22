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

test('re-approval after a removal keeps the ORIGINAL approvedAt', async () => {
  // approvedAt is history: when this speaker was first approved. A later
  // save is not a new fact about that.
  const db = makeSpeakersDb({
    'speakers/s1': { firstName: 'A', lastName: 'B', slug: 'a-b', status: 'draft', approvedAt: null, uid: null },
  });
  await applyUpdateSpeaker({ db, speakerId: 's1', payload: { status: 'approved' }, actor: ACTOR, now: NOW });
  await applyUpdateSpeaker({ db, speakerId: 's1', payload: { status: 'removed' }, actor: ACTOR, now: NOW });

  const later = () => Date.parse('2026-09-01T00:00:00Z');
  await applyUpdateSpeaker({ db, speakerId: 's1', payload: { status: 'approved' }, actor: ACTOR, now: later });
  assert.deepEqual(db.read('speakers', 's1').approvedAt, AT);
});

test('setting status to removed severs both halves of the account link', async () => {
  // A removed speaker who kept users.speakerId would keep the access that
  // field grants in firestore.rules (§3.4) while vanishing from the site.
  const db = makeSpeakersDb({
    'speakers/s1': { firstName: 'A', lastName: 'B', slug: 'a-b', status: 'approved', uid: 'u1' },
    'users/u1': { uid: 'u1', speakerId: 's1', registrationStatus: 'pending' },
  });
  const result = await applyUpdateSpeaker({
    db, speakerId: 's1', payload: { status: 'removed' }, actor: ACTOR, now: NOW,
  });

  assert.equal(result.ok, true);
  assert.equal(db.read('users', 'u1').speakerId, null);
  assert.equal(db.read('speakers', 's1').uid, null);
  assert.equal(db.read('speakers', 's1').status, 'removed');
});

test('removing a speaker whose account is already gone still succeeds', async () => {
  const db = makeSpeakersDb({
    'speakers/s1': { firstName: 'A', lastName: 'B', slug: 'a-b', status: 'approved', uid: 'ghost' },
  });
  const result = await applyUpdateSpeaker({
    db, speakerId: 's1', payload: { status: 'removed' }, actor: ACTOR, now: NOW,
  });
  assert.equal(result.ok, true);
  assert.equal(db.read('speakers', 's1').uid, null);
});

test('an unrelated edit to an already-removed speaker does not re-run the unlink', async () => {
  const db = makeSpeakersDb({
    'speakers/s1': { firstName: 'A', lastName: 'B', slug: 'a-b', status: 'removed', uid: null },
  });
  await applyUpdateSpeaker({ db, speakerId: 's1', payload: { status: 'removed', bio: 'x' }, actor: ACTOR, now: NOW });
  assert.deepEqual(
    db.writes.map((w) => w.path),
    ['speakers/s1'],
  );
});

test('create reserves the slug, and the reservation blocks a second create', async () => {
  // The reservation document is the lock a `where('slug','==',…)` query
  // cannot be: an empty query result puts nothing in the read set.
  const db = makeSpeakersDb();
  await applyCreateSpeaker({
    db, payload: { firstName: 'Rae', lastName: 'Okonkwo' }, actor: ACTOR, now: NOW,
  });
  assert.deepEqual(db.read('speaker_slugs', 'rae-okonkwo'), { speakerId: 'rae-okonkwo', updatedAt: AT });

  const clash = await applyCreateSpeaker({
    db, speakerId: 'other', payload: { firstName: 'Rae', lastName: 'Okonkwo' }, actor: ACTOR, now: NOW,
  });
  assert.equal(clash.ok, false);
  assert.equal(clash.status, 409);
  assert.match(clash.message, /^slug: "rae-okonkwo" is already used by speaker "rae-okonkwo"$/);
  assert.equal(db.read('speakers', 'other'), undefined);
});

test('a reservation with no matching speaker record still blocks the slug', async () => {
  // The record-level query would miss this; the reservation is what makes
  // the check atomic, so it has to be authoritative on its own.
  const db = makeSpeakersDb({ 'speaker_slugs/taken-name': { speakerId: 'someone' } });
  const result = await applyCreateSpeaker({
    db, speakerId: 'new-one', payload: { firstName: 'Taken', lastName: 'Name' }, actor: ACTOR, now: NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.match(result.message, /already used by speaker "someone"/);
});

test('renaming moves the reservation and releases the old slug', async () => {
  const db = makeSpeakersDb();
  await applyCreateSpeaker({ db, payload: { firstName: 'Rae', lastName: 'Okonkwo' }, actor: ACTOR, now: NOW });
  await applyUpdateSpeaker({
    db, speakerId: 'rae-okonkwo', payload: { lastName: 'Adeyemi' }, actor: ACTOR, now: NOW,
  });

  assert.equal(db.read('speaker_slugs', 'rae-okonkwo'), undefined);
  assert.deepEqual(db.read('speaker_slugs', 'rae-adeyemi'), { speakerId: 'rae-okonkwo', updatedAt: AT });
  // The freed slug is claimable again.
  const reuse = await applyCreateSpeaker({
    db, speakerId: 'second', payload: { firstName: 'Rae', lastName: 'Okonkwo' }, actor: ACTOR, now: NOW,
  });
  assert.equal(reuse.ok, true);
});

test('a save that does not move the slug leaves the reservation alone', async () => {
  const db = makeSpeakersDb();
  await applyCreateSpeaker({ db, payload: { firstName: 'Rae', lastName: 'Okonkwo' }, actor: ACTOR, now: NOW });
  const before = db.writes.length;
  await applyUpdateSpeaker({ db, speakerId: 'rae-okonkwo', payload: { bio: 'x' }, actor: ACTOR, now: NOW });
  assert.deepEqual(db.writes.slice(before).map((w) => w.path), ['speakers/rae-okonkwo']);
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

// --- invitation invalidation on admin edits (issue #21) -------------------

const { SPEAKER_INVITES, hashInviteToken } = require('./inviteTokens.cjs');

/** A speaker with one outstanding invitation, seeded directly. */
function invitedWorld(token = 'tok-1', email = 'rae@example.org') {
  const hash = hashInviteToken(token);
  return {
    world: {
      'speakers/rae': {
        firstName: 'Rae',
        lastName: 'Okonkwo',
        slug: 'rae-okonkwo',
        email,
        status: 'invited',
        uid: null,
        inviteToken: hash,
      },
      [`${SPEAKER_INVITES}/${hash}`]: { speakerId: 'rae', email, status: 'pending' },
    },
    hash,
  };
}

test('changing an invited speaker’s email kills the token mailed to the old address', async () => {
  // Acceptance authorizes against the address stored on the speaker, so an
  // outstanding token left live after a re-point would hand the OLD
  // recipient a working credential for the new one.
  const { world, hash } = invitedWorld();
  const db = makeSpeakersDb(world);

  const result = await applyUpdateSpeaker({
    db, speakerId: 'rae', payload: { email: 'new@example.org' }, actor: ACTOR, now: NOW,
  });

  assert.equal(result.ok, true);
  assert.equal(db.read('speakers', 'rae').inviteToken, null);
  assert.equal(db.read('speakers', 'rae').email, 'new@example.org');
  // Back to the state §4.3 defines as "a record that has not been invited",
  // which is what the admin list reads to offer Invite again.
  assert.equal(db.read('speakers', 'rae').status, 'draft');
  assert.equal(db.read(SPEAKER_INVITES, hash).status, 'superseded');
});

test('a same-address save leaves an outstanding invitation alone', async () => {
  const { world, hash } = invitedWorld();
  const db = makeSpeakersDb(world);

  const result = await applyUpdateSpeaker({
    // The same address in different case, plus an unrelated edit: retyping
    // an address identically must not cost the speaker their live link.
    db, speakerId: 'rae', payload: { email: 'RAE@example.org', bio: 'Reporter.' }, actor: ACTOR, now: NOW,
  });

  assert.equal(result.ok, true);
  assert.equal(db.read('speakers', 'rae').status, 'invited');
  assert.equal(db.read('speakers', 'rae').inviteToken, hash);
  assert.equal(db.read(SPEAKER_INVITES, hash).status, 'pending');
});

test('an edit that leaves `invited` by status still kills the token', async () => {
  const { world, hash } = invitedWorld();
  const db = makeSpeakersDb(world);

  await applyUpdateSpeaker({
    db, speakerId: 'rae', payload: { status: 'removed' }, actor: ACTOR, now: NOW,
  });

  assert.equal(db.read('speakers', 'rae').status, 'removed');
  assert.equal(db.read('speakers', 'rae').inviteToken, null);
  assert.equal(db.read(SPEAKER_INVITES, hash).status, 'superseded');
});

test('an email edit on a speaker with no invitation changes no invite row', async () => {
  const db = makeSpeakersDb({
    'speakers/rae': { firstName: 'Rae', lastName: 'O', slug: 'rae-o', email: 'a@example.org', status: 'draft', inviteToken: null },
  });
  const result = await applyUpdateSpeaker({
    db, speakerId: 'rae', payload: { email: 'b@example.org' }, actor: ACTOR, now: NOW,
  });
  assert.equal(result.ok, true);
  assert.equal(db.read('speakers', 'rae').status, 'draft');
  assert.deepEqual(db.ids(SPEAKER_INVITES), []);
});
