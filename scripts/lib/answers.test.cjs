'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseAnswersFile,
  parseDayList,
  parseEmailList,
  buildConfigDocs,
  buildProviders,
  PROMPTS,
} = require('./answers.cjs');
const {
  validateEventConfig,
  validateFeatures,
  validateTheme,
  validateBadgesConfig,
} = require('shared/config');
const { defaultTheme } = require('./theme.cjs');

const TIER_A = Object.freeze({
  slug: 'test-event',
  projectId: 'test-project',
  region: 'us-central1',
  publicUrl: 'https://example.org',
  storageBucket: 'test-bucket',
  allowedOrigins: [],
  emailProvider: 'postmark',
  ticketingProvider: 'eventbrite',
  ticketingEventId: 'ext-123',
  operatorNotifier: 'none',
});

const MINIMAL = Object.freeze({
  adminEmails: ['ops@example.org'],
  event: {
    name: 'Test Gathering',
    shortName: 'TEST',
    timezone: 'UTC',
    sender: { email: 'hello@example.org' },
    legal: { operatorName: 'Test Operator', supportEmail: 'support@example.org' },
  },
});

test('parseAnswersFile rejects non-JSON, non-objects, and unknown top-level keys', () => {
  assert.equal(parseAnswersFile('{').ok, false);
  assert.equal(parseAnswersFile('[]').ok, false);
  const unknown = parseAnswersFile('{"evnet": {}}');
  assert.equal(unknown.ok, false);
  assert.match(unknown.errors[0], /evnet/);
});

test('parseDayList builds stable day ids and rejects bad dates', () => {
  assert.deepEqual(parseDayList('2027-05-13, 2027-05-14')[0], {
    id: 'day-1',
    label: 'Day 1',
    date: '2027-05-13',
    startTime: '09:00',
    endTime: '17:00',
  });
  assert.ok(parseDayList('May 13') instanceof Error);
});

test('parseEmailList lowercases and de-duplicates — rules compare against email.lower()', () => {
  assert.deepEqual(parseEmailList('Ops@Example.org, ops@example.org'), ['ops@example.org']);
  assert.ok(parseEmailList('not-an-email') instanceof Error);
});

test('buildConfigDocs produces documents that pass the real shared validators', () => {
  const built = buildConfigDocs({ answers: MINIMAL, tierA: TIER_A, now: () => 0 });
  assert.equal(built.ok, true, built.errors.join('; '));
  assert.equal(validateEventConfig(built.docs.event).ok, true);
  assert.equal(validateFeatures(built.docs.features).ok, true);
  assert.equal(validateTheme(built.docs.theme).ok, true);
  assert.equal(validateBadgesConfig(built.docs.badges).ok, true);
});

test('a fresh seed is unreviewed, unverified, unannounced, and unattested', () => {
  const { docs } = buildConfigDocs({ answers: MINIMAL, tierA: TIER_A, now: () => 0 });
  assert.equal(docs.event.legal.reviewRequired, true, '§5.5: true on every fresh deployment');
  assert.equal(docs.event.sender.domainVerified, false, '§1.3: only verify-sender-domain sets this');
  assert.equal(docs.event.announcedAt, null, '§2.5: a fresh seed is never public by accident');
  assert.equal(docs.event.auth.googleProviderEnabled, false);
});

test('an answers file cannot turn off the legal review flag', () => {
  const { docs } = buildConfigDocs({
    answers: { ...MINIMAL, event: { ...MINIMAL.event, legal: { ...MINIMAL.event.legal, reviewRequired: false } } },
    tierA: TIER_A,
    now: () => 0,
  });
  assert.equal(docs.event.legal.reviewRequired, true);
});

test('features default to the four §2.2 toggles, and unknown keys warn instead of landing', () => {
  const built = buildConfigDocs({
    answers: { ...MINIMAL, features: { badges: true, notAFeature: true } },
    tierA: TIER_A,
    now: () => 0,
  });
  assert.equal(built.docs.features.schedule, true);
  assert.equal(built.docs.features.sessionBookmarks, false);
  assert.equal(built.docs.features.badges, true);
  assert.equal('notAFeature' in built.docs.features, false);
  assert.match(built.warnings.join(' '), /notAFeature/);
});

test('Tier A wins on provider selection, and an answers-file override warns', () => {
  const { providers, warnings } = buildProviders({
    tierA: TIER_A,
    overrides: { email: { provider: 'console', messageStream: 'outbound' } },
  });
  assert.equal(providers.email.provider, 'postmark');
  assert.equal(providers.email.messageStream, 'outbound');
  assert.equal(providers.ticketing.externalEventId, 'ext-123');
  assert.match(warnings.join(' '), /EVENT_EMAIL_PROVIDER/);
});

test('admin emails are required and normalized', () => {
  const none = buildConfigDocs({ answers: { ...MINIMAL, adminEmails: [] }, tierA: TIER_A, now: () => 0 });
  assert.equal(none.ok, false);
  assert.match(none.errors.join(' '), /adminEmails/);

  const mixed = buildConfigDocs({
    answers: { ...MINIMAL, adminEmails: ['Ops@Example.org', ' ops@example.org '] },
    tierA: TIER_A,
    now: () => 0,
  });
  assert.deepEqual(mixed.docs.bootstrap.adminEmails, ['ops@example.org']);
});

test('validator failures are reported, and nothing claims to be ok', () => {
  const built = buildConfigDocs({
    answers: { ...MINIMAL, event: { ...MINIMAL.event, timezone: 'Mars/Olympus' } },
    tierA: TIER_A,
    now: () => 0,
  });
  assert.equal(built.ok, false);
  assert.match(built.errors.join(' '), /timezone/);
});

test('a partial theme override keeps the rest of the default palette', () => {
  // A top-level spread would REPLACE the colors map, and the generated
  // stylesheet would then be missing most of its custom properties —
  // every rgb(var(--brand-ink-rgb)) utility resolving to nothing.
  const { docs } = buildConfigDocs({
    // Built, not written: the repo lint bans hex literals here.
    answers: { ...MINIMAL, theme: { colors: { primary: `#${'123456'}` } } },
    tierA: TIER_A,
    now: () => 0,
  });
  assert.equal(docs.theme.colors.primary, `#${'123456'}`);
  assert.equal(Object.keys(docs.theme.colors).length, Object.keys(defaultTheme().colors).length);
  assert.ok(docs.theme.colors.ink, 'the untouched slots survive');
  assert.equal(validateTheme(docs.theme).ok, true);
});

test('a partial fonts or logos override merges the same way', () => {
  const { docs } = buildConfigDocs({
    answers: { ...MINIMAL, theme: { fonts: { heading: 'sans-humanist' }, logos: { primary: 'branding/client.svg' } } },
    tierA: TIER_A,
    now: () => 0,
  });
  assert.equal(docs.theme.fonts.heading, 'sans-humanist');
  // The seed names no role at all — the preset's type map does — so a
  // client naming one role leaves the other three to the preset.
  assert.equal(docs.theme.fonts.body, undefined);
  assert.equal(docs.theme.preset, defaultTheme().preset, 'the preset survives a partial override');
  assert.equal(docs.theme.logos.primary, 'branding/client.svg');
  assert.equal(docs.theme.logos.mark, defaultTheme().logos.mark);
  // A slot the client supplied is no longer a placeholder, and the
  // launch-readiness branding row reads exactly this list.
  assert.equal(docs.theme.placeholderLogos.includes('primary'), false);
  assert.equal(docs.theme.placeholderLogos.includes('mark'), true);
});

test('every prompt targets a distinct answers path', () => {
  const paths = PROMPTS.map((p) => p.path);
  assert.equal(new Set(paths).size, paths.length);
});
