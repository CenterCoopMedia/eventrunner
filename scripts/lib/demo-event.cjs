'use strict';

/**
 * The synthetic demo event (spec §5.4, §8.6; milestone issue #35).
 *
 * One fixture, two consumers:
 *   - `scripts/seed-demo-event.cjs` writes it into a Firebase project — the
 *     public demo instance.
 *   - `scripts/generate-content.cjs --demo` renders it into
 *     `apps/web/src/generated/*`, the committed snapshot that keeps CI
 *     builds credential-free (§2.4) and that the §8.6 hygiene gate
 *     regenerates and diffs on every PR.
 *
 * Because both read this module, the demo instance and the committed
 * snapshot cannot drift apart, and "regenerate the snapshot" needs no
 * credentials, no emulator export, and no network.
 *
 * Everything here is fictional by construction: a three-day gathering for
 * a made-up cooperative in a made-up town, speakers named after
 * placeholders, sponsor logos pointing at the neutral branding assets. No
 * real event name, city, organization, or person appears — in seeds, in
 * fixtures, in tests, or on the demo instance (§5.4).
 *
 * The demo is deliberately built by running the REAL seed path
 * (`defaultPages()` + `buildSeedContent()`) and then overlaying demo copy,
 * so it exercises the same code an operator gets on a fresh deployment
 * rather than a parallel hand-written fixture that can quietly diverge.
 */

const { buildConfigDocs } = require('./answers.cjs');
const { defaultPages, buildSeedContent } = require('./seed.cjs');

/** Fixed instant for every demo `seededAt`, so regeneration is stable. */
const DEMO_SEEDED_AT = '2026-01-01T00:00:00.000Z';

/** Tier A the demo pretends to run under (no real project, ever). */
const DEMO_TIER_A = Object.freeze({
  slug: 'demo-event',
  projectId: 'demo-run-of-show',
  region: 'us-central1',
  publicUrl: 'https://example.org',
  storageBucket: null,
  allowedOrigins: [],
  emailProvider: 'console',
  ticketingProvider: 'none',
  ticketingEventId: null,
  operatorNotifier: 'none',
});

/** The answers an operator would have given for the demo deployment. */
const DEMO_ANSWERS = Object.freeze({
  adminEmails: ['demo-admin@example.org', 'demo-operator@example.org'],
  event: {
    name: '[Demo] Harborlight Media Summit',
    shortName: 'DEMO-SUMMIT',
    tagline: '[Replace] A three-day gathering for people who make community media work.',
    timezone: 'America/New_York',
    days: [
      { id: 'day-1', label: 'Day one', date: '2026-10-14', startTime: '09:00', endTime: '17:00' },
      { id: 'day-2', label: 'Day two', date: '2026-10-15', startTime: '09:00', endTime: '17:00' },
      { id: 'day-3', label: 'Day three', date: '2026-10-16', startTime: '09:00', endTime: '16:00' },
    ],
    registration: {
      opensAt: '2026-06-01T09:00:00',
      closesAt: '2026-10-09T23:59:00',
      externalUrl: 'https://example.org/register',
    },
    venue: {
      name: '[Demo] Harborlight Hall',
      addressLine1: '1 Placeholder Plaza',
      addressLine2: null,
      city: 'Demoville',
      region: 'ST',
      postalCode: '00000',
      country: 'US',
      mapUrl: null,
    },
    sender: { email: 'summit@example.org', name: '[Demo] Harborlight Media Summit', replyTo: null },
    legal: {
      operatorName: '[Demo] Harborlight Cooperative',
      postalAddressHtml: '[Replace] Operator postal address for the email footer.',
      supportEmail: 'support@example.org',
      conductEmail: 'conduct@example.org',
    },
    seo: {
      description: '[Replace] One-sentence description of the event for search and social cards.',
      organizerName: '[Demo] Harborlight Cooperative',
    },
  },
});

/**
 * Fields the demo sets AFTER the shared builders run. `announcedAt` is the
 * only interesting one: `buildEvent` pins it null so a fresh client seed is
 * never public by accident (§2.5), but the demo instance IS public, so the
 * fixture announces it explicitly rather than by weakening the default.
 */
const DEMO_EVENT_OVERRIDES = Object.freeze({ announcedAt: '2026-05-01T12:00:00' });

/**
 * Demo copy overlaid on the seeded blocks, keyed by content doc id. Only
 * fields listed here are replaced; everything else stays the placeholder an
 * operator would see, which is the honest thing for a demo of a CMS whose
 * point is that a client fills it in.
 */
const DEMO_CONTENT = Object.freeze({
  hero__subtitle: {
    value: '[Replace] One warm sentence about who this event is for and why it matters.',
  },
  hero__register_cta: { label: 'Register for the summit' },
  details__intro: {
    value:
      '<p>[Replace] A short paragraph describing what happens across the three days: sessions, ' +
      'workshops, and time to meet collaborators.</p>',
  },
  highlights__first: { text: '[Replace] One thing attendees can expect, in a short line.' },
  stats__attendees: { value: '0', label: 'Attendees expected' },
  stats__sessions: { value: '0', label: 'Sessions planned' },
  faq_items__what_is_this: {
    question: '[Replace] What is this event?',
    answer: '<p>[Replace] Answer describing the event in one or two sentences.</p>',
  },
  travel_header__page_title: { value: '[Replace] Getting to the venue' },
});

/** Fictional sessions across the three demo days. */
const DEMO_SESSIONS = Object.freeze([
  {
    id: 'session-welcome',
    dayId: 'day-1',
    startTime: '09:30',
    endTime: '10:00',
    title: '[Demo] Welcome and orientation',
    description: '[Replace] Short description of the opening session.',
    location: 'Main hall',
    type: 'keynote',
    speakerIds: ['speaker-placeholder-1'],
    visible: true,
    order: 0,
    seeded: true,
  },
  {
    id: 'session-workshop-a',
    dayId: 'day-1',
    startTime: '10:30',
    endTime: '12:00',
    title: '[Demo] Workshop: collaborative reporting basics',
    description: '[Replace] What attendees will practice in this workshop.',
    location: 'Room A',
    type: 'workshop',
    speakerIds: ['speaker-placeholder-2'],
    visible: true,
    order: 1,
    seeded: true,
  },
  {
    id: 'session-panel',
    dayId: 'day-2',
    startTime: '09:30',
    endTime: '10:45',
    title: '[Demo] Panel: sustaining local partnerships',
    description: '[Replace] The question this panel will dig into.',
    location: 'Main hall',
    type: 'panel',
    speakerIds: ['speaker-placeholder-1', 'speaker-placeholder-3'],
    visible: true,
    order: 0,
    seeded: true,
  },
  {
    id: 'session-workshop-b',
    dayId: 'day-2',
    startTime: '13:30',
    endTime: '15:00',
    title: '[Demo] Workshop: audience research on a small budget',
    description: '[Replace] What attendees will practice in this workshop.',
    location: 'Room B',
    type: 'workshop',
    speakerIds: ['speaker-placeholder-2'],
    visible: true,
    order: 1,
    seeded: true,
  },
  {
    id: 'session-unconference',
    dayId: 'day-3',
    startTime: '09:30',
    endTime: '11:30',
    title: '[Demo] Unconference blocks',
    description: '[Replace] How the participant-proposed sessions work.',
    location: 'Rooms A and B',
    type: 'workshop',
    speakerIds: [],
    visible: true,
    order: 0,
    seeded: true,
  },
  {
    id: 'session-closing',
    dayId: 'day-3',
    startTime: '15:00',
    endTime: '16:00',
    title: '[Demo] Closing conversation',
    description: '[Replace] How the event wraps up and what happens next.',
    location: 'Main hall',
    type: 'plenary',
    speakerIds: ['speaker-placeholder-3'],
    visible: true,
    order: 1,
    seeded: true,
  },
]);

/** Fictional speakers; headshots are the neutral branding mark (§5.4). */
const DEMO_SPEAKERS = Object.freeze([
  {
    id: 'speaker-placeholder-1',
    name: '[Demo] Alex Placeholder',
    title: '[Replace] Role, Organization',
    bio: '[Replace] Two-sentence speaker bio.',
    photoPath: 'branding/mark.svg',
    visible: true,
    seeded: true,
  },
  {
    id: 'speaker-placeholder-2',
    name: '[Demo] Sam Example',
    title: '[Replace] Role, Organization',
    bio: '[Replace] Two-sentence speaker bio.',
    photoPath: 'branding/mark.svg',
    visible: true,
    seeded: true,
  },
  {
    id: 'speaker-placeholder-3',
    name: '[Demo] Riley Specimen',
    title: '[Replace] Role, Organization',
    bio: '[Replace] Two-sentence speaker bio.',
    photoPath: 'branding/mark.svg',
    visible: true,
    seeded: true,
  },
]);

/** Fictional sponsors; logos are the neutral branding mark (§5.4). */
const DEMO_ORGANIZATIONS = Object.freeze([
  {
    id: 'org-placeholder-1',
    name: '[Demo] Beacon Placeholder Fund',
    tier: 'presenting',
    url: 'https://example.org',
    logoPath: 'branding/mark.svg',
    description: '[Replace] One sentence about this sponsor.',
    visible: true,
    order: 0,
    seeded: true,
  },
  {
    id: 'org-placeholder-2',
    name: '[Demo] Sample Community Trust',
    tier: 'supporting',
    url: 'https://example.org',
    logoPath: 'branding/mark.svg',
    description: '[Replace] One sentence about this sponsor.',
    visible: true,
    order: 1,
    seeded: true,
  },
  {
    id: 'org-placeholder-3',
    name: '[Demo] Fictional Media Collective',
    tier: 'partner',
    url: 'https://example.org',
    logoPath: 'branding/mark.svg',
    description: '[Replace] One sentence about this partner.',
    visible: true,
    order: 2,
    seeded: true,
  },
]);

/**
 * The whole demo deployment as data.
 *
 * @returns {{ config: object, pages: object[], content: object[],
 *             sessions: object[], speakers: object[], organizations: object[] }}
 * @throws when the demo answers no longer pass the real config validators —
 *   the fixture is the platform's own dogfood, so a schema change that
 *   breaks it must break here loudly, not on the demo instance.
 */
function demoEvent() {
  const built = buildConfigDocs({
    answers: DEMO_ANSWERS,
    tierA: DEMO_TIER_A,
    now: () => Date.parse(DEMO_SEEDED_AT),
  });
  if (!built.ok) {
    throw new Error(`demo fixture no longer validates: ${built.errors.join('; ')}`);
  }
  const config = built.docs;
  Object.assign(config.event, DEMO_EVENT_OVERRIDES);

  const pages = defaultPages().map((page) => ({ ...page, seeded: true }));
  const content = buildSeedContent({
    pages,
    docs: config,
    tierA: DEMO_TIER_A,
    seededAt: DEMO_SEEDED_AT,
  }).map((doc) => {
    const overlay = DEMO_CONTENT[doc.id];
    return overlay ? { ...doc, ...overlay } : doc;
  });

  return {
    config,
    pages,
    content,
    sessions: DEMO_SESSIONS.map((s) => ({ ...s })),
    speakers: DEMO_SPEAKERS.map((s) => ({ ...s })),
    organizations: DEMO_ORGANIZATIONS.map((o) => ({ ...o })),
  };
}

/**
 * The demo shaped for the generated-file emitters.
 *
 * @returns {object} snapshot accepted by emit.cjs `emitAll`
 */
function demoSnapshot() {
  const demo = demoEvent();
  return {
    event: demo.config.event,
    features: demo.config.features,
    theme: demo.config.theme,
    pages: demo.pages,
    content: demo.content,
    sessions: demo.sessions,
    speakers: demo.speakers,
    organizations: demo.organizations,
  };
}

module.exports = {
  demoEvent,
  demoSnapshot,
  DEMO_ANSWERS,
  DEMO_TIER_A,
  DEMO_SEEDED_AT,
  DEMO_SESSIONS,
  DEMO_SPEAKERS,
  DEMO_ORGANIZATIONS,
  DEMO_CONTENT,
};
