'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runInit, runCheck, runAttestAuth } = require('./init-event.cjs');
const { makeFakeDb } = require('../functions/src/cms/firestoreFake.cjs');
const store = require('../functions/src/cms/store.cjs');

const TIER_A = Object.freeze({
  slug: 'test-event',
  projectId: 'test-project',
  publicUrl: 'https://example.org',
  emailProvider: 'console',
  ticketingProvider: 'none',
  ticketingEventId: null,
  operatorNotifier: 'none',
});

/**
 * A complete Tier A environment. init validates this before the first
 * write, so every test that expects a seed to happen needs it — which is
 * the point: a half-configured environment must not reach Firestore.
 */
const ENV = Object.freeze({
  EVENT_SLUG: 'test-event',
  EVENT_FIREBASE_PROJECT_ID: 'test-project',
  EVENT_PUBLIC_URL: 'https://example.org',
  EVENT_STORAGE_BUCKET: 'test-bucket',
  EVENT_ALLOWED_ORIGINS: 'https://example.org',
  EVENT_EMAIL_PROVIDER: 'console',
  EVENT_TICKETING_PROVIDER: 'none',
  EVENT_OPERATOR_NOTIFIER: 'none',
  EVENT_HOSTING_SITE: 'test-site',
  VITE_FIREBASE_API_KEY: 'x',
  VITE_FIREBASE_AUTH_DOMAIN: 'x',
  VITE_FIREBASE_PROJECT_ID: 'x',
  VITE_FIREBASE_STORAGE_BUCKET: 'x',
  VITE_FIREBASE_MESSAGING_SENDER_ID: 'x',
  VITE_FIREBASE_APP_ID: 'x',
  VITE_FIREBASE_MEASUREMENT_ID: 'x',
  VITE_EVENT_PUBLIC_URL: 'https://example.org',
});

const ANSWERS = {
  event: {
    name: 'Test Gathering',
    shortName: 'TEST',
    timezone: 'UTC',
    sender: { email: 'hello@example.org' },
    legal: { operatorName: 'Test Operator', supportEmail: 'support@example.org' },
  },
};

function answersFile(answers = ANSWERS) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'init-event-')), 'answers.json');
  fs.writeFileSync(file, JSON.stringify(answers));
  return file;
}

/** Silence the CLI's own reporting; tests assert on state, not stdout. */
function quietly(fn) {
  const log = console.log;
  const warn = console.warn;
  const error = console.error;
  const output = [];
  console.log = (...a) => output.push(a.join(' '));
  console.warn = (...a) => output.push(a.join(' '));
  console.error = (...a) => output.push(a.join(' '));
  return Promise.resolve()
    .then(fn)
    .then((value) => ({ value, output: output.join('\n') }))
    .finally(() => { console.log = log; console.warn = warn; console.error = error; });
}

// A bucket that is not provisioned: init must warn, not fail (§5.1.1).
const noBucket = () => { throw new Error('EVENT_STORAGE_BUCKET is not set'); };

function initArgs(overrides = {}) {
  return { answers: answersFile(), admin: ['ops@example.org'], ...overrides };
}

test('init seeds config, pages, and content, and exits 0 despite unmet readiness rows', async () => {
  const db = makeFakeDb();
  const { value, output } = await quietly(() =>
    runInit({ db, store, bucket: noBucket, args: initArgs(), tierA: TIER_A, env: ENV, now: () => 0 }));

  assert.equal(value, 0, 'init is the gate on nothing (§5.1.1)');
  assert.equal((await db.collection('config').doc('event').get()).exists, true);
  assert.equal((await db.collection('config').doc('bootstrap').get()).data().adminEmails[0], 'ops@example.org');
  assert.equal((await db.collection('cmsPages').doc('privacy').get()).exists, true);
  assert.equal((await db.collection('cmsContent').doc('hero__title').get()).data().value, 'Test Gathering');
  assert.match(output, /UNMET/, 'unmet rows are reported as warnings');
  assert.match(output, /Legal review/);
});

test('init prints the manual checklist including the Firebase Auth steps (§5.6)', async () => {
  const db = makeFakeDb();
  const { output } = await quietly(() =>
    runInit({ db, store, bucket: noBucket, args: initArgs(), tierA: TIER_A, env: ENV, now: () => 0 }));
  assert.match(output, /Authentication → Sign-in method → enable Google/);
  assert.match(output, /Authorized domains/);
  assert.match(output, /ops@example\.org/);
  assert.match(output, /second admin/);
});

test('an unprovisioned Storage bucket is a warning, not a failed init', async () => {
  const db = makeFakeDb();
  const { value, output } = await quietly(() =>
    runInit({ db, store, bucket: noBucket, args: initArgs(), tierA: TIER_A, env: ENV, now: () => 0 }));
  assert.equal(value, 0);
  assert.match(output, /EVENT_STORAGE_BUCKET is not set/);
});

test('a second init against the same project refuses before writing anything', async () => {
  const db = makeFakeDb();
  await quietly(() => runInit({ db, store, bucket: noBucket, args: initArgs(), tierA: TIER_A, env: ENV, now: () => 0 }));
  await db.collection('cmsContent').doc('hero__title').set({ value: 'Client copy', seeded: false });

  const { value, output } = await quietly(() =>
    runInit({ db, store, bucket: noBucket, args: initArgs(), tierA: TIER_A, env: ENV, now: () => 0 }));
  assert.equal(value, 2);
  assert.match(output, /--force/);
  assert.equal((await db.collection('cmsContent').doc('hero__title').get()).data().value, 'Client copy');
});

test('--force re-runs the seed but leaves client-edited documents alone', async () => {
  const db = makeFakeDb();
  await quietly(() => runInit({ db, store, bucket: noBucket, args: initArgs(), tierA: TIER_A, env: ENV, now: () => 0 }));
  await db.collection('cmsContent').doc('hero__title').set({ value: 'Client copy', seeded: false });

  const { value } = await quietly(() => runInit({
    db, store, bucket: noBucket, args: initArgs({ force: true }), tierA: TIER_A, env: ENV, now: () => 0,
  }));
  assert.equal(value, 0);
  assert.equal((await db.collection('cmsContent').doc('hero__title').get()).data().value, 'Client copy');
  assert.equal((await db.collection('cmsContent').doc('hero__subtitle').get()).data().seeded, true);
});

test('--dry-run writes nothing', async () => {
  const db = makeFakeDb();
  const { value } = await quietly(() => runInit({
    db, store, bucket: noBucket, args: initArgs({ 'dry-run': true }), tierA: TIER_A, env: ENV, now: () => 0,
  }));
  assert.equal(value, 0);
  assert.equal(db.writes.length, 0);
});

test('invalid answers stop the run before the first write', async () => {
  const db = makeFakeDb();
  const { value, output } = await quietly(() => runInit({
    db,
    store,
    bucket: noBucket,
    args: { answers: answersFile({ event: { ...ANSWERS.event, timezone: 'Mars/Olympus' } }), admin: ['ops@example.org'] },
    tierA: TIER_A,
    env: ENV,
    now: () => 0,
  }));
  assert.equal(value, 2);
  assert.match(output, /timezone/);
  assert.equal(db.writes.length, 0);
});

test('missing admin addresses stop the run — an event with no admin is unusable', async () => {
  const db = makeFakeDb();
  const { value, output } = await quietly(() => runInit({
    db, store, bucket: noBucket, args: { answers: answersFile() }, tierA: TIER_A, env: ENV, now: () => 0,
  }));
  assert.equal(value, 2);
  assert.match(output, /adminEmails/);
});

test('an incomplete Tier A environment stops the run before the first write', async () => {
  // getTierA() reads the environment without judging it, so an unset
  // EVENT_EMAIL_PROVIDER would quietly become `console` in
  // config/providers and only surface hours later, when the functions
  // runtime refuses to build a provider in production.
  const db = makeFakeDb();
  const { EVENT_EMAIL_PROVIDER, ...incomplete } = ENV;
  const { value, output } = await quietly(() => runInit({
    db, store, bucket: noBucket, args: initArgs(), tierA: TIER_A, env: incomplete, now: () => 0,
  }));
  assert.equal(value, 2);
  assert.match(output, /EVENT_EMAIL_PROVIDER/);
  assert.equal(db.writes.length, 0, 'nothing may be written on a rejected environment');
});

test('an invalid Tier A value is fatal too, not just an absent one', async () => {
  const db = makeFakeDb();
  const { value, output } = await quietly(() => runInit({
    db,
    store,
    bucket: noBucket,
    args: initArgs(),
    tierA: TIER_A,
    env: { ...ENV, EVENT_EMAIL_PROVIDER: 'sendmail' },
    now: () => 0,
  }));
  assert.equal(value, 2);
  assert.match(output, /EVENT_EMAIL_PROVIDER/);
});

test('missing frontend build keys warn but do not block the seed', async () => {
  // VITE_* gates the build, not the seed; the build fails loudly on its own.
  const db = makeFakeDb();
  const { VITE_FIREBASE_API_KEY, ...noViteKey } = ENV;
  const { value, output } = await quietly(() => runInit({
    db, store, bucket: noBucket, args: initArgs(), tierA: TIER_A, env: noViteKey, now: () => 0,
  }));
  assert.equal(value, 0);
  assert.match(output, /VITE_FIREBASE_API_KEY/);
});

test('under the emulator an incomplete environment is a warning — it is not a deployment', async () => {
  const db = makeFakeDb();
  const { value, output } = await quietly(() => runInit({
    db,
    store,
    bucket: noBucket,
    args: initArgs(),
    tierA: TIER_A,
    env: { EVENT_FIREBASE_PROJECT_ID: 'demo-run-of-show', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' },
    now: () => 0,
  }));
  assert.equal(value, 0);
  assert.match(output, /EVENT_EMAIL_PROVIDER/);
  assert.equal((await db.collection('config').doc('event').get()).exists, true);
});

test('--check gates on the readiness table and exits non-zero while anything is unmet', async () => {
  const db = makeFakeDb();
  await quietly(() => runInit({ db, store, bucket: noBucket, args: initArgs(), tierA: TIER_A, env: ENV, now: () => 0 }));

  const fresh = await quietly(() => runCheck({ db, seededThreshold: 0 }));
  assert.equal(fresh.value, 1);
  assert.match(fresh.output, /not ready to launch/);
});

test('--check passes once every row is satisfied', async () => {
  const db = makeFakeDb();
  await quietly(() => runInit({ db, store, bucket: noBucket, args: initArgs(), tierA: TIER_A, env: ENV, now: () => 0 }));

  // Everything a client and the operator would do between init and launch.
  const event = (await db.collection('config').doc('event').get()).data();
  await db.collection('config').doc('event').set({
    ...event,
    legal: { ...event.legal, reviewRequired: false },
    sender: { ...event.sender, domainVerified: true, domainVerifiedAt: '2027-01-01T00:00:00Z' },
  });
  await quietly(() => runAttestAuth({ db, store, dryRun: false, env: ENV, now: () => 0 }));
  const theme = (await db.collection('config').doc('theme').get()).data();
  await db.collection('config').doc('theme').set({ ...theme, placeholderLogos: [] });
  const bootstrap = (await db.collection('config').doc('bootstrap').get()).data();
  await db.collection('config').doc('bootstrap').set({
    ...bootstrap,
    adminEmails: [...bootstrap.adminEmails, 'second@example.org'],
  });
  for (const doc of (await db.collection('cmsContent').where('seeded', '==', true).get()).docs) {
    await db.collection('cmsContent').doc(doc.id).set({ ...doc.data(), seeded: false });
  }

  const ready = await quietly(() => runCheck({ db, seededThreshold: 0 }));
  assert.equal(ready.value, 0);
  assert.match(ready.output, /ready to launch/);
});

test('--check on an uninitialized project says so instead of reporting seven failures', async () => {
  const { value, output } = await quietly(() => runCheck({ db: makeFakeDb(), seededThreshold: 0 }));
  assert.equal(value, 2);
  assert.match(output, /has not been initialized/);
});

test('--attest-auth refreshes the seeded legal copy that describes sign-in', async () => {
  // The privacy policy states which sign-in methods exist. It was composed
  // when the answer was "emailed codes only"; enabling Google sign-in makes
  // the published text wrong until it is rebuilt.
  const db = makeFakeDb();
  await quietly(() => runInit({ db, store, bucket: noBucket, args: initArgs(), tierA: TIER_A, env: ENV, now: () => 0 }));
  const before = (await db.collection('cmsContent').doc('privacy_data__signin').get()).data();
  assert.doesNotMatch(before.value, /Google sign-in/);

  await quietly(() => runAttestAuth({ db, store, dryRun: false, env: ENV, now: () => 0 }));
  const after = (await db.collection('cmsContent').doc('privacy_data__signin').get()).data();
  assert.match(after.value, /Google sign-in/);
  assert.equal(after.seeded, true, 'a refreshed template is still sample content');
});

test('--attest-auth leaves legal copy a client has already edited alone', async () => {
  const db = makeFakeDb();
  await quietly(() => runInit({ db, store, bucket: noBucket, args: initArgs(), tierA: TIER_A, env: ENV, now: () => 0 }));
  await db.collection('cmsContent').doc('privacy_data__signin').set({
    section: 'privacy_data', field: 'signin', blockType: 'richtext',
    value: '<p>Counsel-approved sign-in paragraph.</p>', visible: true, order: 1, seeded: false,
  });

  await quietly(() => runAttestAuth({ db, store, dryRun: false, env: ENV, now: () => 0 }));
  const after = (await db.collection('cmsContent').doc('privacy_data__signin').get()).data();
  assert.equal(after.value, '<p>Counsel-approved sign-in paragraph.</p>');
});

test('a --force re-init rebuilds legal copy from stored config, not from pre-attestation answers', async () => {
  const db = makeFakeDb();
  await quietly(() => runInit({ db, store, bucket: noBucket, args: initArgs(), tierA: TIER_A, env: ENV, now: () => 0 }));
  await quietly(() => runAttestAuth({ db, store, dryRun: false, env: ENV, now: () => 0 }));

  await quietly(() => runInit({
    db, store, bucket: noBucket, args: initArgs({ force: true }), tierA: TIER_A, env: ENV, now: () => 0,
  }));
  const after = (await db.collection('cmsContent').doc('privacy_data__signin').get()).data();
  assert.match(after.value, /Google sign-in/, 'the answers file says false; the project says true');
});

test('--attest-auth records the operator attestation the Auth row reads', async () => {
  const db = makeFakeDb();
  await quietly(() => runInit({ db, store, bucket: noBucket, args: initArgs(), tierA: TIER_A, env: ENV, now: () => 0 }));
  await quietly(() => runAttestAuth({ db, store, dryRun: false, env: ENV, now: () => 0 }));
  const auth = (await db.collection('config').doc('event').get()).data().auth;
  assert.equal(auth.googleProviderEnabled, true);
  assert.equal(auth.authorizedDomainsConfigured, true);
  assert.ok(auth.attestedAt);
});
