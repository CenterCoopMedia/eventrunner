'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createSendOtpHandler, createVerifyOtpHandler, generateOtpCode, internals } = require('./otp.cjs');
const { createChallenge, internals: challengeInternals } = require('./challenges.cjs');
const { resetTemplateCacheForTest } = require('../email/templates.cjs');

// loadTemplate caches overrides per id for 5 minutes at module scope.
test.beforeEach(() => resetTemplateCacheForTest());

// Reuse the challenge-store fake: the handlers only touch Firestore through
// challenges.cjs plus templates.cjs's loadTemplate (email_templates reads).
function fakeDb() {
  const store = new Map();
  const key = (c, id) => `${c}/${id}`;
  const docRef = (c, id) => ({
    __c: c,
    __id: id,
    async set(data) { store.set(key(c, id), data); },
    async delete() { store.delete(key(c, id)); },
    async get() {
      const data = store.get(key(c, id));
      return { exists: data !== undefined, data: () => data };
    },
  });
  return {
    store,
    collection: (c) => ({ doc: (id) => docRef(c, id) }),
    async runTransaction(fn) {
      return fn({
        get: async (ref) => ref.get(),
        set: (ref, data) => { store.set(key(ref.__c, ref.__id), data); },
        update: (ref, patch) => { Object.assign(store.get(key(ref.__c, ref.__id)), patch); },
        delete: (ref) => { store.delete(key(ref.__c, ref.__id)); },
      });
    },
  };
}

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    set(k, v) { this.headers[k] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

const CONFIG = {
  event: {
    name: 'Example Summit',
    shortName: 'EX27',
    sender: { email: 's@example.org', name: 'Example Summit' },
    legal: { postalAddressHtml: 'Example Org<br>1 Main St', supportEmail: 'help@example.org' },
  },
  theme: { colors: { primary: 'BRAND', ink: 'INK' } },
  tierA: { publicUrl: 'https://summit.example.org' },
};

function sendDeps({ db = fakeDb(), sendResult, notify } = {}) {
  const sent = [];
  const notices = [];
  const deps = {
    db,
    getConfig: async () => CONFIG,
    sendEmail: async (m) => {
      sent.push(m);
      return sendResult || { providerMessageId: 'id', status: 'sent', providerStatus: 200, retries: 0 };
    },
    notifyOperator: notify === false ? undefined : async (e) => { notices.push(e); return { delivered: true, sink: 'test' }; },
    log: { error() {}, warn() {} },
  };
  return { db, sent, notices, handler: createSendOtpHandler(deps) };
}

test('generateOtpCode is 6 digits with leading zeros kept', () => {
  for (let i = 0; i < 200; i += 1) {
    assert.match(generateOtpCode(), /^\d{6}$/);
  }
});

test('sendOtpCode happy path: challenge stored, mail sent with code in both bodies, no body storage', async () => {
  const { db, sent, handler } = sendDeps({});
  const res = fakeRes();
  await handler({ method: 'POST', body: { email: ' A@Example.org ' } }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.body.challengeId, /^[0-9a-f]{64}$/);
  assert.equal(res.body.expiresInMinutes, internals.EXPIRY_MINUTES);

  const challenge = db.store.get(`auth_challenges/${res.body.challengeId}`);
  assert.equal(challenge.email, 'a@example.org');

  assert.equal(sent.length, 1);
  const mail = sent[0];
  assert.equal(mail.to, 'a@example.org');
  assert.equal(mail.tag, 'auth.otp');
  assert.equal(mail.storeRendered, false);
  // The code in the challenge hash must be the code in the mail: verify by
  // extracting the 6-digit code from the text body and checking it's in html too.
  const code = mail.text.match(/\b(\d{6})\b/)[1];
  assert.ok(mail.html.includes(code));
});

test('sendOtpCode rejects invalid email and non-POST', async () => {
  const { handler } = sendDeps({});
  const bad = fakeRes();
  await handler({ method: 'POST', body: { email: 'not-an-email' } }, bad);
  assert.equal(bad.statusCode, 400);
  const get = fakeRes();
  await handler({ method: 'GET', body: {} }, get);
  assert.equal(get.statusCode, 405);
});

test('sendOtpCode rate-limits the 6th request with Retry-After and sends no mail', async () => {
  const { db, sent, handler } = sendDeps({});
  for (let i = 0; i < challengeInternals.RATE_LIMIT_MAX; i += 1) {
    const res = fakeRes();
    await handler({ method: 'POST', body: { email: 'a@example.org' } }, res);
    assert.equal(res.statusCode, 200);
  }
  const res = fakeRes();
  await handler({ method: 'POST', body: { email: 'a@example.org' } }, res);
  assert.equal(res.statusCode, 429);
  assert.ok(Number(res.headers['Retry-After']) > 0);
  // The hint rides in the body too — Retry-After is unreadable cross-origin.
  assert.ok(res.body.error.retryAfterSeconds > 0);
  assert.equal(sent.length, challengeInternals.RATE_LIMIT_MAX);
  assert.equal(db.store.size >= challengeInternals.RATE_LIMIT_MAX, true);
});

test('a broken auth.otp override falls back to the default and notifies the operator', async () => {
  const db = fakeDb();
  // Valid per save-time checks it never went through: omits {{code}}.
  db.store.set('email_templates/auth.otp', { html: '<p>Welcome!</p>', text: 'Welcome!' });
  const { sent, notices, handler } = sendDeps({ db });
  const res = fakeRes();
  await handler({ method: 'POST', body: { email: 'a@example.org' } }, res);
  // Fallback keeps sign-in working: mail sent from the shipped default.
  assert.equal(res.statusCode, 200);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /\d{6}/);
  assert.equal(notices.length, 1);
  assert.match(notices[0].title, /auth\.otp override/);
});

test('the send-boundary gate: unit truth table', () => {
  assert.equal(
    internals.renderedMailCarriesCode({ html: '<p>123456</p>', text: 'no code here' }, '123456'),
    false,
  );
  assert.equal(
    internals.renderedMailCarriesCode({ html: '<p>123456</p>', text: '123456' }, '123456'),
    true,
  );
  assert.equal(internals.renderedMailCarriesCode({ html: 'x', text: 'y' }, ''), false);
});

test('a code-free render 500s at the handler and spends no rate slot, challenge, or mail', async () => {
  const db = fakeDb();
  const sent = [];
  const handler = createSendOtpHandler({
    db,
    getConfig: async () => CONFIG,
    sendEmail: async (m) => { sent.push(m); return { status: 'sent', providerMessageId: 'id', retries: 0 }; },
    log: { error() {}, warn() {} },
    // Injected render seam: a "valid" render whose bodies lack the code —
    // the gate must catch it BEFORE the rate slot (spec §6.1).
    renderFn: () => ({
      subject: 's', html: '<p>welcome</p>', text: 'welcome',
      usedFallback: false, overrideErrors: [], warnings: [],
      storeRendered: false, hasLegalFooterHtml: true, hasLegalFooterText: true,
    }),
  });
  const res = fakeRes();
  await handler({ method: 'POST', body: { email: 'a@example.org' } }, res);
  assert.equal(res.statusCode, 500);
  assert.equal(sent.length, 0);
  const keys = [...db.store.keys()];
  assert.equal(keys.filter((k) => k.startsWith('auth_rate_limits/')).length, 0);
  assert.equal(keys.filter((k) => k.startsWith('auth_challenges/')).length, 0);
});

test('sendOtpCode maps a failed provider send to 502', async () => {
  const { handler } = sendDeps({ sendResult: { providerMessageId: null, status: 'failed', error: 'down', retries: 2 } });
  const res = fakeRes();
  await handler({ method: 'POST', body: { email: 'a@example.org' } }, res);
  assert.equal(res.statusCode, 502);
});

// --- verify ------------------------------------------------------------------

function fakeAuth() {
  const users = new Map(); // email -> uid
  return {
    users,
    async getUserByEmail(email) {
      if (!users.has(email)) {
        const err = new Error('no user');
        err.code = 'auth/user-not-found';
        throw err;
      }
      return { uid: users.get(email) };
    },
    async createUser({ email }) {
      const uid = `uid-${users.size + 1}`;
      users.set(email, uid);
      return { uid };
    },
    async createCustomToken(uid) {
      return `custom-token-for-${uid}`;
    },
  };
}

test('verifyOtpCode: full round trip creates the user and returns a custom token', async () => {
  const db = fakeDb();
  const auth = fakeAuth();
  const { token } = await createChallenge({ db, email: 'a@example.org', code: '123456' });
  const handler = createVerifyOtpHandler({ db, auth });
  const res = fakeRes();
  await handler({ method: 'POST', body: { challengeId: token, email: 'a@example.org', code: '123456' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.token, 'custom-token-for-uid-1');
  assert.equal(auth.users.get('a@example.org'), 'uid-1');
});

test('verifyOtpCode: existing user is reused, not recreated', async () => {
  const db = fakeDb();
  const auth = fakeAuth();
  auth.users.set('a@example.org', 'uid-existing');
  const { token } = await createChallenge({ db, email: 'a@example.org', code: '123456' });
  const handler = createVerifyOtpHandler({ db, auth });
  const res = fakeRes();
  await handler({ method: 'POST', body: { challengeId: token, email: 'A@Example.org', code: '123456' } }, res);
  assert.equal(res.body.token, 'custom-token-for-uid-existing');
});

test('verifyOtpCode: wrong code, bad shapes, and replay all fail with one shape', async () => {
  const db = fakeDb();
  const auth = fakeAuth();
  const { token } = await createChallenge({ db, email: 'a@example.org', code: '123456' });
  const handler = createVerifyOtpHandler({ db, auth });

  const wrong = fakeRes();
  await handler({ method: 'POST', body: { challengeId: token, email: 'a@example.org', code: '654321' } }, wrong);
  assert.equal(wrong.statusCode, 401);
  assert.equal(wrong.body.error.code, 'invalid-code');

  const badShape = fakeRes();
  await handler({ method: 'POST', body: { challengeId: token, email: 'a@example.org', code: '12345' } }, badShape);
  assert.equal(badShape.statusCode, 400);

  const ok = fakeRes();
  await handler({ method: 'POST', body: { challengeId: token, email: 'a@example.org', code: '123456' } }, ok);
  assert.equal(ok.statusCode, 200);

  const replay = fakeRes();
  await handler({ method: 'POST', body: { challengeId: token, email: 'a@example.org', code: '123456' } }, replay);
  assert.equal(replay.statusCode, 401);
  assert.equal(replay.body.error.code, 'invalid-code');
});

test('verifyOtpCode: an unexpected auth error is a 500, not user creation', async () => {
  const db = fakeDb();
  const auth = fakeAuth();
  auth.getUserByEmail = async () => { const e = new Error('backend down'); e.code = 'auth/internal-error'; throw e; };
  const { token } = await createChallenge({ db, email: 'a@example.org', code: '123456' });
  const handler = createVerifyOtpHandler({ db, auth, log: { error() {}, warn() {} } });
  const res = fakeRes();
  await handler({ method: 'POST', body: { challengeId: token, email: 'a@example.org', code: '123456' } }, res);
  assert.equal(res.statusCode, 500);
});
