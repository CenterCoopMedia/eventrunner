'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  buildNewUserDoc,
  createOnUserCreated,
  createOnUserDeleted,
  createMaintainProfileComplete,
} = require('./lifecycle.cjs');

const NOW = new Date('2026-08-21T12:00:00Z');
// These tests cover the trigger's own deletes; records.test.cjs covers the
// store clearing it shares with deleteAttendee.
const noStores = async () => ({ removed: {}, failed: [] });

/** Minimal Firestore fake: doc create/update plus a write audit. */
function fakeDb(seed = {}) {
  const docs = new Map(Object.entries({ 'config/event': {}, ...seed }));
  const writes = [];
  return {
    docs,
    writes,
    // A single-field equality query and a transaction that applies its
    // deletes at once: enough for onUserDeleted's representative cleanup.
    async runTransaction(fn) {
      return fn({
        get: (target) => target.get(),
        delete: (ref) => ref.delete(),
      });
    },
    collection(name) {
      const collection = this;
      return {
        where(field, op, value) {
          return {
            async get() {
              const matches = [...docs.entries()]
                .filter(([key, data]) => key.startsWith(`${name}/`) && op === '==' && data?.[field] === value)
                .map(([key, data]) => ({ id: key.slice(name.length + 1), data: () => data, ref: collection.collection(name).doc(key.slice(name.length + 1)) }));
              return { docs: matches, empty: matches.length === 0, size: matches.length };
            },
          };
        },
        doc(id) {
          const key = `${name}/${id}`;
          return {
            async create(data) {
              if (docs.has(key)) {
                const err = new Error('already exists');
                err.code = 6;
                throw err;
              }
              docs.set(key, data);
              writes.push({ type: 'create', path: key });
            },
            async get() {
              const data = docs.get(key);
              return { exists: docs.has(key), data: () => data };
            },
            async delete() {
              docs.delete(key);
              writes.push({ type: 'delete', path: key });
            },
            async update(patch) {
              if (!docs.has(key)) {
                const err = new Error('not found');
                err.code = 5;
                throw err;
              }
              docs.set(key, { ...docs.get(key), ...patch });
              writes.push({ type: 'update', path: key });
            },
          };
        },
      };
    },
  };
}

test('a new account starts pending, non-speaker, and attendees_only', () => {
  const doc = buildNewUserDoc({ uid: 'u1', email: 'Rae@Example.org', displayName: 'Rae' }, NOW);
  assert.equal(doc.registrationStatus, 'pending');
  assert.equal(doc.speakerId, null);
  assert.equal(doc.approvalSource, null);
  assert.equal(doc.profileVisibility, 'attendees_only');
  assert.equal(doc.profileComplete, false);
  assert.equal(doc.email, 'rae@example.org'); // lowercased for matching
  assert.equal(doc.displayName, 'Rae');
  assert.deepEqual(doc.createdAt, NOW);
});

test('a provider that supplies no name leaves displayName empty rather than guessing', () => {
  const doc = buildNewUserDoc({ uid: 'u1', email: 'rae@example.org', displayName: null }, NOW);
  assert.equal(doc.displayName, '');
  assert.equal(doc.email, 'rae@example.org');
});

test('onUserCreated seeds the account document', async () => {
  const db = fakeDb();
  const result = await createOnUserCreated({ db, now: () => NOW })({
    uid: 'u1',
    email: 'rae@example.org',
    displayName: 'Rae',
  });
  assert.equal(result.created, true);
  assert.equal(db.docs.get('users/u1').registrationStatus, 'pending');
});

test('a retried delivery never overwrites an existing account with pending defaults', async () => {
  const db = fakeDb({ 'users/u1': { registrationStatus: 'approved', approvalSource: 'admin' } });
  const result = await createOnUserCreated({ db, now: () => NOW })({ uid: 'u1' });
  assert.equal(result.created, false);
  assert.equal(db.docs.get('users/u1').registrationStatus, 'approved');
  assert.deepEqual(db.writes, []);
});

test('onUserCreated without a uid writes nothing', async () => {
  const db = fakeDb();
  const errors = [];
  const result = await createOnUserCreated({ db, now: () => NOW, log: { error: () => errors.push(1) } })(null);
  assert.equal(result.created, false);
  assert.deepEqual(db.writes, []);
  assert.equal(errors.length, 1);
});

test('deleting the auth account deletes the account document', async () => {
  const db = fakeDb({
    'users/u1': { uid: 'u1', displayName: 'Rae' },
    'users_public/u1': { uid: 'u1', displayName: 'Rae' },
  });
  const result = await createOnUserDeleted({ db, clearStores: noStores })({ uid: 'u1' });
  assert.equal(result.deleted, true);
  assert.equal(db.docs.has('users/u1'), false);
  assert.equal(db.docs.has('users_public/u1'), false);
  assert.deepEqual(db.writes, [
    { type: 'delete', path: 'users/u1' },
    { type: 'delete', path: 'users_public/u1' },
    { type: 'delete', path: 'schedule_shares/u1' },
  ]);
});

test('a deleted account with no document still has its projection and public schedule removed', async () => {
  // No users doc means no projection trigger will fire. The public profile
  // and the shared schedule would stay readable. Issue #350.
  const db = fakeDb({
    'users_public/u1': { uid: 'u1', displayName: 'Rae' },
    'schedule_shares/u1': { sessionIds: ['s1'], scheduleVisibility: 'public', displayName: 'Rae' },
  });
  const result = await createOnUserDeleted({ db, clearStores: noStores })({ uid: 'u1' });
  assert.equal(result.deleted, false);
  assert.equal(db.docs.has('users_public/u1'), false);
  assert.equal(db.docs.has('schedule_shares/u1'), false);
});

// Issue #334 (Codex review on #540): an account deleted straight from
// Firebase Auth, not through deleteAttendee, must not leave a grant that a
// recycled uid could use, or a queued edit naming the deleted person.
test('deleting the auth account removes its representative grant and the edit it sent, and nobody else’s', async () => {
  const db = fakeDb({
    'users/u1': { uid: 'u1' },
    'organization_representatives/u1': { uid: 'u1', organizationId: 'beacon-fund' },
    'organization_representatives/u2': { uid: 'u2', organizationId: 'tide-media' },
    'organization_edit_requests/beacon-fund': { organizationId: 'beacon-fund', fields: { bio: 'x' }, submittedByUid: 'u1' },
    'organization_edit_requests/tide-media': { organizationId: 'tide-media', fields: { bio: 'y' }, submittedByUid: 'u2' },
  });
  const result = await createOnUserDeleted({ db, clearStores: noStores })({ uid: 'u1' });
  assert.equal(result.deleted, true);
  assert.equal(db.docs.has('users/u1'), false);
  assert.equal(db.docs.has('organization_representatives/u1'), false);
  assert.equal(db.docs.has('organization_edit_requests/beacon-fund'), false);
  assert.equal(db.docs.has('organization_representatives/u2'), true);
  assert.equal(db.docs.has('organization_edit_requests/tide-media'), true);
});

test('the cleanup runs for an account with no document too, and keeps an edit another account sent', async () => {
  const db = fakeDb({
    'organization_representatives/u1': { uid: 'u1', organizationId: 'beacon-fund' },
    // A second representative of the same organization sent this one.
    'organization_edit_requests/beacon-fund': { organizationId: 'beacon-fund', fields: { bio: 'x' }, submittedByUid: 'u3' },
  });
  const result = await createOnUserDeleted({ db, clearStores: noStores })({ uid: 'u1' });
  assert.equal(result.deleted, false);
  assert.equal(db.docs.has('organization_representatives/u1'), false);
  assert.equal(db.docs.has('organization_edit_requests/beacon-fund'), true);
});

test('onUserDeleted without a uid writes nothing', async () => {
  const db = fakeDb({ 'users/u1': { uid: 'u1' } });
  const errors = [];
  const result = await createOnUserDeleted({ db, clearStores: noStores, log: { error: () => errors.push(1) } })(null);
  assert.equal(result.deleted, false);
  assert.deepEqual(db.writes, []);
  assert.equal(errors.length, 1);
});

test('maintainProfileComplete flips the derived flag once the profile is filled in', async () => {
  const db = fakeDb({ 'users/u1': { displayName: '', profileVisibility: 'attendees_only', profileComplete: false } });
  const maintain = createMaintainProfileComplete({ db });

  const unchanged = await maintain({ uid: 'u1', after: db.docs.get('users/u1') });
  assert.equal(unchanged.action, 'unchanged');

  const after = { displayName: 'Rae', profileVisibility: 'attendees_only', profileComplete: false };
  db.docs.set('users/u1', after);
  const written = await maintain({ uid: 'u1', after });
  assert.equal(written.action, 'written');
  assert.equal(db.docs.get('users/u1').profileComplete, true);

  // Loop safety: the write it just made must not produce another write.
  const settled = await maintain({ uid: 'u1', after: db.docs.get('users/u1') });
  assert.equal(settled.action, 'unchanged');
});

test('maintainProfileComplete clears the flag when a profile is emptied out', async () => {
  const after = { displayName: '  ', profileVisibility: 'attendees_only', profileComplete: true };
  const db = fakeDb({ 'users/u1': after });
  const result = await createMaintainProfileComplete({ db })({ uid: 'u1', after });
  assert.equal(result.action, 'written');
  assert.equal(db.docs.get('users/u1').profileComplete, false);
});

test('maintainProfileComplete ignores a deleted account', async () => {
  const db = fakeDb();
  const result = await createMaintainProfileComplete({ db })({ uid: 'u1', after: null });
  assert.equal(result.action, 'unchanged');
  assert.deepEqual(db.writes, []);
});

test('onUserCreated suppresses account records for historical demos, including repeat Auth deliveries', async () => {
  const db = fakeDb({ 'config/event': { historicalDemo: true } });
  const create = createOnUserCreated({ db });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    assert.deepEqual(await create({ uid: 'u1', email: 'rae@example.org' }), {
      created: false, reason: 'read-only-demo',
    });
  }
  assert.equal(db.docs.has('users/u1'), false);
  assert.deepEqual(db.writes, []);
});

test('onUserCreated retries unavailable policy without writing and recovers after configuration is restored', async () => {
  const db = fakeDb();
  const create = createOnUserCreated({ db });
  db.docs.delete('config/event');
  await assert.rejects(create({ uid: 'u1' }), { code: 'config-unavailable' });
  db.docs.set('config/event', { historicalDemo: 'false' });
  await assert.rejects(create({ uid: 'u1' }), { code: 'config-unavailable' });
  assert.deepEqual(db.writes, []);
  db.docs.set('config/event', { historicalDemo: false });
  assert.deepEqual(await create({ uid: 'u1' }), { created: true });
});

test('Auth deletion retries public cleanup after the account document is gone', async () => {
  const db = fakeDb({
    'users/u1': { uid: 'u1' },
    'users_public/u1': { displayName: 'Rae' },
    'schedule_shares/u1': { scheduleVisibility: 'public' },
  });
  const collection = db.collection.bind(db);
  let fail = true;
  db.collection = (name) => {
    const col = collection(name);
    const doc = col.doc.bind(col);
    col.doc = (uid) => {
      const ref = doc(uid);
      const remove = ref.delete.bind(ref);
      ref.delete = async () => {
        if (name === 'users_public' && fail) {
          fail = false;
          throw new Error('transient cleanup failure');
        }
        return remove();
      };
      return ref;
    };
    return col;
  };
  const remove = createOnUserDeleted({ db, clearStores: noStores });
  await assert.rejects(remove({ uid: 'u1' }), /transient cleanup failure/);
  assert.equal(db.docs.has('users/u1'), false);
  await remove({ uid: 'u1' });
  assert.equal(db.docs.has('users_public/u1'), false);
  assert.equal(db.docs.has('schedule_shares/u1'), false);
});

test('onUserDeleted throws when a store cannot be cleared, so the trigger retries', async () => {
  const db = fakeDb({ 'users/u1': { uid: 'u1' } });
  const failing = async () => ({ removed: {}, failed: ['tickets'] });
  await assert.rejects(createOnUserDeleted({ db, clearStores: failing })({ uid: 'u1' }), /could not clear tickets/);
  // The account document went first; a retry finds it gone and clears again.
  assert.equal(db.docs.has('users/u1'), false);
});

// --- the welcome email (ADR 0001 §3.1, §6.2; audit 02 #9) -------------------

const SITE = 'https://summit.example.org';
const welcomeConfig = async () => ({ event: { name: 'Summit 2027' }, tierA: { publicUrl: `${SITE}/` } });

/** A recording sendEmail that answers as the core does. */
function fakeSend(result = { status: 'sent', providerMessageId: 'pm-1', retries: 0 }) {
  const calls = [];
  const send = async (message) => {
    calls.push(message);
    return typeof result === 'function' ? result(message) : result;
  };
  return { calls, send };
}

test('a new account gets one welcome email with the right template, tokens and send-once key', async () => {
  const db = fakeDb();
  const mail = fakeSend();
  const result = await createOnUserCreated({ db, now: () => NOW, sendEmail: mail.send, getConfig: welcomeConfig })({
    uid: 'u1', email: 'Rae@Example.org', displayName: 'Rae Kim',
  });
  assert.deepEqual(result, { created: true });
  assert.equal(db.docs.get('users/u1').registrationStatus, 'pending');
  assert.equal(mail.calls.length, 1);
  const [message] = mail.calls;
  assert.equal(message.to, 'rae@example.org');
  assert.equal(message.tag, 'account.welcome');
  assert.equal(message.source, 'account-welcome');
  assert.equal(message.onceKey, 'welcome:u1');
  assert.equal(message.subject, 'Welcome to Summit 2027');
  assert.match(message.text, /^Hi Rae,/);
  assert.match(message.text, /Sign in: https:\/\/summit\.example\.org\/signin/);
  assert.match(message.text, /your profile: https:\/\/summit\.example\.org\/profile/);
  assert.match(message.html, /href="https:\/\/summit\.example\.org\/signin"/);
  assert.match(message.html, /href="https:\/\/summit\.example\.org\/profile"/);
  assert.equal(message.storeRendered, true);
});

test('an account with no name is greeted as "there", never by its address', async () => {
  const mail = fakeSend();
  await createOnUserCreated({ db: fakeDb(), now: () => NOW, sendEmail: mail.send, getConfig: welcomeConfig })({
    uid: 'u1', email: 'rae@example.org', displayName: null,
  });
  assert.match(mail.calls[0].text, /^Hi there,/);
});

test('a repeat delivery asks for the same send-once key and writes the account only once', async () => {
  const db = fakeDb();
  const mail = fakeSend();
  const create = createOnUserCreated({ db, now: () => NOW, sendEmail: mail.send, getConfig: welcomeConfig });
  await create({ uid: 'u1', email: 'rae@example.org' });
  await create({ uid: 'u1', email: 'rae@example.org' });
  assert.deepEqual(db.writes, [{ type: 'create', path: 'users/u1' }]);
  // The core's email_claims row makes the second call send nothing.
  assert.deepEqual(mail.calls.map((m) => m.onceKey), ['welcome:u1', 'welcome:u1']);
});

test('an account another path wrote first still gets the welcome email', async () => {
  // createUserFromTicket can write users/{uid} before this trigger runs.
  const db = fakeDb({ 'users/u1': { uid: 'u1', email: 'rae@example.org', registrationStatus: 'approved' } });
  const mail = fakeSend();
  const result = await createOnUserCreated({ db, now: () => NOW, sendEmail: mail.send, getConfig: welcomeConfig })({
    uid: 'u1', email: 'rae@example.org',
  });
  assert.equal(result.created, false);
  assert.equal(db.docs.get('users/u1').registrationStatus, 'approved');
  assert.equal(mail.calls.length, 1);
});

test('an account with no email address gets no welcome email', async () => {
  const db = fakeDb();
  const mail = fakeSend();
  for (const email of [null, undefined, '', '   ']) {
    await createOnUserCreated({ db, now: () => NOW, sendEmail: mail.send, getConfig: welcomeConfig })({ uid: `u-${String(email)}`, email });
  }
  assert.equal(mail.calls.length, 0);
});

test('a historical demo sends no welcome email', async () => {
  const db = fakeDb({ 'config/event': { historicalDemo: true } });
  const mail = fakeSend();
  await createOnUserCreated({ db, sendEmail: mail.send, getConfig: welcomeConfig })({ uid: 'u1', email: 'rae@example.org' });
  assert.equal(mail.calls.length, 0);
});

test('an event with no public site address sends no welcome email: the sign-in link would be empty', async () => {
  const mail = fakeSend();
  await createOnUserCreated({
    db: fakeDb(), now: () => NOW, sendEmail: mail.send, getConfig: async () => ({ event: { name: 'Summit' } }),
  })({ uid: 'u1', email: 'rae@example.org' });
  assert.equal(mail.calls.length, 0);
});

test('a welcome email on the announcement stream is refused, as other notices are', async () => {
  const mail = fakeSend();
  const getConfig = async () => ({
    ...(await welcomeConfig()),
    providers: { email: { messageStream: 'broadcast', announcementStream: 'broadcast' } },
  });
  await createOnUserCreated({ db: fakeDb(), now: () => NOW, sendEmail: mail.send, getConfig })({ uid: 'u1', email: 'rae@example.org' });
  assert.equal(mail.calls.length, 0);
});

test('a send that throws leaves the account written and does not fail the trigger', async () => {
  const db = fakeDb();
  const errors = [];
  const log = { error: (...args) => errors.push(args), warn() {} };
  const send = async () => { throw new Error('provider unreachable'); };
  const result = await createOnUserCreated({ db, now: () => NOW, sendEmail: send, getConfig: welcomeConfig, log })({
    uid: 'u1', email: 'rae@example.org',
  });
  assert.deepEqual(result, { created: true });
  assert.equal(db.docs.get('users/u1').registrationStatus, 'pending');
  assert.equal(errors.length, 1);
});

test('a config read that fails, or a refused send, leaves the account written and does not throw', async () => {
  const log = { error() {}, warn() {} };
  const failingConfig = async () => { throw new Error('config unavailable'); };
  const db = fakeDb();
  const mail = fakeSend();
  assert.deepEqual(
    await createOnUserCreated({ db, now: () => NOW, sendEmail: mail.send, getConfig: failingConfig, log })({ uid: 'u1', email: 'rae@example.org' }),
    { created: true },
  );
  assert.equal(db.docs.has('users/u1'), true);
  assert.equal(mail.calls.length, 0);

  const refused = fakeSend({ status: 'failed', providerStatus: 422, error: 'inactive recipient', retries: 0 });
  const errors = [];
  assert.deepEqual(
    await createOnUserCreated({ db, now: () => NOW, sendEmail: refused.send, getConfig: welcomeConfig, log: { error: (...a) => errors.push(a), warn() {} } })({ uid: 'u2', email: 'kim@example.org' }),
    { created: true },
  );
  assert.equal(db.docs.has('users/u2'), true);
  assert.equal(errors.length, 1);
});

test('Auth handlers use the compute runtime, and only onUserCreated binds send secrets without building a provider', () => {
  const saved = { provider: process.env.EVENT_EMAIL_PROVIDER, project: process.env.GCLOUD_PROJECT, runtime: process.env.EVENT_COMPUTE_SERVICE_ACCOUNT, emulator: process.env.FUNCTIONS_EMULATOR };
  // A postmark deployment: getEmailProvider would throw here with no API key,
  // so a handler built eagerly would fail this test.
  process.env.EVENT_EMAIL_PROVIDER = 'postmark';
  // v1 functions read their endpoint lazily and need a project id.
  process.env.GCLOUD_PROJECT = saved.project || 'demo-run-of-show';
  process.env.EVENT_COMPUTE_SERVICE_ACCOUNT = '555000111-compute@developer.gserviceaccount.com';
  process.env.FUNCTIONS_EMULATOR = 'false';
  try {
    const { handlers } = require('./lifecycle.cjs');
    const secretsOf = (fn) => (fn.__endpoint?.secretEnvironmentVariables ?? []).map((s) => s.key);
    assert.deepEqual(secretsOf(handlers.onUserCreated), ['EMAIL_PROVIDER_API_KEY']);
    assert.equal(handlers.onUserCreated.__endpoint.eventTrigger.retry, true);
    assert.deepEqual(secretsOf(handlers.onUserDeleted), []);
    for (const fn of [handlers.onUserCreated, handlers.onUserDeleted]) {
      assert.equal(fn.__endpoint.platform, 'gcfv1');
      assert.equal(fn.__endpoint.serviceAccountEmail.value(), '555000111-compute@developer.gserviceaccount.com');
      assert.equal(fn.__endpoint.eventTrigger.retry, true);
    }
  } finally {
    for (const [key, name] of [['provider', 'EVENT_EMAIL_PROVIDER'], ['project', 'GCLOUD_PROJECT'], ['runtime', 'EVENT_COMPUTE_SERVICE_ACCOUNT'], ['emulator', 'FUNCTIONS_EMULATOR']]) {
      if (saved[key] === undefined) delete process.env[name];
      else process.env[name] = saved[key];
    }
  }
});

test('real SDK emulator discovery declares no cloud runtime param and preserves Auth behavior', () => {
  const script = `
    const path = require('node:path');
    const sdk = path.dirname(require.resolve('firebase-functions'));
    const { loadStack } = require(path.join(sdk, '../runtime/loader.js'));
    loadStack(path.resolve('functions')).then((stack) => {
      const created = stack.endpoints.onUserCreated;
      const deleted = stack.endpoints.onUserDeleted;
      console.log(JSON.stringify({
        params: (stack.params || []).map((param) => param.name),
        createdSecrets: created.secretEnvironmentVariables.map((secret) => secret.key),
        retry: [created.eventTrigger.retry, deleted.eventTrigger.retry],
      }));
    }).catch(() => process.exit(1));
  `;
  const output = execFileSync(process.execPath, ['-e', script], {
    cwd: path.resolve(__dirname, '../../..'),
    env: { ...process.env, GCLOUD_PROJECT: 'demo-runtime-contract', FUNCTIONS_EMULATOR: 'true', EVENT_EMAIL_PROVIDER: 'postmark', EVENT_COMPUTE_SERVICE_ACCOUNT: '' },
    timeout: 5000,
    encoding: 'utf8',
  });
  const result = JSON.parse(output);
  assert.ok(!result.params.includes('EVENT_COMPUTE_SERVICE_ACCOUNT'));
  assert.deepEqual(result.createdSecrets, ['EMAIL_PROVIDER_API_KEY']);
  assert.deepEqual(result.retry, [true, true]);
});

test('an Owner or an Editor on config/bootstrap gets no welcome email, and the account is still written', async () => {
  // The same rule as the ticket prompt: whoever runs the site is not welcomed to it.
  const db = fakeDb({
    'config/bootstrap': { adminEmails: ['Owner@Example.org'], staffEmails: ['editor@example.org'] },
  });
  const mail = fakeSend();
  const create = createOnUserCreated({ db, now: () => NOW, sendEmail: mail.send, getConfig: welcomeConfig });
  await create({ uid: 'owner', email: 'owner@example.org' });
  await create({ uid: 'editor', email: 'Editor@example.org' });
  await create({ uid: 'attendee', email: 'rae@example.org' });
  assert.equal(db.docs.get('users/owner').registrationStatus, 'pending');
  assert.equal(db.docs.get('users/editor').registrationStatus, 'pending');
  assert.deepEqual(mail.calls.map((m) => m.to), ['rae@example.org']);
});

test('a coming-soon site sends no welcome email', async () => {
  const mail = fakeSend();
  await createOnUserCreated({
    db: fakeDb({ 'config/launch': { comingSoon: true } }), now: () => NOW, sendEmail: mail.send, getConfig: welcomeConfig,
  })({ uid: 'u1', email: 'rae@example.org' });
  assert.equal(mail.calls.length, 0);
});
