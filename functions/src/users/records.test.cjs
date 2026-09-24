'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { makeFakeDb: makeBareFakeDb } = require('../cms/firestoreFake.cjs');
const {
  ORGANIZER_OWNED_FIELDS,
  PER_ACCOUNT_STORES,
  createUpdateAttendeeHandler,
  createDeleteAttendeeHandler,
  internals: { MAX_RELEASED_CLAIMS, DELETE_INCOMPLETE_MESSAGE },
} = require('./records.cjs');

// requireAdmin reads config/bootstrap LIVE and fails closed on an absent
// document, so every fake carries it. The delete's admin guard reads the
// same document inside its transaction.
const ADMIN = 'admin@example.com';
const STAFF = 'staff@example.com';
const OTHER_OPERATOR = 'owner@example.com';
const BOOTSTRAP_DOC = { adminEmails: [ADMIN, OTHER_OPERATOR], staffEmails: [STAFF] };
const makeFakeDb = (seed = {}) => makeBareFakeDb({ 'config/bootstrap': BOOTSTRAP_DOC, ...seed });

const QUIET = { warn() {}, error() {}, info() {} };
const T0 = new Date('2026-09-23T10:00:00.000Z');
const getConfig = async () => ({ bootstrap: BOOTSTRAP_DOC, features: {} });

function makeRes() {
  const res = {
    statusCode: null, body: null, headers: {},
    set(n, v) { res.headers[n] = v; return res; },
    status(c) { res.statusCode = c; return res; },
    json(p) { res.body = p; return res; },
  };
  return res;
}

const TOKENS = {
  admin: { uid: 'admin-1', email: ADMIN, email_verified: true },
  staff: { uid: 'staff-1', email: STAFF, email_verified: true },
  ada: { uid: 'uid-ada', email: 'ada@example.com', email_verified: true },
  'admin-unverified': { uid: 'admin-1', email: ADMIN, email_verified: false },
};

function notFoundError() {
  const err = new Error('There is no user record corresponding to the provided identifier.');
  err.code = 'auth/user-not-found';
  return err;
}

/**
 * Firebase Auth, as far as these handlers use it: token checks, and the
 * sign-in records a delete reads and removes. `failDeleteOnce` makes the
 * next deleteUser throw.
 */
function makeAuth(signIns = { 'uid-ada': 'ada@example.com' }) {
  const users = new Map(Object.entries(signIns));
  const auth = {
    users,
    failDeleteOnce: false,
    deleted: [],
    async verifyIdToken(token) {
      if (!TOKENS[token]) throw new Error('invalid token');
      return TOKENS[token];
    },
    async getUser(uid) {
      if (!users.has(uid)) throw notFoundError();
      return { uid, email: users.get(uid) };
    },
    async deleteUser(uid) {
      if (auth.failDeleteOnce) {
        auth.failDeleteOnce = false;
        throw new Error('auth unavailable');
      }
      if (!users.has(uid)) throw notFoundError();
      users.delete(uid);
      auth.deleted.push(uid);
    },
  };
  return auth;
}

/** Cloud Storage, as far as the photo sweep uses it. */
function makeBucket(paths = []) {
  const files = new Set(paths);
  const bucket = {
    files,
    failDeleteOnce: false,
    listings: [],
    async getFiles({ prefix, maxResults, autoPaginate }) {
      bucket.listings.push({ prefix, maxResults, autoPaginate });
      const names = [...files].filter((path) => path.startsWith(prefix));
      const page = autoPaginate === false && maxResults ? names.slice(0, maxResults) : names;
      return [page.map((name) => ({
        name,
        async delete() {
          if (bucket.failDeleteOnce) {
            bucket.failDeleteOnce = false;
            throw new Error('storage unavailable');
          }
          files.delete(name);
        },
      }))];
    },
  };
  return bucket;
}

const req = (token, body, method = 'POST') => ({
  method,
  headers: token ? { authorization: `Bearer ${token}` } : {},
  body,
});

function account(overrides = {}) {
  return {
    uid: 'uid-ada',
    email: 'ada@example.com',
    displayName: 'Ada Quill',
    organization: 'The Weekly Ledger',
    registrationStatus: 'approved',
    approvalSource: 'admin',
    speakerId: null,
    profileVisibility: 'public',
    ...overrides,
  };
}

function adminLogs(db) {
  return db.ids('admin_logs').map((id) => db.read('admin_logs', id));
}

// ---------------------------------------------------------------------------
// updateAttendee
// ---------------------------------------------------------------------------

async function update(db, body, token = 'admin') {
  const res = makeRes();
  await createUpdateAttendeeHandler({ db, auth: makeAuth(), getConfig, now: () => T0, log: QUIET })(
    req(token, body),
    res,
  );
  return res;
}

test('pastAttendance is the one organizer-owned field', () => {
  assert.deepEqual(ORGANIZER_OWNED_FIELDS, ['pastAttendance']);
});

test('updateAttendee writes only pastAttendance and updatedAt, trimmed', async () => {
  const db = makeFakeDb({ 'users/uid-ada': account() });
  const before = db.read('users', 'uid-ada');

  const res = await update(db, { uid: 'uid-ada', pastAttendance: [' 2024 ', '2025 edition'] });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, uid: 'uid-ada', pastAttendance: ['2024', '2025 edition'] });
  assert.deepEqual(db.read('users', 'uid-ada'), {
    ...before,
    pastAttendance: ['2024', '2025 edition'],
    updatedAt: T0,
  });
  assert.deepEqual(
    db.writes.filter((write) => write.path.startsWith('users/')),
    [{ type: 'set', path: 'users/uid-ada' }],
  );
});

test('an empty list is stored as an empty list', async () => {
  const db = makeFakeDb({ 'users/uid-ada': account({ pastAttendance: ['2024'] }) });
  const res = await update(db, { uid: 'uid-ada', pastAttendance: [] });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(db.read('users', 'uid-ada').pastAttendance, []);
});

test('updateAttendee refuses each invalid list with the field named, and writes nothing', async () => {
  const db = makeFakeDb({ 'users/uid-ada': account() });
  const long = 'x'.repeat(41);
  for (const [pastAttendance, message] of [
    [undefined, 'pastAttendance: must be a list of editions.'],
    ['2024', 'pastAttendance: must be a list of editions.'],
    [Array.from({ length: 21 }, (_, i) => `${2000 + i}`), 'pastAttendance: at most 20 editions.'],
    [['2024', 2025], 'pastAttendance: every edition must be text.'],
    [['2024', '   '], 'pastAttendance: an edition cannot be blank.'],
    [['2024\n2025'], 'pastAttendance: an edition cannot contain a line break, a tab, or another control character.'],
    [['20\t24'], 'pastAttendance: an edition cannot contain a line break, a tab, or another control character.'],
    [[long], `pastAttendance: "${'x'.repeat(40)}…" is longer than 40 characters.`],
    [['Spring 2024', 'spring 2024'], 'pastAttendance: "spring 2024" is listed twice.'],
  ]) {
    const res = await update(db, { uid: 'uid-ada', pastAttendance });
    assert.equal(res.statusCode, 400, JSON.stringify(pastAttendance));
    assert.equal(res.body.error.message, message);
  }
  // 40 characters and 20 entries are inside the limits.
  const edge = await update(db, {
    uid: 'uid-ada',
    pastAttendance: ['y'.repeat(40), ...Array.from({ length: 19 }, (_, i) => `${2000 + i}`)],
  });
  assert.equal(edge.statusCode, 200);
});

test('updateAttendee refuses any other key by name, an attendee-owned field included', async () => {
  const db = makeFakeDb({ 'users/uid-ada': account() });
  for (const key of ['displayName', 'registrationStatus', 'speakerId', 'role']) {
    const res = await update(db, { uid: 'uid-ada', pastAttendance: [], [key]: 'x' });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error.message, `${key}: cannot be set here. Only pastAttendance is an organizer field.`);
  }
  assert.equal(db.read('users', 'uid-ada').pastAttendance, undefined);
  assert.equal(db.read('users', 'uid-ada').displayName, 'Ada Quill');

  const noUid = await update(db, { pastAttendance: [] });
  assert.equal(noUid.statusCode, 400);
  assert.equal(noUid.body.error.message, 'uid: is required.');
});

test('updateAttendee: 404 for an absent account, never a created one', async () => {
  const db = makeFakeDb();
  const res = await update(db, { uid: 'uid-nobody', pastAttendance: ['2024'] });
  assert.equal(res.statusCode, 404);
  assert.equal(db.read('users', 'uid-nobody'), undefined);
  assert.deepEqual(adminLogs(db), []);
});

test('updateAttendee refuses a wrong method, a stranger, an attendee, and an unverified admin', async () => {
  const db = makeFakeDb({ 'users/uid-ada': account() });
  const body = { uid: 'uid-ada', pastAttendance: ['2024'] };
  const wrong = makeRes();
  await createUpdateAttendeeHandler({ db, auth: makeAuth(), getConfig, log: QUIET })(req('admin', body, 'GET'), wrong);
  assert.equal(wrong.statusCode, 405);
  assert.equal((await update(db, body, null)).statusCode, 401);
  assert.equal((await update(db, body, 'ada')).statusCode, 403);
  assert.equal((await update(db, body, 'admin-unverified')).statusCode, 403);
  assert.equal(db.read('users', 'uid-ada').pastAttendance, undefined);
});

test('updateAttendee admits staff and writes an audit row', async () => {
  const db = makeFakeDb({ 'users/uid-ada': account() });
  const res = await update(db, { uid: 'uid-ada', pastAttendance: ['2024'] }, 'staff');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(adminLogs(db), [{
    action: 'updateAttendee',
    docPath: 'users/uid-ada',
    uid: 'staff-1',
    email: STAFF,
    at: T0,
  }]);
});

// ---------------------------------------------------------------------------
// deleteAttendee
// ---------------------------------------------------------------------------

/**
 * An attendee with something in every per-account store: a directory
 * profile, a schedule share, two saved sessions (one counter at 0 already,
 * to prove the floor), a note, a claimed ticket, a profile photo — and a
 * neighbour whose data must survive untouched.
 */
async function fullySeeded(overrides = {}) {
  const db = makeFakeDb({
    'users/uid-ada': account(overrides),
    'users_public/uid-ada': { displayName: 'Ada Quill', profileVisibility: 'public' },
    'schedule_shares/uid-ada': { sessionIds: ['s1', 's2'], scheduleVisibility: 'public' },
    'sessionBookmarks/s1': { count: 3 },
    'sessionBookmarks/s2': { count: 0 },
    'tickets/tkt-1': { email: 'ada@example.com', status: 'valid', claimedByUid: 'uid-ada', claimedAt: T0 },
    'tickets/tkt-2': { email: 'bo@example.com', status: 'valid', claimedByUid: 'uid-bo', claimedAt: T0 },
    'users/uid-bo': account({ uid: 'uid-bo', email: 'bo@example.com', displayName: 'Bo Reyes' }),
    'users_public/uid-bo': { displayName: 'Bo Reyes', profileVisibility: 'public' },
  });
  await db.collection('users/uid-ada/bookmarks').doc('s1').set({ bookmarkedAt: T0 });
  await db.collection('users/uid-ada/bookmarks').doc('s2').set({ bookmarkedAt: T0 });
  await db.collection('users/uid-ada/sessionNotes').doc('s1').set({ text: 'Ask about the dataset.' });
  await db.collection('users/uid-bo/bookmarks').doc('s1').set({ bookmarkedAt: T0 });
  await db.collection('users/uid-bo/sessionNotes').doc('s1').set({ text: 'Keep me.' });
  return db;
}

function deps(db, { auth = makeAuth({ 'uid-ada': 'ada@example.com', 'uid-bo': 'bo@example.com' }), bucket } = {}) {
  const files = bucket ?? makeBucket([
    'profile-photos/uid-ada/photo.jpg',
    'profile-photos/uid-ada/photo-small.jpg',
    'profile-photos/uid-bo/photo.jpg',
  ]);
  return { db, auth, bucket: files, getConfig, getBucket: () => files, now: () => T0, log: QUIET };
}

async function remove(d, uid = 'uid-ada', token = 'admin') {
  const res = makeRes();
  await createDeleteAttendeeHandler(d)(req(token, { uid }), res);
  return res;
}

/** Assert that nothing of uid-ada was touched. */
function assertUntouched(d) {
  const { db, auth, bucket } = d;
  assert.ok(db.read('users', 'uid-ada'));
  assert.ok(db.read('users_public', 'uid-ada'));
  assert.ok(db.read('schedule_shares', 'uid-ada'));
  assert.deepEqual(db.ids('users/uid-ada/bookmarks').sort(), ['s1', 's2']);
  assert.deepEqual(db.ids('users/uid-ada/sessionNotes'), ['s1']);
  assert.equal(db.read('sessionBookmarks', 's1').count, 3);
  assert.equal(db.read('tickets', 'tkt-1').claimedByUid, 'uid-ada');
  assert.ok(auth.users.has('uid-ada'));
  assert.ok(bucket.files.has('profile-photos/uid-ada/photo.jpg'));
  assert.deepEqual(adminLogs(db), []);
}

/** Assert that the neighbour's data survived a delete of uid-ada. */
function assertNeighbourKept({ db, auth, bucket }) {
  assert.ok(db.read('users', 'uid-bo'));
  assert.ok(db.read('users_public', 'uid-bo'));
  assert.deepEqual(db.ids('users/uid-bo/bookmarks'), ['s1']);
  assert.deepEqual(db.ids('users/uid-bo/sessionNotes'), ['s1']);
  assert.equal(db.read('tickets', 'tkt-2').claimedByUid, 'uid-bo');
  assert.ok(auth.users.has('uid-bo'));
  assert.ok(bucket.files.has('profile-photos/uid-bo/photo.jpg'));
}

test('the per-account store list is one named constant the delete reads', () => {
  assert.deepEqual(
    PER_ACCOUNT_STORES.map((store) => store.collection ?? store.subcollection ?? store.prefix),
    ['users_public', 'schedule_shares', 'tickets', 'bookmarks', 'sessionNotes', 'profile-photos'],
  );
  assert.ok(Object.isFrozen(PER_ACCOUNT_STORES));
  // The account itself, the audit row, and the two directory documents.
  assert.equal(MAX_RELEASED_CLAIMS, 496);
});

test('a delete removes every per-account store, lowers counts to no less than 0, and releases tickets', async () => {
  const d = deps(await fullySeeded());
  const { db, auth, bucket } = d;

  const res = await remove(d);

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, {
    ok: true,
    uid: 'uid-ada',
    removed: { tickets: 1, bookmarks: 2, notes: 1, photos: 2 },
  });
  // Out of the directory.
  assert.equal(db.read('users', 'uid-ada'), undefined);
  assert.equal(db.read('users_public', 'uid-ada'), undefined);
  assert.equal(db.read('schedule_shares', 'uid-ada'), undefined);
  // The sweep.
  assert.ok(!auth.users.has('uid-ada'));
  assert.deepEqual(db.ids('users/uid-ada/bookmarks'), []);
  assert.deepEqual(db.ids('users/uid-ada/sessionNotes'), []);
  assert.equal(db.read('sessionBookmarks', 's1').count, 2);
  assert.equal(db.read('sessionBookmarks', 's2').count, 0);
  assert.equal(bucket.files.has('profile-photos/uid-ada/photo.jpg'), false);
  assert.equal(bucket.files.has('profile-photos/uid-ada/photo-small.jpg'), false);
  // The ticket record stays; its claim is released.
  assert.deepEqual(db.read('tickets', 'tkt-1'), {
    email: 'ada@example.com', status: 'valid', claimedByUid: null, claimedAt: null, updatedAt: T0,
  });
  // One audit row, the actor's, with no trace of the person deleted.
  assert.deepEqual(adminLogs(db), [{
    action: 'deleteAttendee', docPath: 'users/uid-ada', uid: 'admin-1', email: ADMIN, at: T0,
  }]);
  assertNeighbourKept(d);
});

test('the audit row commits in the same transaction as the directory removal', async () => {
  const d = deps(await fullySeeded());
  const { db } = d;
  let seenAtCommit = null;
  db.beforeCommit = async () => {
    seenAtCommit = {
      account: db.read('users', 'uid-ada') !== undefined,
      projection: db.read('users_public', 'uid-ada') !== undefined,
      logs: adminLogs(db).length,
    };
  };

  const res = await remove(d);

  assert.equal(res.statusCode, 200);
  // Nothing was applied before the commit…
  assert.deepEqual(seenAtCommit, { account: true, projection: true, logs: 0 });
  // …and the commit applied the delete and the row together.
  assert.equal(db.read('users', 'uid-ada'), undefined);
  assert.equal(adminLogs(db).length, 1);
});

test('existing audit rows survive the delete', async () => {
  const d = deps(await fullySeeded());
  await d.db.collection('admin_logs').doc('earlier').set({ action: 'approveUser', docPath: 'users/uid-ada' });
  assert.equal((await remove(d)).statusCode, 200);
  assert.deepEqual(d.db.read('admin_logs', 'earlier'), { action: 'approveUser', docPath: 'users/uid-ada' });
});

test('a staff admin may delete an attendee', async () => {
  const d = deps(await fullySeeded());
  const res = await remove(d, 'uid-ada', 'staff');
  assert.equal(res.statusCode, 200);
  assert.equal(adminLogs(d.db)[0].email, STAFF);
});

test('refuses a wrong method, a stranger, an attendee, an unverified admin, and a bad body', async () => {
  const d = deps(await fullySeeded());
  const wrong = makeRes();
  await createDeleteAttendeeHandler(d)(req('admin', { uid: 'uid-ada' }, 'GET'), wrong);
  assert.equal(wrong.statusCode, 405);
  assert.equal((await remove(d, 'uid-ada', null)).statusCode, 401);
  assert.equal((await remove(d, 'uid-ada', 'ada')).statusCode, 403);
  assert.equal((await remove(d, 'uid-ada', 'admin-unverified')).statusCode, 403);

  for (const body of [{}, { uid: '' }, { uid: 'users/uid-ada' }, { uid: 'uid-ada', force: true }]) {
    const res = makeRes();
    await createDeleteAttendeeHandler(d)(req('admin', body), res);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
  }
  assertUntouched(d);
});

test('refuses the caller’s own account and leaves every document in place', async () => {
  const d = deps(await fullySeeded(), {
    auth: makeAuth({ 'uid-ada': 'ada@example.com', 'admin-1': ADMIN }),
  });
  await d.db.collection('users').doc('admin-1').set(account({ uid: 'admin-1', email: ADMIN }));
  const res = await remove(d, 'admin-1');
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'own-account');
  assert.ok(d.db.read('users', 'admin-1'));
  assert.ok(d.auth.users.has('admin-1'));
  assert.deepEqual(adminLogs(d.db), []);
});

test('refuses an account whose address is on either admin list, by the account email or the sign-in email', async () => {
  for (const [label, accountEmail, signInEmail] of [
    ['operator on users.email', 'Admin@Example.com', 'ada@example.com'],
    ['staff on users.email', STAFF, 'ada@example.com'],
    ['operator on the sign-in', 'ada@example.com', 'Owner@example.com'],
    ['staff on the sign-in', 'ada@example.com', 'STAFF@example.com'],
  ]) {
    const d = deps(await fullySeeded({ email: accountEmail }), {
      auth: makeAuth({ 'uid-ada': signInEmail, 'uid-bo': 'bo@example.com' }),
    });
    const res = await remove(d);
    assert.equal(res.statusCode, 409, label);
    assert.equal(res.body.error.code, 'admin-account', label);
    assertUntouched(d);
  }
});

test('refuses a speaker-linked account with the reason, and leaves every document in place', async () => {
  const d = deps(await fullySeeded({ speakerId: 'spk-1' }));
  const res = await remove(d);
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body.error, {
    code: 'speaker-linked',
    message: 'This account is linked to a speaker. Delete the speaker record first.',
  });
  assertUntouched(d);
});

test('a speaker link made while the delete runs aborts it: the retried transaction refuses, nothing deleted', async () => {
  const d = deps(await fullySeeded());
  // The invite acceptance commits between the delete's read and its commit.
  d.db.beforeCommit = async () => {
    await d.db.collection('users').doc('uid-ada').set({ speakerId: 'spk-1' }, { merge: true });
  };

  const res = await remove(d);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'speaker-linked');
  assert.equal(d.db.read('users', 'uid-ada').speakerId, 'spk-1');
  assert.ok(d.db.read('users_public', 'uid-ada'));
  assert.ok(d.db.read('schedule_shares', 'uid-ada'));
  assert.equal(d.db.read('tickets', 'tkt-1').claimedByUid, 'uid-ada');
  assert.ok(d.auth.users.has('uid-ada'));
  assert.deepEqual(adminLogs(d.db), []);
});

test('an admin grant made while the delete runs aborts it too', async () => {
  const d = deps(await fullySeeded());
  d.db.beforeCommit = async () => {
    await d.db.collection('config').doc('bootstrap').set({ ...BOOTSTRAP_DOC, staffEmails: [STAFF, 'ada@example.com'] });
  };
  const res = await remove(d);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'admin-account');
  assert.ok(d.db.read('users', 'uid-ada'));
});

test('refuses more claimed tickets than one transaction can release, naming the count', async () => {
  const db = await fullySeeded();
  for (let i = 0; i < MAX_RELEASED_CLAIMS; i += 1) {
    await db.collection('tickets').doc(`bulk-${i}`).set({ claimedByUid: 'uid-ada', claimedAt: T0 });
  }
  // 1 seeded + 496 = 497 claims.
  const d = deps(db);
  const res = await remove(d);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'too-many-claims');
  assert.equal(res.body.error.message, 'This account holds 497 claimed tickets. One delete can release at most 496.');
  assertUntouched(d);

  // At the limit, it goes through.
  await db.collection('tickets').doc('bulk-0').delete();
  const ok = await remove(d);
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.removed.tickets, 496);
});

test('a sign-in that is already gone counts as removed', async () => {
  const d = deps(await fullySeeded(), { auth: makeAuth({ 'uid-bo': 'bo@example.com' }) });
  const res = await remove(d);
  assert.equal(res.statusCode, 200);
  assert.equal(d.db.read('users', 'uid-ada'), undefined);
});

for (const [step, breakIt] of [
  ['the sign-in', (d) => { d.auth.failDeleteOnce = true; }],
  ['the saved sessions', (d) => {
    const collection = d.db.collection.bind(d.db);
    let failed = false;
    d.db.collection = (name) => {
      const ref = collection(name);
      if (name !== 'users/uid-ada/bookmarks' || failed) return ref;
      const unavailable = {
        limit: () => unavailable,
        async get() {
          failed = true;
          throw new Error('bookmarks unavailable');
        },
      };
      return { ...ref, orderBy: () => unavailable };
    };
  }],
  ['a photo file', (d) => { d.bucket.failDeleteOnce = true; }],
]) {
  test(`a failure clearing ${step} is delete-incomplete with the account already gone, and a retry resumes and finishes`, async () => {
    const d = deps(await fullySeeded());
    breakIt(d);

    const first = await remove(d);

    assert.equal(first.statusCode, 500);
    assert.deepEqual(first.body.error, { code: 'delete-incomplete', message: DELETE_INCOMPLETE_MESSAGE });
    // The account is out of the directory already.
    assert.equal(d.db.read('users', 'uid-ada'), undefined);
    assert.equal(d.db.read('users_public', 'uid-ada'), undefined);
    assert.equal(adminLogs(d.db).length, 1);

    const second = await remove(d);

    assert.equal(second.statusCode, 200, JSON.stringify(second.body));
    assert.ok(!d.auth.users.has('uid-ada'));
    assert.deepEqual(d.db.ids('users/uid-ada/bookmarks'), []);
    assert.deepEqual(d.db.ids('users/uid-ada/sessionNotes'), []);
    assert.equal(d.bucket.files.has('profile-photos/uid-ada/photo.jpg'), false);
    assert.equal(d.bucket.files.has('profile-photos/uid-ada/photo-small.jpg'), false);
    // Each count went down exactly once across both calls.
    assert.equal(d.db.read('sessionBookmarks', 's1').count, 2);
    const logs = adminLogs(d.db);
    assert.equal(logs.length, 2);
    assert.deepEqual(logs.find((row) => row.details), {
      action: 'deleteAttendee',
      docPath: 'users/uid-ada',
      uid: 'admin-1',
      email: ADMIN,
      at: T0,
      details: { resumed: true },
    });
    assertNeighbourKept(d);

    // Nothing remains now, so a third call is a 404 and records nothing.
    const third = await remove(d);
    assert.equal(third.statusCode, 404);
    assert.equal(adminLogs(d.db).length, 2);
  });
}

test('404 only when no account, sign-in, saved session, note, or photo remains', async () => {
  const d = deps(makeFakeDb(), { auth: makeAuth({}), bucket: makeBucket([]) });
  const nothing = await remove(d, 'uid-nobody');
  assert.equal(nothing.statusCode, 404);
  assert.deepEqual(adminLogs(d.db), []);

  // A note left behind with no account and no sign-in is still work to do.
  await d.db.collection('users/uid-left/sessionNotes').doc('s1').set({ text: 'left behind' });
  const leftover = await remove(d, 'uid-left');
  assert.equal(leftover.statusCode, 200);
  assert.deepEqual(d.db.ids('users/uid-left/sessionNotes'), []);
  assert.deepEqual(adminLogs(d.db).map((row) => row.details), [{ resumed: true }]);

  // So is a photo, or a sign-in.
  const photo = deps(makeFakeDb(), { auth: makeAuth({}), bucket: makeBucket(['profile-photos/uid-left/p.jpg']) });
  assert.equal((await remove(photo, 'uid-left')).statusCode, 200);
  const signIn = deps(makeFakeDb(), { auth: makeAuth({ 'uid-left': 'left@example.com' }), bucket: makeBucket([]) });
  assert.equal((await remove(signIn, 'uid-left')).statusCode, 200);
  assert.ok(!signIn.auth.users.has('uid-left'));
});

test('a resumed delete re-checks the admin guard against the remaining sign-in', async () => {
  const d = deps(makeFakeDb(), { auth: makeAuth({ 'uid-left': STAFF }), bucket: makeBucket([]) });
  const res = await remove(d, 'uid-left');
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'admin-account');
  assert.ok(d.auth.users.has('uid-left'));
  assert.deepEqual(adminLogs(d.db), []);
});

test('a resumed delete that cannot record itself removes nothing', async () => {
  const d = deps(makeFakeDb(), { auth: makeAuth({ 'uid-left': 'left@example.com' }), bucket: makeBucket([]) });
  await d.db.collection('users/uid-left/sessionNotes').doc('s1').set({ text: 'left behind' });
  const collection = d.db.collection.bind(d.db);
  d.db.collection = (name) => {
    if (name !== 'admin_logs') return collection(name);
    return { doc: () => ({ async set() { throw new Error('admin_logs unavailable'); } }) };
  };

  const res = await remove(d, 'uid-left');

  assert.equal(res.statusCode, 500);
  assert.match(res.body.error.message, /could not be recorded, so nothing was removed/);
  assert.ok(d.auth.users.has('uid-left'));
  assert.deepEqual(d.db.ids('users/uid-left/sessionNotes'), ['s1']);
});

test('the sweep clears more than one page of every store, a page at a time', async () => {
  const db = makeFakeDb({ 'users/uid-ada': account() });
  for (let i = 0; i < 250; i += 1) {
    const id = `s${String(i).padStart(3, '0')}`;
    await db.collection('sessionBookmarks').doc(id).set({ count: 2 });
    await db.collection('users/uid-ada/bookmarks').doc(id).set({ bookmarkedAt: T0 });
  }
  for (let i = 0; i < 450; i += 1) {
    await db.collection('users/uid-ada/sessionNotes').doc(`n${i}`).set({ text: 'x' });
  }
  const bucket = makeBucket(Array.from({ length: 501 }, (_, i) => `profile-photos/uid-ada/p${i}.jpg`));
  const d = deps(db, { auth: makeAuth({ 'uid-ada': 'ada@example.com' }), bucket });

  const res = await remove(d);

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.removed, { tickets: 0, bookmarks: 250, notes: 450, photos: 501 });
  assert.deepEqual(db.ids('users/uid-ada/bookmarks'), []);
  assert.deepEqual(db.ids('users/uid-ada/sessionNotes'), []);
  assert.equal(bucket.files.size, 0);
  assert.ok(db.ids('sessionBookmarks').every((id) => db.read('sessionBookmarks', id).count === 1));
  // Every listing asked for one page, never the whole prefix.
  assert.ok(bucket.listings.length >= 3);
  assert.ok(bucket.listings.every(({ maxResults, autoPaginate }) => maxResults <= 500 && autoPaginate === false));
});


test('deleteAttendee states its own timeout, long enough for the sweep', () => {
  // The default HTTP timeout is 60 seconds; a gateway 504 then leaves the
  // admin guessing. projection.cjs states its budget the same way.
  const { handlers } = require('./records.cjs');
  assert.equal(handlers.deleteAttendee.__endpoint.timeoutSeconds, 540);
});

// Review finding: an ID token outlives its deleted sign-in by up to an
// hour, and claimTicket (ticketingVerifyOrder) does not need a users doc,
// because a new sign-up may verify an order before its account document
// exists. A claim the deleted session makes after phase 1 must not stay
// on the ticket, or the person's next account is told the ticket is
// somebody else's.
test('a ticket claimed by the deleted session after the delete is released by the next call, not answered 404', async () => {
  const { claimTicket } = require('../ticketing/registration.cjs');
  const d = deps(await fullySeeded());
  await d.db.collection('tickets').doc('tkt-late').set({
    email: 'ada@example.com', status: 'valid', claimedByUid: null, claimedAt: null,
  });
  assert.equal((await remove(d)).statusCode, 200);

  // The deleted session, its token still valid, claims its ticket.
  const ghost = await claimTicket({ db: d.db, externalId: 'tkt-late', uid: 'uid-ada', email: 'ada@example.com' });
  assert.equal(ghost.claimed, true);

  const retry = await remove(d);

  assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
  assert.equal(retry.body.removed.tickets, 1);
  assert.deepEqual(d.db.read('tickets', 'tkt-late'), {
    email: 'ada@example.com', status: 'valid', claimedByUid: null, claimedAt: null, updatedAt: T0,
  });
  assert.deepEqual(adminLogs(d.db).find((logRow) => logRow.details)?.details, { resumed: true });
  // The person's next account can claim their own ticket.
  const again = await claimTicket({ db: d.db, externalId: 'tkt-late', uid: 'uid-ada-new', email: 'ada@example.com' });
  assert.equal(again.claimed, true);
  // And with nothing left, the call after that is a 404.
  assert.equal((await remove(d)).statusCode, 404);
});

test('a claim made while the sweep runs is released in the same call and counted with the rest', async () => {
  const { claimTicket } = require('../ticketing/registration.cjs');
  const d = deps(await fullySeeded());
  await d.db.collection('tickets').doc('tkt-late').set({
    email: 'ada@example.com', status: 'valid', claimedByUid: null, claimedAt: null,
  });
  // Between the directory commit and the rest of the sweep.
  const deleteUser = d.auth.deleteUser.bind(d.auth);
  d.auth.deleteUser = async (uid) => {
    await claimTicket({ db: d.db, externalId: 'tkt-late', uid, email: 'ada@example.com' });
    return deleteUser(uid);
  };

  const res = await remove(d);

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  // tkt-1 in the transaction, tkt-late in the sweep.
  assert.equal(res.body.removed.tickets, 2);
  assert.equal(d.db.read('tickets', 'tkt-1').claimedByUid, null);
  assert.equal(d.db.read('tickets', 'tkt-late').claimedByUid, null);
  assert.equal(d.db.read('tickets', 'tkt-2').claimedByUid, 'uid-bo');
});
