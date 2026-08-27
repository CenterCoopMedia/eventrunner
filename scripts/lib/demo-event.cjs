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
const { buildPublicSpeaker } = require('shared/speaker');
const { resolveLegacyColors } = require('shared/theme');

/**
 * The preset the demo event runs (design brief §4.2).
 *
 * The demo used to carry a hand-written blue-teal palette of its own. A
 * preset replaces it: the fixture is a media summit for cooperative
 * newsrooms, Newsroom is the story written for exactly that, and it brings
 * a designed dark palette the hand-written one never had.
 *
 * The demo does NOT follow `DEFAULT_PRESET_ID`. A fresh deployment starts on
 * Institutional (owner review, 2026-08-27); the demo stays on Newsroom
 * because the demo's job is to show a real event dressed in the style that
 * fits it, not to show the onboarding default twice.
 */
const DEMO_PRESET_ID = 'newsroom';

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
    tagline: 'A three-day gathering for the people who keep community media working.',
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
      addressLine1: '1 Harborlight Way',
      addressLine2: null,
      city: 'Millhaven',
      region: 'MH',
      postalCode: '58211',
      country: 'US',
      mapUrl: null,
    },
    sender: { email: 'summit@example.org', name: '[Demo] Harborlight Media Summit', replyTo: null },
    legal: {
      operatorName: '[Demo] Harborlight Cooperative',
      postalAddressHtml: '<p>[Demo] Harborlight Cooperative<br>1 Harborlight Way<br>Millhaven, MH 58211</p>',
      supportEmail: 'support@example.org',
      conductEmail: 'conduct@example.org',
    },
    seo: {
      description:
        'Three days of sessions, workshops, and hallway conversation for people who run local ' +
        'and cooperative newsrooms — schedule, speakers, and travel details for the [Demo] Harborlight Media Summit.',
      organizerName: '[Demo] Harborlight Cooperative',
    },
  },
  // Overlaid on `defaultTheme()` (spec §2.2, §7.2). The demo runs a named
  // preset rather than a bespoke palette: Newsroom is the story written for
  // a publication that publishes every day, which is what the fixture is.
  // Its cool newsprint ground is not the warm tan canvas the anti-pattern
  // checklist (#105) rejects.
  theme: {
    preset: DEMO_PRESET_ID,
    // `colors` is an OUTPUT for a preset document (design brief §5.2): the
    // one shared resolver materializes it, exactly as updateTheme does on
    // publish, so email and PDF have a palette to read. Writing a palette
    // here by hand would be ignored on the way in and would only drift.
    colors: resolveLegacyColors({ preset: DEMO_PRESET_ID }),
    // The preset names the type map, the shape, and the motif default, so
    // the fixture states none of them. `mode` is light, so the demo renders
    // the same way it always has; the dark palette is generated beside it.
    mode: 'light',
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
 * Demo copy overlaid on the seeded blocks, keyed by content doc id.
 *
 * Every field a visitor would actually see on the demo is listed here, with
 * specific, credible copy for the fictional event — not the `[Replace] …`
 * instruction an operator sees on a fresh deployment (issue #109: a demo
 * whose point is to look like a real, well-run event should not read like
 * an unfilled template). Fields with no visible placeholder text today
 * (config-derived values, or sections seeded with zero items) are left
 * alone; only the entries below are overlaid onto what `buildSeedContent`
 * produces from `DEMO_ANSWERS`.
 */
const DEMO_CONTENT = Object.freeze({
  hero__subtitle: {
    value:
      'Sessions, workshops, and time to compare notes with people running newsrooms and ' +
      'stations like yours.',
  },
  hero__register_cta: { label: 'Register for the summit' },
  details__intro: {
    value:
      '<p>Three days, one track of shared sessions and two of workshops. Day one is welcome and ' +
      'orientation. Day two is panels and small-group workshops. Day three is unconference ' +
      'blocks — participants propose the sessions — and a closing conversation about what to ' +
      'carry home.</p>',
  },
  highlights__first: {
    text: 'Small workshop rooms, capped at thirty seats, so there is time for real questions.',
  },
  stats__attendees: { value: '420', label: 'Attendees expected' },
  stats__sessions: { value: '38', label: 'Sessions planned' },
  faq_items__what_is_this: {
    question: 'What is the Harborlight Media Summit?',
    answer:
      '<p>A three-day gathering for people who report, edit, and run local and cooperative ' +
      'newsrooms. It mixes shared sessions with hands-on workshops, and leaves room for the ' +
      'hallway conversations that usually matter as much as the agenda.</p>',
  },
  travel_header__page_title: { value: 'Getting to Harborlight Hall' },
  travel_header__page_subtitle: {
    value: 'Directions, transit options, and what to expect when you arrive.',
  },
  travel_venue__venue_notes: {
    value:
      '<p>Doors open thirty minutes before the first session each day. The main entrance is ' +
      'step-free, and accessible parking is available in the north lot.</p>',
  },
  travel_help__help_title: { value: 'Travel questions' },
  travel_help__help_description: {
    value:
      '<p>Email <a href="mailto:support@example.org">support@example.org</a> and a member of ' +
      'the Harborlight team will get back to you within one business day.</p>',
  },
  faq_intro__summary: {
    value: '<p>Answers to the questions we hear most before the summit.</p>',
  },
  conduct_intro__summary: {
    value:
      '<p>This code of conduct applies to everyone at the Harborlight Media Summit — attendees, ' +
      'speakers, volunteers, and staff, in every session, workshop, and social space.</p>',
  },
  conduct_expectations__first: {
    text: 'Treat other attendees, speakers, and staff with respect, on the record and off it.',
  },
  conduct_reporting__how_to_report: {
    value:
      '<p>Report a concern to conduct@example.org or to any staff member wearing a Harborlight ' +
      'badge. Reports are reviewed by the organizing committee within one business day.</p>',
  },
  contact_intro__summary: {
    value: '<p>Questions before the summit? Here is how to reach the organizing team.</p>',
  },
});

/** Fictional sessions across the three demo days. */
const DEMO_SESSIONS = Object.freeze([
  {
    id: 'session-welcome',
    dayId: 'day-1',
    startTime: '09:30',
    endTime: '10:00',
    title: 'Welcome and orientation',
    description:
      'Coffee, badge pickup, and a short welcome from the organizing committee before the ' +
      'first sessions begin.',
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
    title: 'Workshop: collaborative reporting basics',
    description:
      'Setting up a cross-newsroom reporting partnership, from shared documents to shared ' +
      'bylines.',
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
    title: 'Panel: sustaining local partnerships',
    description:
      'Three newsroom leaders on what it actually takes to keep a shared-coverage partnership ' +
      'funded past year one.',
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
    title: 'Workshop: audience research on a small budget',
    description:
      'Simple survey and interview methods for newsrooms with no research budget and no ' +
      'research team.',
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
    title: 'Unconference blocks',
    description:
      'Participant-proposed sessions, posted on the board each morning — bring a topic or ' +
      'just show up.',
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
    title: 'Closing conversation',
    description:
      'A short conversation on what came out of the three days and where the network goes ' +
      'from here.',
    location: 'Main hall',
    type: 'plenary',
    speakerIds: ['speaker-placeholder-3'],
    visible: true,
    order: 1,
    seeded: true,
  },
]);

/**
 * Fictional speakers in the CANONICAL `speakers/{speakerId}` shape
 * (spec §4.3): identity, profile, pipeline state, and the `uid` link half.
 * Headshots are the neutral branding mark (§5.4).
 *
 * These are the documents seed-demo-event.cjs writes. What the public
 * bundle ships is the PROJECTION of them (demoSnapshot below runs the same
 * buildPublicSpeaker() the onSpeakerWritten trigger runs), so the demo
 * instance's `speakers_public` and the committed snapshot are the same
 * bytes by construction — including the fact that `email`, `uid`,
 * `inviteToken`, and `status` never appear in the bundle.
 *
 * Every one is `approved`: the demo exists to show a working directory,
 * and only `approved` projects.
 */
const DEMO_SPEAKERS = Object.freeze([
  {
    id: 'speaker-placeholder-1',
    firstName: '[Demo] Marisol',
    lastName: 'Reyes',
    slug: 'demo-marisol-reyes',
    email: null,
    bio:
      'Managing editor at a bilingual community newsroom, focused on collaborative ' +
      'investigations with rural partner outlets.',
    headshotPath: 'branding/mark.svg',
    organization: 'Coastal Public Media',
    jobTitle: 'Managing Editor',
    socialHandles: {},
    status: 'approved',
    uid: null,
    inviteToken: null,
    approvedAt: DEMO_SEEDED_AT,
    seeded: true,
  },
  {
    id: 'speaker-placeholder-2',
    firstName: '[Demo] Devon',
    lastName: 'Achebe',
    slug: 'demo-devon-achebe',
    email: null,
    bio:
      'Runs audience engagement for a three-station public radio network and teaches ' +
      'newsroom data-literacy workshops.',
    headshotPath: 'branding/mark.svg',
    organization: 'Three Rivers Public Radio',
    jobTitle: 'Audience Engagement Director',
    socialHandles: {},
    status: 'approved',
    uid: null,
    inviteToken: null,
    approvedAt: DEMO_SEEDED_AT,
    seeded: true,
  },
  {
    id: 'speaker-placeholder-3',
    firstName: '[Demo] Priya',
    lastName: 'Natarajan',
    slug: 'demo-priya-natarajan',
    email: null,
    bio:
      'Co-founded a reader-funded local news cooperative and advises other outlets on ' +
      'member-supported revenue models.',
    headshotPath: 'branding/mark.svg',
    organization: 'Harborlight Neighborhood News',
    jobTitle: 'Co-founder and Publisher',
    socialHandles: {},
    status: 'approved',
    uid: null,
    inviteToken: null,
    approvedAt: DEMO_SEEDED_AT,
    seeded: true,
  },
]);

/** Fictional sponsors; logos are the neutral branding mark (§5.4). */
const DEMO_ORGANIZATIONS = Object.freeze([
  {
    id: 'org-placeholder-1',
    name: '[Demo] Beacon Community Fund',
    tier: 'presenting',
    url: 'https://example.org',
    logoPath: 'branding/mark.svg',
    description: 'A regional foundation funding local news sustainability projects along the coast.',
    visible: true,
    order: 0,
    seeded: true,
  },
  {
    id: 'org-placeholder-2',
    name: '[Demo] Lighthouse Press Trust',
    tier: 'supporting',
    url: 'https://example.org',
    logoPath: 'branding/mark.svg',
    description: 'A nonprofit press trust supporting newsroom operations and staff training.',
    visible: true,
    order: 1,
    seeded: true,
  },
  {
    id: 'org-placeholder-3',
    name: '[Demo] Tidewater Media Collective',
    tier: 'partner',
    url: 'https://example.org',
    logoPath: 'branding/mark.svg',
    description: 'A cooperative of six independent local outlets sharing investigative resources.',
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
 * Speakers go through `buildPublicSpeaker` — the SAME projection the
 * onSpeakerWritten trigger applies (spec §4.3) — because the bundle ships
 * what `speakers_public` holds, never the canonical record. Reading the
 * canonical documents here would put `email` and `inviteToken` into a
 * committed, publicly served JavaScript file.
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
    speakers: demo.speakers.map((speaker) => ({ id: speaker.id, ...buildPublicSpeaker(speaker) })),
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
