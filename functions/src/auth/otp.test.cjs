'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createSendOtpHandler, createVerifyOtpHandler, generateOtpCode, internals } = require('./otp.cjs');
const { createChallenge, verifyChallenge, internals: challengeInternals } = require('./challenges.cjs');
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
    async create(data) {
      if (store.has(key(c, id))) {
        const err = new Error('6 ALREADY_EXISTS');
        err.code = 6;
        throw err;
      }
      store.set(key(c, id), data);
    },
    async delete() { store.delete(key(c, id)); },
    async update(patch) {
      if (!store.has(key(c, id))) {
        const err = new Error('5 NOT_FOUND');
        err.code = 5;
        throw err;
      }
      Object.assign(store.get(key(c, id)), patch);
    },
    async get() {
      const data = store.get(key(c, id));
      return { exists: data !== undefined, data: () => data };
    },
  });
  let autoId = 0;
  return {
    store,
    collection: (c) => ({
      doc: (id) => docRef(c, id),
      async add(data) {
        autoId += 1;
        const id = `auto-${autoId}`;
        store.set(key(c, id), data);
        return { id };
      },
    }),
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

function sendDeps({ db = fakeDb(), sendResult, notify, now, sendCeilingMax, sendCeilingWindowMs } = {}) {
  const sent = [];
  const notices = [];
  const deps = {
    db,
    ...(now ? { now } : {}),
    ...(sendCeilingMax ? { sendCeilingMax } : {}),
    ...(sendCeilingWindowMs ? { sendCeilingWindowMs } : {}),
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
  // Durable record independent of the (best-effort) notifier.
  const errorRows = [...db.store.entries()].filter(([k]) => k.startsWith('system_errors/'));
  assert.equal(errorRows.length, 1);
  assert.equal(errorRows[0][1].templateId, 'auth.otp');
  // Deduplicated: a second request against the same broken override must
  // not mint another durable row (this runs before the rate limit).
  await handler({ method: 'POST', body: { email: 'b@example.org' } }, fakeRes());
  const after = [...db.store.keys()].filter((k) => k.startsWith('system_errors/'));
  assert.equal(after.length, 1);
});

// --- issue #45: infra-level throttles ----------------------------------------

test('the send ceiling trips on distinct addresses the per-email bucket never sees', async () => {
  let clock = 1_000_000;
  const { db, sent, notices, handler } = sendDeps({
    now: () => clock, sendCeilingMax: 3, sendCeilingWindowMs: 60_000,
  });

  // Three different addresses: the 5/15min per-address bucket is untouched.
  for (let i = 0; i < 3; i += 1) {
    const res = fakeRes();
    await handler({ method: 'POST', body: { email: `v${i}@example.org` } }, res);
    assert.equal(res.statusCode, 200);
    clock += 1000;
  }

  const tripped = fakeRes();
  await handler({ method: 'POST', body: { email: 'v3@example.org' } }, tripped);
  // Same shape the per-address limit already answers with — no oracle.
  assert.equal(tripped.statusCode, 429);
  assert.equal(tripped.body.error.code, 'rate-limited');
  assert.ok(tripped.body.error.retryAfterSeconds > 0);
  assert.ok(Number(tripped.headers['Retry-After']) > 0);
  assert.equal(sent.length, 3, 'no mail, no provider cost');
  assert.equal([...db.store.keys()].filter((k) => k.startsWith('auth_challenges/')).length, 3);

  // One OperatorEvent per trip episode, not per request.
  assert.equal(notices.length, 1);
  assert.equal(notices[0].kind, 'error');
  assert.match(notices[0].title, /send ceiling/);
  assert.equal(notices[0].dedupeKey, 'otp-send-ceiling-tripped');
  assert.equal(notices[0].fields.ceiling, '3');

  clock += 1000;
  const again = fakeRes();
  await handler({ method: 'POST', body: { email: 'v4@example.org' } }, again);
  assert.equal(again.statusCode, 429);
  assert.equal(notices.length, 1, 'still one alert for this trip');
});

test('the send ceiling resets once the window drains', async () => {
  let clock = 0;
  const { sent, notices, handler } = sendDeps({
    now: () => clock, sendCeilingMax: 2, sendCeilingWindowMs: 60_000,
  });
  for (let i = 0; i < 2; i += 1) {
    await handler({ method: 'POST', body: { email: `v${i}@example.org` } }, fakeRes());
  }
  const tripped = fakeRes();
  await handler({ method: 'POST', body: { email: 'v2@example.org' } }, tripped);
  assert.equal(tripped.statusCode, 429);

  clock = 60_001;
  const recovered = fakeRes();
  await handler({ method: 'POST', body: { email: 'v3@example.org' } }, recovered);
  assert.equal(recovered.statusCode, 200);
  assert.equal(sent.length, 3);

  // A second episode is a second alert.
  await handler({ method: 'POST', body: { email: 'v4@example.org' } }, fakeRes());
  const secondTrip = fakeRes();
  await handler({ method: 'POST', body: { email: 'v5@example.org' } }, secondTrip);
  assert.equal(secondTrip.statusCode, 429);
  assert.equal(notices.length, 2);
});

test('one address cannot spend the whole deployment ceiling', async () => {
  const db = fakeDb();
  const { handler } = sendDeps({ db, sendCeilingMax: 100, sendCeilingWindowMs: 60_000 });
  for (let i = 0; i < challengeInternals.RATE_LIMIT_MAX + 5; i += 1) {
    await handler({ method: 'POST', body: { email: 'a@example.org' } }, fakeRes());
  }
  // The per-address bucket stops it first, so the global counter only ever
  // saw the sends that actually went out.
  assert.equal(
    db.store.get('auth_send_ceiling/global').sends.length,
    challengeInternals.RATE_LIMIT_MAX,
  );
});

test('EVENT_APP_CHECK_ENFORCED gates the enforceAppCheck deploy option', () => {
  assert.deepEqual(internals.appCheckOptions({}), {});
  assert.deepEqual(internals.appCheckOptions({ EVENT_APP_CHECK_ENFORCED: '' }), {});
  assert.deepEqual(internals.appCheckOptions({ EVENT_APP_CHECK_ENFORCED: 'false' }), {});
  // Anything that is not an explicit "true" leaves enforcement off, so a
  // typo'd value cannot lock every client out of sign-in.
  assert.deepEqual(internals.appCheckOptions({ EVENT_APP_CHECK_ENFORCED: 'yes' }), {});
  assert.deepEqual(
    internals.appCheckOptions({ EVENT_APP_CHECK_ENFORCED: ' TRUE ' }),
    { enforceAppCheck: true },
  );
});

test('EVENT_OTP_SEND_CEILING_PER_HOUR parses, and never parses to "no ceiling"', () => {
  assert.equal(internals.parseSendCeiling({}), challengeInternals.SEND_CEILING_MAX);
  assert.equal(internals.parseSendCeiling({ EVENT_OTP_SEND_CEILING_PER_HOUR: ' 50 ' }), 50);
  for (const bad of ['0', '-1', 'lots', '']) {
    assert.equal(
      internals.parseSendCeiling({ EVENT_OTP_SEND_CEILING_PER_HOUR: bad }),
      challengeInternals.SEND_CEILING_MAX,
      `"${bad}" must fall back to the default, not disable the ceiling`,
    );
  }
});

// --- issue #48: the durable row's lifecycle ----------------------------------

test('a resolved system_errors row is reopened when the same fault class recurs', async () => {
  const db = fakeDb();
  db.store.set('email_templates/auth.otp', { html: '<p>Welcome!</p>', text: 'Welcome!' });
  let clock = 1_000_000;
  const { handler } = sendDeps({ db, now: () => clock });

  await handler({ method: 'POST', body: { email: 'a@example.org' } }, fakeRes());
  const [errorKey, first] = [...db.store.entries()].find(([k]) => k.startsWith('system_errors/'));
  assert.equal(first.resolved, false);
  assert.deepEqual(first.lastSeenAt, new Date(1_000_000));

  // The operator fixes the override and marks the row resolved.
  db.store.get(errorKey).resolved = true;

  // A LATER, differently-caused override produces the same validation
  // messages: create() hits ALREADY_EXISTS, so without the reopen the new
  // fault would leave no durable signal at all.
  clock += internals.LAST_SEEN_REFRESH_MS + 1;
  resetTemplateCacheForTest();
  await handler({ method: 'POST', body: { email: 'b@example.org' } }, fakeRes());

  const rows = [...db.store.keys()].filter((k) => k.startsWith('system_errors/'));
  assert.equal(rows.length, 1, 'still one row per fault class');
  const reopened = db.store.get(errorKey);
  assert.equal(reopened.resolved, false);
  assert.deepEqual(reopened.lastSeenAt, new Date(clock));
  assert.deepEqual(reopened.createdAt, new Date(1_000_000), 'first-seen time is preserved');
});

test('reopen refreshes lastSeenAt on a stale unresolved row but not on a fresh one', async () => {
  const db = fakeDb();
  const ref = db.collection('system_errors').doc('fault-1');
  await ref.create({ resolved: false, createdAt: new Date(0), lastSeenAt: new Date(0) });

  // Fresh and already unresolved: no write, so an unauthenticated flood
  // cannot hammer one hot document (the fallback branch runs before the
  // rate limit).
  const fresh = await internals.reopenSystemError({
    db, errorId: 'fault-1', seenAt: new Date(internals.LAST_SEEN_REFRESH_MS - 1),
  });
  assert.equal(fresh, false);
  assert.deepEqual(db.store.get('system_errors/fault-1').lastSeenAt, new Date(0));

  // Stale: refreshed, giving operators a "still happening" signal.
  const stale = new Date(internals.LAST_SEEN_REFRESH_MS + 1);
  assert.equal(await internals.reopenSystemError({ db, errorId: 'fault-1', seenAt: stale }), true);
  assert.deepEqual(db.store.get('system_errors/fault-1').lastSeenAt, stale);

  // A row that vanished between create() and reopen is not resurrected.
  assert.equal(
    await internals.reopenSystemError({ db, errorId: 'missing', seenAt: stale }),
    false,
  );
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
  // The correctly answered challenge survives the transient failure: the
  // same code verifies again without a new email/rate slot.
  const retry = await verifyChallenge({ db, token, email: 'a@example.org', code: '123456' });
  assert.equal(retry.ok, true);
});
