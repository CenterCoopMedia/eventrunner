'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { makeFakeDb: makeBareFakeDb } = require('../cms/firestoreFake.cjs');

// requireAdmin reads config/bootstrap LIVE from the db it is handed (issue
// #186 review: it fails closed on an absent document), so every fake this
// file builds carries the document the file's getConfig describes.
const BOOTSTRAP_DOC = { adminEmails: ['admin@example.com'], staffEmails: ['staff@example.com'] };
const makeFakeDb = (seed = {}) => makeBareFakeDb({ 'config/bootstrap': BOOTSTRAP_DOC, ...seed });
const {
  createApproveUserHandler,
  createRevokeUserHandler,
} = require('./approval.cjs');

const QUIET = { warn() {}, error() {}, info() {} };
const T0 = new Date('2026-08-20T10:00:00.000Z');
const ADMIN = 'admin@example.com';

function makeRes() {
  const res = {
    statusCode: null, body: null, headers: {},
    set(n, v) { res.headers[n] = v; return res; },
    status(c) { res.statusCode = c; return res; },
    json(p) { res.body = p; return res; },
  };
  return res;
}

const auth = {
  async verifyIdToken(token) {
    const table = {
      admin: { uid: 'admin-1', email: ADMIN, email_verified: true },
      ada: { uid: 'uid-ada', email: 'attendee@example.com', email_verified: true },
      'admin-unverified': { uid: 'admin-1', email: ADMIN, email_verified: false },
    };
    if (!table[token]) throw new Error('invalid token');
    return table[token];
  },
};

const getConfig = async () => ({ bootstrap: { adminEmails: [ADMIN] }, features: {} });

const req = (token, body = { uid: 'uid-ada' }, method = 'POST') => ({
  method,
  headers: token ? { authorization: `Bearer ${token}` } : {},
  body,
});

function seeded(overrides = {}) {
  return makeFakeDb({
    'users/uid-ada': {
      uid: 'uid-ada', registrationStatus: 'pending', approvalSource: null, ...overrides,
    },
  });
}

const approve = (db) => createApproveUserHandler({ db, auth, getConfig, now: () => T0, log: QUIET });
const revoke = (db) => createRevokeUserHandler({ db, auth, getConfig, now: () => T0, log: QUIET });

function adminLogs(db) {
  return db.ids('admin_logs').map((id) => db.read('admin_logs', id));
}

// ---------------------------------------------------------------------------
// The gate.
// ---------------------------------------------------------------------------

test('both endpoints refuse anyone who is not an admin', async () => {
  for (const handler of [approve, revoke]) {
    const db = seeded();
    const anon = makeRes();
    await handler(db)(req(null), anon);
    assert.equal(anon.statusCode, 401);

    const attendee = makeRes();
    await handler(db)(req('ada'), attendee);
    assert.equal(attendee.statusCode, 403);

    const unverified = makeRes();
    await handler(db)(req('admin-unverified'), unverified);
    assert.equal(unverified.statusCode, 403);

    assert.equal(db.read('users', 'uid-ada').registrationStatus, 'pending');
    assert.deepEqual(adminLogs(db), []);
  }
});

test('both endpoints are POST-only and require a uid', async () => {
  const db = seeded();
  const wrongMethod = makeRes();
  await approve(db)(req('admin', { uid: 'uid-ada' }, 'GET'), wrongMethod);
  assert.equal(wrongMethod.statusCode, 405);

  const noUid = makeRes();
  await revoke(db)(req('admin', {}), noUid);
  assert.equal(noUid.statusCode, 400);
});

test('an unknown account is a 404, not a created one', async () => {
  const db = seeded();
  const res = makeRes();
  await approve(db)(req('admin', { uid: 'uid-nobody' }), res);
  assert.equal(res.statusCode, 404);
  assert.equal(db.read('users', 'uid-nobody'), undefined);
});

// ---------------------------------------------------------------------------
// approveUser — the §3.4 admin edges.
// ---------------------------------------------------------------------------

test('approveUser takes pending → approved with approvalSource "admin"', async () => {
  const db = seeded();
  const res = makeRes();

  await approve(db)(req('admin'), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    ok: true, uid: 'uid-ada', changed: true,
    registrationStatus: 'approved', approvalSource: 'admin',
    // The seeded account has no email address, so nothing was sent.
    emailed: false,
  });
  const stored = db.read('users', 'uid-ada');
  assert.equal(stored.registrationStatus, 'approved');
  assert.equal(stored.approvalSource, 'admin');
  assert.deepEqual(stored.updatedAt, T0);
});

test('approveUser takes ticketed → approved', async () => {
  const db = seeded({ registrationStatus: 'ticketed' });
  const res = makeRes();
  await approve(db)(req('admin'), res);
  assert.equal(db.read('users', 'uid-ada').registrationStatus, 'approved');
});

test('approveUser takes revoked → approved (admin_reapproval)', async () => {
  const db = seeded({ registrationStatus: 'revoked' });
  const res = makeRes();
  await approve(db)(req('admin'), res);
  assert.equal(res.statusCode, 200);
  const stored = db.read('users', 'uid-ada');
  assert.equal(stored.registrationStatus, 'approved');
  assert.equal(stored.approvalSource, 'admin');
});

test('approving an auto-approved account re-pins approvalSource to admin, so a refund cannot reverse it', async () => {
  const db = seeded({ registrationStatus: 'approved', approvalSource: 'ticket' });
  const res = makeRes();

  await approve(db)(req('admin'), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.changed, true);
  assert.equal(db.read('users', 'uid-ada').approvalSource, 'admin');
});

test('approving an already admin-approved account is an unchanged no-op', async () => {
  const db = seeded({ registrationStatus: 'approved', approvalSource: 'admin' });
  const res = makeRes();

  await approve(db)(req('admin'), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.changed, false);
  // Still audited: an admin pressed the button.
  assert.equal(adminLogs(db).length, 1);
});

// ---------------------------------------------------------------------------
// revokeUser.
// ---------------------------------------------------------------------------

test('revokeUser takes approved → revoked and CLEARS approvalSource (§3.4)', async () => {
  const db = seeded({ registrationStatus: 'approved', approvalSource: 'admin' });
  const res = makeRes();

  await revoke(db)(req('admin'), res);

  assert.equal(res.statusCode, 200);
  const stored = db.read('users', 'uid-ada');
  assert.equal(stored.registrationStatus, 'revoked');
  assert.equal(stored.approvalSource, null);
});

test('revokeUser takes ticketed → revoked', async () => {
  const db = seeded({ registrationStatus: 'ticketed' });
  const res = makeRes();
  await revoke(db)(req('admin'), res);
  assert.equal(db.read('users', 'uid-ada').registrationStatus, 'revoked');
});

test('revoking a pending account is refused — the table has no such edge', async () => {
  const db = seeded({ registrationStatus: 'pending' });
  const res = makeRes();

  await revoke(db)(req('admin'), res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'invalid-transition');
  assert.equal(db.read('users', 'uid-ada').registrationStatus, 'pending');
});

test('revoking an already revoked account is an unchanged no-op', async () => {
  const db = seeded({ registrationStatus: 'revoked' });
  const res = makeRes();
  await revoke(db)(req('admin'), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.changed, false);
});

test('an account carrying an unknown status is refused by both endpoints', async () => {
  // The reference implementation's legacy vocabulary (`registered`,
  // `confirmed`, `ticket_only`) does not exist in v1 — a document carrying
  // one is not a state this table can transition out of.
  for (const handler of [approve, revoke]) {
    const db = seeded({ registrationStatus: 'ticket_only' });
    const res = makeRes();
    await handler(db)(req('admin'), res);
    assert.equal(res.statusCode, 409);
    assert.equal(db.read('users', 'uid-ada').registrationStatus, 'ticket_only');
  }
});

// ---------------------------------------------------------------------------
// Audit.
// ---------------------------------------------------------------------------

test('each accepted action writes one admin_logs row naming the actor and the account', async () => {
  const db = seeded();
  await approve(db)(req('admin'), makeRes());
  await revoke(db)(req('admin'), makeRes());

  const logs = adminLogs(db);
  assert.deepEqual(logs.map((row) => row.action).sort(), ['approveUser', 'revokeUser']);
  for (const row of logs) {
    assert.equal(row.docPath, 'users/uid-ada');
    assert.equal(row.uid, 'admin-1');
    assert.equal(row.email, ADMIN);
  }
});

test('a refused transition writes no audit row and no state', async () => {
  const db = seeded({ registrationStatus: 'pending' });
  await revoke(db)(req('admin'), makeRes());
  assert.deepEqual(adminLogs(db), []);
});

// ------------------------------------------------------- the two tiers (#186)

test('a staff admin may approve and revoke — attendees are staff work', async () => {
  const STAFF = 'staff@example.com';
  const staffAuth = {
    async verifyIdToken(token) {
      if (token === 'staff') return { uid: 'staff-1', email: STAFF, email_verified: true };
      throw new Error('invalid token');
    },
  };
  const tiered = async () => ({ bootstrap: { adminEmails: [ADMIN], staffEmails: [STAFF] }, features: {} });
  const db = seeded();
  const res = makeRes();
  await createApproveUserHandler({ db, auth: staffAuth, getConfig: tiered, now: () => T0, log: QUIET })(req('staff'), res);
  assert.equal(res.statusCode, 200);
  assert.equal(db.read('users', 'uid-ada').registrationStatus, 'approved');
  assert.equal(adminLogs(db)[0].email, STAFF);
});

// ------------------------------------------------ attendee.approved (ADR 0008 §5)

const MAIL_CONFIG = {
  bootstrap: { adminEmails: [ADMIN] }, features: {},
  event: { name: 'Example Summit 2027' },
  tierA: { publicUrl: 'https://summit.example.org/' },
};
const NO_QUESTIONS = { revision: 1, standard: { organization: { enabled: false }, dietary: { enabled: false }, directoryListing: { enabled: false } }, custom: [] };
const ONE_QUESTION = { revision: 2, standard: { organization: { enabled: true } } };

async function approveWithMail(db, sendResult = { status: 'sent' }) {
  const sent = [];
  const res = makeRes();
  const sendEmail = async (message) => {
    sent.push(message);
    if (sendResult instanceof Error) throw sendResult;
    return sendResult;
  };
  await createApproveUserHandler({ db, auth, getConfig: async () => MAIL_CONFIG, sendEmail, now: () => T0, log: QUIET })(req('admin'), res);
  return { res, sent };
}
const withEmail = (form, user = {}) => makeFakeDb({
  'users/uid-ada': { uid: 'uid-ada', email: 'ada@example.org', displayName: 'Ada Lovelace', registrationStatus: 'pending', approvalSource: null, ...user },
  ...(form ? { 'config/registration_form': form } : {}),
});

test('an approval sends the attendee one attendee.approved email, once per account', async () => {
  const db = withEmail(ONE_QUESTION);
  const { res, sent } = await approveWithMail(db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.emailed, true);
  assert.equal(sent.length, 1);
  const [mail] = sent;
  assert.equal(mail.to, 'ada@example.org');
  assert.equal(mail.tag, 'attendee.approved');
  assert.equal(mail.onceKey, 'attendee-approved:uid-ada');
  assert.equal(mail.subject, 'You are registered for Example Summit 2027');
  assert.match(mail.text, /https:\/\/summit\.example\.org\/dashboard/);
  assert.match(mail.text, /registration questions yet, answer them here:\nhttps:\/\/summit\.example\.org\/registration/);
  assert.match(mail.html, /<a href="https:\/\/summit\.example\.org\/registration">answer them here<\/a>/);
  assert.match(mail.html, /href="https:\/\/summit\.example\.org\/dashboard"/);
  // A second press is a no-op and sends nothing.
  const again = await approveWithMail(db);
  assert.equal(again.res.body.changed, false);
  assert.equal(again.sent.length, 0);
});

test('the registration line is left out when the form asks no questions', async () => {
  for (const form of [NO_QUESTIONS, null]) {
    const { sent } = await approveWithMail(withEmail(form));
    assert.equal(sent.length, 1);
    assert.doesNotMatch(sent[0].text, /registration questions/);
    assert.doesNotMatch(sent[0].html, /registration questions/);
  }
});

test('a failed email never fails the approval', async () => {
  const db = withEmail(ONE_QUESTION);
  const { res } = await approveWithMail(db, new Error('provider down'));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.emailed, false);
  assert.equal(db.read('users', 'uid-ada').registrationStatus, 'approved');
});

test('an account without an email address is approved and sent nothing', async () => {
  const db = withEmail(ONE_QUESTION, { email: null });
  const { res, sent } = await approveWithMail(db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.emailed, false);
  assert.equal(sent.length, 0);
});
