'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runInit, runCheck, runAttestAuth } = require('./init-event.cjs');
const { makeFakeDb } = require('../functions/src/cms/firestoreFake.cjs');
const store = require('../functions/src/cms/store.cjs');
const { buildConfigDocs } = require('./lib/answers.cjs');
const { seedCollection } = require('./lib/write.cjs');

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

test('init seeds the two client-visible email_templates overrides (§5.1 step f)', async () => {
  const db = makeFakeDb();
  await quietly(() =>
    runInit({ db, store, bucket: noBucket, args: initArgs(), tierA: TIER_A, env: ENV, now: () => 0 }));

  const { getDefaultTemplate } = require('../functions/src/email/templates.cjs');
  for (const id of ['ticket.get_ticket', 'ticket.claim_prompt']) {
    const doc = await db.collection('email_templates').doc(id).get();
    assert.equal(doc.exists, true, id);
    const data = doc.data();
    assert.equal(data.seeded, true);
    // The seed is a copy of the shipped default — a starting point
    // guaranteed to validate, not new prose (§6.3, scripts/lib/seed.cjs).
    const template = getDefaultTemplate(id);
    assert.equal(data.subject, template.subject);
    assert.equal(data.html, template.html);
    assert.equal(data.text, template.text);
  }
  // No override is seeded for a template that ships from code only.
  assert.equal((await db.collection('email_templates').doc('auth.otp').get()).exists, false);
});

test('re-running init refreshes an untouched email_templates seed but leaves an edited one alone', async () => {
  const db = makeFakeDb();
  await quietly(() =>
    runInit({ db, store, bucket: noBucket, args: initArgs(), tierA: TIER_A, env: ENV, now: () => 0 }));

  // A client edits the claim prompt's subject; the flag clears, same
  // convention as every other seeded document (idempotency.cjs).
  await db.collection('email_templates').doc('ticket.claim_prompt').set({
    subject: 'Client-written subject',
    html: (await db.collection('email_templates').doc('ticket.claim_prompt').get()).data().html,
    text: (await db.collection('email_templates').doc('ticket.claim_prompt').get()).data().text,
    seeded: false,
  });

  await quietly(() => runInit({
    db, store, bucket: noBucket, args: initArgs({ force: true }), tierA: TIER_A, env: ENV, now: () => 0,
  }));

  const claimPrompt = await db.collection('email_templates').doc('ticket.claim_prompt').get();
  assert.equal(claimPrompt.data().subject, 'Client-written subject', 'client edit survives --force');
  const getTicket = await db.collection('email_templates').doc('ticket.get_ticket').get();
  assert.equal(getTicket.data().seeded, true, 'the untouched sibling still refreshes');
});

test('--dry-run seeds no email_templates override either', async () => {
  const db = makeFakeDb();
  await quietly(() => runInit({
    db, store, bucket: noBucket, args: initArgs({ 'dry-run': true }), tierA: TIER_A, env: ENV, now: () => 0,
  }));
  assert.equal((await db.collection('email_templates').doc('ticket.get_ticket').get()).exists, false);
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

test('a page path already owned by a different page id is skipped, not duplicated (Codex review P1)', async () => {
  // An existing deployment, upgraded to a version of Eventrunner that adds
  // the 'recap' seeded page id for the first time — 'recap' has never
  // existed here. The operator's OWN page already sits at /recap under a
  // different id, from before this upgrade. seedCollection alone would
  // never catch this: it decides purely by doc id, and 'recap' is new.
  const db = makeFakeDb();
  const built = buildConfigDocs({ answers: { ...ANSWERS, adminEmails: ['ops@example.org'] }, tierA: TIER_A, now: () => 0 });
  assert.equal(built.ok, true, built.errors.join('; '));
  await db.collection('config').doc('event').set(built.docs.event); // marks the project already-initialized
  const operator = { uid: 'operator', email: 'operator@example.org' };
  await store.writeDraft({
    db,
    collection: 'cmsPages',
    docId: 'about-us',
    fields: {
      label: 'About us', path: '/recap', icon: null, order: 99,
      visible: true, systemPage: false, sections: [],
    },
    visible: true,
    actor: operator,
    now: () => 1,
  });
  await store.publishDocs({ db, collection: 'cmsPages', docIds: ['about-us'], actor: operator, now: () => 1 });

  const { value, output } = await quietly(() => runInit({
    db, store, bucket: noBucket, args: initArgs({ force: true }), tierA: TIER_A, env: ENV, now: () => 2,
  }));

  assert.equal(value, 0, 'a path collision is reported, not a fatal error');
  assert.match(output, /path \/recap is already owned by page 'about-us' — not seeded/);
  assert.equal((await db.collection('cmsPages').doc('recap').get()).exists, false,
    'the seeded page must never be written at a path another page already owns');
  assert.equal((await db.collection('cmsPages').doc('about-us').get()).data().path, '/recap',
    "the operator's own page keeps the route");
  // Every OTHER seeded page, with no collision of its own, still seeds
  // normally — the preflight must not skip more than the colliding one.
  assert.equal((await db.collection('cmsPages').doc('home').get()).exists, true);
  assert.equal((await db.collection('cmsPages').doc('guidelines').get()).exists, true);
});

test('a page path claimed only by an unpublished draft still blocks the seed', async () => {
  const db = makeFakeDb();
  const built = buildConfigDocs({ answers: { ...ANSWERS, adminEmails: ['ops@example.org'] }, tierA: TIER_A, now: () => 0 });
  assert.equal(built.ok, true, built.errors.join('; '));
  await db.collection('config').doc('event').set(built.docs.event);

  // Drafted, never published: seedCollection's OWN existing-doc check
  // (which reads both revisions) would still write 'guidelines' fine by
  // id, so only the path-collision preflight catches this.
  await store.writeDraft({
    db,
    collection: 'cmsPages',
    docId: 'speaker-notes',
    fields: {
      label: 'Speaker notes', path: '/guidelines', icon: null, order: 50,
      visible: true, systemPage: false, sections: [],
    },
    visible: true,
    actor: { uid: 'operator', email: 'operator@example.org' },
    now: () => 1,
  });

  const { value, output } = await quietly(() => runInit({
    db, store, bucket: noBucket, args: initArgs({ force: true }), tierA: TIER_A, env: ENV, now: () => 2,
  }));

  assert.equal(value, 0);
  assert.match(output, /path \/guidelines is already owned by page 'speaker-notes' — not seeded/);
  assert.equal((await db.collection('cmsPages').doc('guidelines').get()).exists, false);
  assert.equal((await db.collection('cmsPages').doc('recap').get()).exists, true,
    'a collision on one page must not block the rest of the seed');
});

test('a section id already owned by a different page is skipped, not exposed on the seeded page (Codex review P2)', async () => {
  // An existing deployment, upgraded to a version of Eventrunner that adds
  // the 'city_guide' seeded page for the first time. A client's own page
  // already lists 'city_guide_eat' among its own sections — cmsContent is
  // keyed globally by section id, so seeding city_guide over that id would
  // make the client's own content show up on, and become editable from,
  // the new seeded page.
  const db = makeFakeDb();
  const built = buildConfigDocs({ answers: { ...ANSWERS, adminEmails: ['ops@example.org'] }, tierA: TIER_A, now: () => 0 });
  assert.equal(built.ok, true, built.errors.join('; '));
  await db.collection('config').doc('event').set(built.docs.event);
  const operator = { uid: 'operator', email: 'operator@example.org' };
  await store.writeDraft({
    db,
    collection: 'cmsPages',
    docId: 'neighborhood-picks',
    fields: {
      label: 'Neighborhood picks', path: '/neighborhood-picks', icon: null, order: 99,
      visible: true, systemPage: false,
      sections: [{
        id: 'city_guide_eat', label: 'Where we eat', description: '',
        allowedBlocks: ['richtext'], maxBlocks: 5, reorderable: true, defaultBlocks: [],
      }],
    },
    visible: true,
    actor: operator,
    now: () => 1,
  });
  await store.publishDocs({ db, collection: 'cmsPages', docIds: ['neighborhood-picks'], actor: operator, now: () => 1 });

  const { value, output } = await quietly(() => runInit({
    db, store, bucket: noBucket, args: initArgs({ force: true }), tierA: TIER_A, env: ENV, now: () => 2,
  }));

  assert.equal(value, 0, 'a section collision is reported, not a fatal error');
  assert.match(output, /section 'city_guide_eat' is already owned by page 'neighborhood-picks' — not seeded/);
  assert.equal((await db.collection('cmsPages').doc('city_guide').get()).exists, false,
    'the seeded page must never be written over a section id another page already owns');
  assert.equal((await db.collection('cmsPages').doc('neighborhood-picks').get()).data().sections[0].id, 'city_guide_eat',
    "the operator's own page keeps its section");
  // Every OTHER seeded page, with no collision of its own, still seeds
  // normally — the preflight must not skip more than the colliding one.
  assert.equal((await db.collection('cmsPages').doc('home').get()).exists, true);
  assert.equal((await db.collection('cmsPages').doc('recap').get()).exists, true);
});

test('a section id orphaned by a deleted page also blocks the seed', async () => {
  // cmsDeletePage removes the page document, not the cmsContent filed
  // under its sections (spec §5.2), so a doc can be sitting there,
  // ownerless, under a section id a newly-added seeded page also wants —
  // seedCollection's own existing-doc check never sees this, because it
  // only ever looks at cmsPages.
  const db = makeFakeDb();
  const built = buildConfigDocs({ answers: { ...ANSWERS, adminEmails: ['ops@example.org'] }, tierA: TIER_A, now: () => 0 });
  assert.equal(built.ok, true, built.errors.join('; '));
  await db.collection('config').doc('event').set(built.docs.event);
  await db.collection('cmsContent').doc('city_guide_around__note').set({
    section: 'city_guide_around', field: 'note', blockType: 'richtext',
    value: '<p>Left over from a page that no longer exists.</p>', visible: true, order: 0, seeded: false,
  });

  const { value, output } = await quietly(() => runInit({
    db, store, bucket: noBucket, args: initArgs({ force: true }), tierA: TIER_A, env: ENV, now: () => 2,
  }));

  assert.equal(value, 0);
  assert.match(output, /section 'city_guide_around' is orphaned content from a deleted page — not seeded/);
  assert.equal((await db.collection('cmsPages').doc('city_guide').get()).exists, false);
  assert.equal((await db.collection('cmsPages').doc('guidelines').get()).exists, true,
    'a collision on one page must not block the rest of the seed');
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

// UPGRADING A SITE THAT WAS SEEDED BY AN OLDER RELEASE (Codex review of the
// configured registration action: P1). Dropping the hero cta from the seed
// changes nothing on a deployment that already ran init: seedCollection only
// writes, so the old document keeps drawing the control — usually pointed at
// the example.org destination the old seed invented. The --force re-run an
// operator is already told to do after an upgrade is where it gets removed.
test('a --force re-run removes the legacy registration cta the seed no longer ships', async () => {
  const db = makeFakeDb();
  await quietly(() => runInit({ db, store, bucket: noBucket, args: initArgs(), tierA: TIER_A, env: ENV, now: () => 0 }));
  // The document as an older release seeded it, in both revisions.
  await quietly(() => seedCollection({
    db,
    store,
    collection: 'cmsContent',
    docs: [{
      id: 'hero__register_cta',
      section: 'hero',
      field: 'register_cta',
      blockType: 'cta',
      label: 'Register',
      url: 'https://example.org',
      visible: true,
      order: 2,
      seeded: true,
      seededAt: 'T0',
    }],
    now: () => 0,
  }));

  const { value, output } = await quietly(() => runInit({
    db, store, bucket: noBucket, args: initArgs({ force: true }), tierA: TIER_A, env: ENV, now: () => 0,
  }));

  assert.equal(value, 0);
  assert.equal((await db.collection('cmsContent').doc('hero__register_cta').get()).exists, false);
  assert.equal((await db.collection('cmsContent_drafts').doc('hero__register_cta').get()).exists, false);
  assert.match(output, /hero__register_cta/, 'what was removed is reported, not silently deleted');
});

test('a --force re-run keeps a registration cta an editor wrote themselves', async () => {
  const db = makeFakeDb();
  await quietly(() => runInit({ db, store, bucket: noBucket, args: initArgs(), tierA: TIER_A, env: ENV, now: () => 0 }));
  // An editor's own hero action: the seed removed its block, not the slot.
  await db.collection('cmsContent').doc('hero__register_cta').set({
    section: 'hero',
    field: 'register_cta',
    blockType: 'cta',
    label: 'Get a ticket',
    url: 'https://tickets.example.org',
    visible: true,
    order: 2,
    seeded: false,
  });

  await quietly(() => runInit({
    db, store, bucket: noBucket, args: initArgs({ force: true }), tierA: TIER_A, env: ENV, now: () => 0,
  }));

  const kept = await db.collection('cmsContent').doc('hero__register_cta').get();
  assert.equal(kept.exists, true, 'an editor-authored block is not the platform\'s to delete');
  assert.equal(kept.data().label, 'Get a ticket');
});

test('a fresh init has no legacy document to remove and says nothing about one', async () => {
  const db = makeFakeDb();
  const { value, output } = await quietly(() =>
    runInit({ db, store, bucket: noBucket, args: initArgs(), tierA: TIER_A, env: ENV, now: () => 0 }));
  assert.equal(value, 0);
  assert.doesNotMatch(output, /hero__register_cta/);
});
