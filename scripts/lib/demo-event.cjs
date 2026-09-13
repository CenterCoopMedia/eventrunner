'use strict';

/** One fictional event feeds both the demo seed and the generated snapshot.
 * People, organizations, and event arrangements are fictional. Newark and
 * the museum address are real map context selected for the demo. No booking
 * or affiliation is implied. Interior routes and rooms are illustrative.
 */

const { buildConfigDocs } = require('./answers.cjs');
const { defaultPages, buildSeedContent } = require('./seed.cjs');
const { buildPublicSpeaker } = require('shared/speaker');
const { resolveLegacyColors } = require('shared/theme');
const DEMO_UPDATES = require('./demo-updates.json');

/** Newsroom is the demo's media-summit preset. */
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
  adminEmails: [
    'demo-admin@example.org',
    'demo-operator@example.org'
  ],
  event: {
    name: 'Harborlight Media Summit',
    shortName: 'Harborlight',
    tagline: 'Stronger local news. Further together.',
    timezone: 'America/New_York',
    days: [
      {
        id: 'day-1',
        label: 'Day one',
        date: '2026-10-14',
        startTime: '09:00',
        endTime: '17:00'
      },
      {
        id: 'day-2',
        label: 'Day two',
        date: '2026-10-15',
        startTime: '09:00',
        endTime: '17:00'
      },
      {
        id: 'day-3',
        label: 'Day three',
        date: '2026-10-16',
        startTime: '09:00',
        endTime: '16:00'
      }
    ],
    tracks: [
      {
        letter: 'A',
        name: 'Practice'
      },
      {
        letter: 'B',
        name: 'Sustainability'
      }
    ],
    registration: {
      opensAt: '2026-06-01T09:00:00',
      closesAt: '2026-10-09T23:59:00',
      externalUrl: null,
      actionLabel: null
    },
    venue: {
      name: 'The Newark Museum of Art',
      addressLine1: '49 Washington Street',
      addressLine2: null,
      city: 'Newark',
      region: 'NJ',
      postalCode: '07102',
      country: 'US',
      mapUrl: 'https://www.openstreetmap.org/?mlat=40.7426&mlon=-74.1712#map=17/40.7426/-74.1712',
      places: [
        {
          id: 'main-hall',
          name: 'Main hall',
          floor: 'Ground floor'
        },
        {
          id: 'room-a',
          name: 'Room A',
          floor: 'First floor'
        },
        {
          id: 'room-b',
          name: 'Room B',
          floor: 'First floor'
        }
      ],
      movements: [
        {
          from: 'main-hall',
          to: 'room-a',
          walkingMinutes: 4,
          accessibleRoute: 'Illustrative route only. Follow the marked gallery and lift on the demo plan. This is not a surveyed museum route.'
        },
        {
          from: 'room-a',
          to: 'main-hall',
          walkingMinutes: 3,
          accessibleRoute: 'Illustrative route only. Follow the marked gallery and lift on the demo plan. This is not a surveyed museum route.'
        },
        {
          from: 'main-hall',
          to: 'room-b',
          walkingMinutes: 5,
          accessibleRoute: 'Illustrative route only. Follow the marked gallery and lift on the demo plan. This is not a surveyed museum route.'
        },
        {
          from: 'room-b',
          to: 'main-hall',
          walkingMinutes: 4
        },
        {
          from: 'room-a',
          to: 'room-b',
          walkingMinutes: 1,
          accessibleRoute: 'Illustrative route only. Follow the marked gallery and lift on the demo plan. This is not a surveyed museum route.'
        },
        {
          from: 'room-b',
          to: 'room-a',
          walkingMinutes: 1
        }
      ],
      map: {
        image: 'branding/demo-venue-plan.svg',
        alt: 'Illustrative summit floor plan with the main hall, rooms A and B, registration, and a quiet room. This is not the museum floor plan.',
        markers: [
          {
            placeId: 'main-hall',
            x: 52,
            y: 27
          },
          {
            placeId: 'room-a',
            x: 20,
            y: 79
          },
          {
            placeId: 'room-b',
            x: 65,
            y: 79
          }
        ]
      }
    },
    sender: {
      email: 'summit@example.org',
      name: 'Harborlight Media Summit',
      replyTo: null
    },
    legal: {
      operatorName: 'Harborlight Cooperative',
      postalAddressHtml: '<p>Harborlight Cooperative<br>Fictional demo organization<br>Contact: support@example.org</p>',
      supportEmail: 'support@example.org',
      conductEmail: 'conduct@example.org'
    },
    seo: {
      description: 'Schedule, speaker, workshop, and travel information for the fictional Harborlight Media Summit.',
      organizerName: 'Harborlight Cooperative'
    }
  },
  theme: {
    preset: DEMO_PRESET_ID,
    colors: resolveLegacyColors({ preset: DEMO_PRESET_ID }),
    mode: 'light',
    header: 'masthead'
  }
});

/**
 * Fields the demo sets AFTER the shared builders run. `announcedAt` is the
 * only interesting one: `buildEvent` pins it null so a fresh client seed is
 * never public by accident (§2.5), but the demo instance IS public, so the
 * fixture announces it explicitly rather than by weakening the default.
 */
const DEMO_EVENT_OVERRIDES = Object.freeze({ announcedAt: '2026-05-01T12:00:00' });

const DEMO_CONTENT = Object.freeze({
  privacy_intro__summary: { value: "<p>This fictional privacy page shows where an organizer explains data use. The static demo has no account registration. A real deployment needs its own reviewed policy.</p>" },
  privacy_data__account: { value: "<p>The attendee names, biographies, and portraits in this demo are fictional. No real attendee list is shown.</p>" },
  privacy_data__signin: { value: "<p>Sign-in and account changes are disabled in the static demo. Do not enter personal or confidential information into demonstration fields.</p>" },
  privacy_sharing__processors: { value: "<p>External map and travel links open other websites with their own policies. The hosting service receives ordinary page requests when you browse this site.</p>" },
  privacy_retention__period: { value: "<p>This demo does not accept attendee registrations. Fictional profiles remain available as sample content. A real organizer must publish its retention period before collecting data.</p>" },
  privacy_rights__requests: { value: "<p>For a real event, use the organizer\u2019s published contact to request access, correction, or deletion of account data. The addresses shown here are reserved examples.</p>" },
  privacy_contact__address: { value: "<p>The example privacy contact is support@example.org. This address does not reach an event team.</p>" },
  terms_intro__summary: { value: "<p>Harborlight is a fictional event used to demonstrate Eventrunner. These sample terms describe the demo and are not a contract for event attendance.</p>" },
  terms_accounts__eligibility: { value: "<p>You can browse the program, fictional profiles, and event information without an account. The static demo does not issue tickets or create accounts.</p>" },
  terms_conduct__expectations: { value: "<p>The conduct page illustrates the expectations an organizer can publish for a real event. There is no staffed reporting service behind this demo.</p>" },
  terms_liability__disclaimer: { value: "<p>No event booking, sponsorship, travel reservation, or museum partnership is offered here. Confirm real travel arrangements with the relevant provider. A real organizer must obtain its own legal review.</p>" },
  terms_contact__address: { value: "<p>The example terms contact is support@example.org. This address does not reach an event team.</p>" },
  hero__subtitle: {
    value: 'Sessions and workshops for people who operate local and cooperative newsrooms.'
  },
  info__when: {
    value: '3 days',
    label: 'When',
    takeaway: 'The summit runs from Wednesday to Friday',
    description: '14 to 16 October 2026, in the Eastern timezone. Doors open at 09:00 each day.',
    source: 'Summit programme, read 1 September 2026.',
    alt: 'The summit runs for three days, 14 to 16 October 2026.'
  },
  info__where_venue: {
    text: 'Demo map anchor: The Newark Museum of Art'
  },
  info__where_address: {
    text: 'Address: 49 Washington Street, Newark, NJ 07102'
  },
  info__where_transit: {
    text: 'Transit: Plan your trip through Newark Penn Station or Newark Broad Street Station.'
  },
  details__intro: {
    value: '<p>Three days to make local news work better. Compare reporting methods, build a budget, and leave with a shared project plan. The Practice and Sustainability tracks run beside shared conversations, meals, and peer clinics.</p><p>This is a fictional event. All speakers and sponsors are fictional. Newark is the real geographic setting; no museum booking or partnership is implied. Room names, capacities, walking times, and the interior plan are illustrative.</p>'
  },
  highlights__first: {
    text: 'Choose from two workshop tracks, with small groups and a practical exercise in each workshop.'
  },
  stats__attendees: {
    value: '180',
    label: 'demo attendees',
    takeaway: 'A working gathering for local news teams',
    description: 'The fictional planning scenario includes 180 attendees. This is not a museum capacity or registration claim.',
    source: 'Harborlight demo planning scenario.',
    alt: 'The fictional summit plans for 180 attendees.'
  },
  stats__sessions: {
    value: '22',
    label: 'sessions on the program',
    takeaway: 'Two tracks, with time to work together',
    description: 'Top-level workshops, panels, keynotes, and plenaries across three days. Coffee, meals, breaks, and the nested survey clinic are excluded.',
    source: 'Published Harborlight demo schedule.',
    alt: '22 top-level program sessions across three days, plus meals, breaks, and a linked survey clinic.'
  },
  sponsors__lede: {
    value: 'These organizations pay for the rooms, the food, and the travel grants.'
  },
  faq_items__what_is_this: {
    question: 'What is the Harborlight Media Summit?',
    answer: '<p>A three-day event for people who report, edit, and operate local and cooperative newsrooms. The schedule includes shared sessions and practical workshops.</p>'
  },
  travel_header__page_title: {
    value: 'Getting to Newark'
  },
  travel_header__page_subtitle: {
    value: 'A real city setting for a fictional summit. Use the map to explore the area.'
  },
  travel_venue__venue_notes: {
    value: '<p>The Newark Museum of Art at 49 Washington Street anchors this demo map. The event has no real booking or museum affiliation. The interior plan, room names, walking times, and event services are illustrative.</p><p>For a real visit, check the museum website for current opening hours, entry arrangements, and accessibility information. The museum currently reports no on-site parking during construction. Check its travel guidance before driving.</p>'
  },
  travel_help__help_title: {
    value: 'Travel questions'
  },
  travel_help__help_description: {
    value: '<p>Use <a href="mailto:support@example.org">support@example.org</a> as the example travel contact. Demo addresses do not reach an event team.</p>'
  },
  faq_intro__summary: {
    value: '<p>Answers to common questions about the summit.</p>'
  },
  conduct_intro__summary: {
    value: '<p>This code of conduct applies to attendees, speakers, volunteers, and staff at the Harborlight Media Summit. It applies in every session, workshop, and social space.</p>'
  },
  conduct_expectations__first: {
    text: 'Treat other attendees, speakers, and staff with respect, on the record and off it.'
  },
  conduct_reporting__how_to_report: {
    value: '<p>In this event scenario, report concerns privately to the registration lead or email conduct@example.org. Staff listen, record only what they need, and agree on next steps with the person reporting. Immediate safety concerns take priority.</p><p>This is a fictional reporting process. The demo address is not monitored.</p>'
  },
  contact_intro__summary: {
    value: '<p>Choose the right example contact below. These reserved addresses demonstrate the contact page; they do not reach an event team.</p>'
  }
});

const DEMO_PAGE_EXTRA_CONTENT = Object.freeze([
  {
    id: 'travel_local__map', section: 'travel_local', field: 'map',
    blockType: 'link_group', group: 'Around the venue', label: 'Open the Newark map',
    url: DEMO_ANSWERS.event.venue.mapUrl, visible: true, order: 0,
    seeded: true, seededAt: DEMO_SEEDED_AT,
  },
  {
    id: 'recap_media__workshop',
    section: 'recap_media',
    field: 'workshop',
    blockType: 'image',
    url: 'demo/workshop-recap.webp',
    alt: 'Fictional workshop participants reviewing a reporting map together.',
    caption: 'An illustrative workshop scene from the fictional previous edition.',
    visible: true,
    order: 0,
    seeded: true,
    seededAt: DEMO_SEEDED_AT,
  },
  {
    id: 'recap_summary__body',
    section: 'recap_summary',
    field: 'body',
    blockType: 'richtext',
    value: '<p>A look back at the previous edition of the Harborlight Media Summit, held over three days in October 2025. Turnout was the highest yet, and the workshop tracks filled within a day of registration opening.</p>',
    visible: true,
    order: 0,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'recap_stats__attendees',
    section: 'recap_stats',
    field: 'attendees',
    blockType: 'stat',
    value: '438',
    label: 'people attended the previous edition',
    takeaway: 'Attendance topped four hundred for the first time',
    description: 'Checked-in badges across all three days of the previous edition.',
    source: 'Summit registration desk count, read 20 October 2025.',
    alt: 'Attendance reached 438 people across the three-day summit.',
    visible: true,
    order: 0,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'recap_stats__sessions',
    section: 'recap_stats',
    field: 'sessions',
    blockType: 'stat',
    value: '36',
    label: 'sessions held',
    takeaway: 'Nearly every planned session ran on schedule',
    description: 'Sessions that ran on the published programme, counting workshops, panels, and plenaries.',
    source: 'Summit programme, read 20 October 2025.',
    alt: '36 of the 38 planned sessions ran as scheduled.',
    visible: true,
    order: 1,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'recap_highlights__first',
    section: 'recap_highlights',
    field: 'first',
    blockType: 'list_item',
    text: 'The workshop on audience research on a small budget filled within a day of opening.',
    visible: true,
    order: 0,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'recap_highlights__second',
    section: 'recap_highlights',
    field: 'second',
    blockType: 'list_item',
    text: 'Attendees asked for more peer-led time. The current program includes a two-hour unconference block.',
    visible: true,
    order: 1,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'recap_highlights__third',
    section: 'recap_highlights',
    field: 'third',
    blockType: 'list_item',
    text: 'Two newsroom partnerships announced a shared beat during the closing plenary.',
    visible: true,
    order: 2,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'recap_next__schedule',
    section: 'recap_next',
    field: 'schedule',
    blockType: 'link_group',
    group: 'Continue exploring',
    label: 'Browse the current schedule',
    url: '/schedule',
    visible: true,
    order: 0,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'recap_next__speakers',
    section: 'recap_next',
    field: 'speakers',
    blockType: 'link_group',
    group: 'Continue exploring',
    label: 'See who is speaking next',
    url: '/speakers',
    visible: true,
    order: 1,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'guidelines_intro__welcome',
    section: 'guidelines_intro',
    field: 'welcome',
    blockType: 'richtext',
    value: '<p>Everything a Harborlight Media Summit speaker needs to know before session day, from format to on-site setup.</p>',
    visible: true,
    order: 0,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'guidelines_formats__keynote',
    section: 'guidelines_formats',
    field: 'keynote',
    blockType: 'list_item',
    text: 'Keynote: 20 to 30 minutes. Follow the time on your session page.',
    visible: true,
    order: 0,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'guidelines_formats__panel',
    section: 'guidelines_formats',
    field: 'panel',
    blockType: 'list_item',
    text: 'Panel: 75 minutes, including audience questions. Agree on roles with the moderator before the session.',
    visible: true,
    order: 1,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'guidelines_formats__workshop',
    section: 'guidelines_formats',
    field: 'workshop',
    blockType: 'list_item',
    text: 'Workshop: 60 to 90 minutes. Include a practical exercise and leave time for questions.',
    visible: true,
    order: 2,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'guidelines_deadlines__slides',
    section: 'guidelines_deadlines',
    field: 'slides',
    blockType: 'list_item',
    text: 'Slides are due one week before the summit begins.',
    visible: true,
    order: 0,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'guidelines_deadlines__bio',
    section: 'guidelines_deadlines',
    field: 'bio',
    blockType: 'list_item',
    text: 'Speaker bios and headshots are due two weeks before the summit begins.',
    visible: true,
    order: 1,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'guidelines_av__setup',
    section: 'guidelines_av',
    field: 'setup',
    blockType: 'richtext',
    value: '<p>The demo event plan includes a projector, microphone, and laptop connection in each room. Speakers bring any required adapter and check their setup 20 minutes before the session. These are fictional event arrangements, not museum equipment claims.</p>',
    visible: true,
    order: 0,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'guidelines_sharing__policy',
    section: 'guidelines_sharing',
    field: 'policy',
    blockType: 'richtext',
    value: '<p>Slides are posted to the session page after the summit unless a speaker asks otherwise. Sessions are not recorded this year.</p>',
    visible: true,
    order: 0,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'guidelines_help__contact',
    section: 'guidelines_help',
    field: 'contact',
    blockType: 'richtext',
    value: '<p>Email speakers@example.org with questions before the summit.</p>',
    visible: true,
    order: 0,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'history__story',
    section: 'history',
    field: 'story',
    blockType: 'richtext',
    value: '<p>Harborlight began as a fictional meeting of local news teams that wanted to share work. The 2025 edition tested two workshop tracks. This year adds longer peer clinics and a practical planning session before the closing conversation.</p>',
    visible: true,
    order: 0,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'details__gathering',
    section: 'details',
    field: 'gathering',
    blockType: 'image',
    url: 'demo/summit-gathering.webp',
    alt: 'Illustrative local news gathering with attendees sharing notes around tables.',
    caption: 'The fictional Harborlight summit brings reporting, audience, and operations teams together.',
    visible: true,
    order: 0,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'highlights__clinic',
    section: 'highlights',
    field: 'clinic',
    blockType: 'list_item',
    text: 'Bring a draft budget, survey, or reporting idea to a peer clinic.',
    visible: true,
    order: 0,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'highlights__access',
    section: 'highlights',
    field: 'access',
    blockType: 'list_item',
    text: 'The demo event plan includes a quiet room, clear wayfinding, and a staffed welcome desk.',
    visible: true,
    order: 1,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'highlights__followup',
    section: 'highlights',
    field: 'followup',
    blockType: 'list_item',
    text: 'Leave with one action, one owner, and a date to check progress.',
    visible: true,
    order: 2,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'faq_items__registration',
    section: 'faq_items',
    field: 'registration',
    blockType: 'faq_item',
    question: 'Can I register for this event?',
    answer: '<p>No. Harborlight is a furnished demo of an event site. There are no tickets, charges, bookings, or real attendee registrations.</p>',
    visible: true,
    order: 0,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'faq_items__included',
    section: 'faq_items',
    field: 'included',
    blockType: 'faq_item',
    question: 'What does the sample ticket include?',
    answer: '<p>The fictional event plan includes all three days, workshop materials, coffee, and lunch. Travel and lodging are separate.</p>',
    visible: true,
    order: 1,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'faq_items__workshops',
    section: 'faq_items',
    field: 'workshops',
    blockType: 'faq_item',
    question: 'Do I need to reserve a workshop seat?',
    answer: '<p>In this scenario, attendees choose a track at the morning desk. Arrive before the workshop starts and bring a notebook or laptop.</p>',
    visible: true,
    order: 2,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'faq_items__access',
    section: 'faq_items',
    field: 'access',
    blockType: 'faq_item',
    question: 'How are access needs handled?',
    answer: '<p>The demo plan includes a quiet room and a contact for advance requests. Actual museum access arrangements must be checked with the venue. The illustrated plan is not a surveyed access map.</p>',
    visible: true,
    order: 3,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'faq_items__food',
    section: 'faq_items',
    field: 'food',
    blockType: 'faq_item',
    question: 'What about dietary needs?',
    answer: '<p>The fictional meal plan offers vegetarian and vegan choices. A real event should collect dietary needs before ordering and confirm allergen information with its caterer.</p>',
    visible: true,
    order: 4,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'faq_items__recording',
    section: 'faq_items',
    field: 'recording',
    blockType: 'faq_item',
    question: 'Will sessions be recorded?',
    answer: '<p>The 2026 demo program does not include recordings. Speakers can share slides after their session. Ask before photographing another attendee.</p>',
    visible: true,
    order: 5,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'faq_items__newcomers',
    section: 'faq_items',
    field: 'newcomers',
    blockType: 'faq_item',
    question: 'Is this useful for a small newsroom?',
    answer: '<p>Yes. Exercises use sample files and small-team budgets. You can attend alone, with a colleague, or as part of a reporting partnership.</p>',
    visible: true,
    order: 6,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'faq_items__location',
    section: 'faq_items',
    field: 'location',
    blockType: 'faq_item',
    question: 'Is the museum hosting Harborlight?',
    answer: '<p>No. The Newark Museum of Art is a real geographic anchor for this fictional demo. No booking, endorsement, or partnership is implied.</p>',
    visible: true,
    order: 7,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'travel_lodging__planning',
    section: 'travel_lodging',
    field: 'planning',
    blockType: 'richtext',
    value: '<p>Choose lodging near the transit route that suits your arrival. This demo has no hotel block or negotiated rate. Check cancellation terms and your route before making a real booking.</p>',
    visible: true,
    order: 0,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'travel_lodging__city',
    section: 'travel_lodging',
    field: 'city',
    blockType: 'link_group',
    label: 'Explore Newark visitor information',
    url: 'https://www.newarkhappening.com/',
    group: 'Lodging research',
    visible: true,
    order: 1,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'travel_transit__rail',
    section: 'travel_transit',
    field: 'rail',
    blockType: 'richtext',
    value: '<p>Newark Penn Station and Newark Broad Street Station are useful starting points for a city trip. Check current routes, service notices, and the final walking route before departure.</p>',
    visible: true,
    order: 0,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'travel_transit__njtransit',
    section: 'travel_transit',
    field: 'njtransit',
    blockType: 'link_group',
    label: 'Plan a trip with NJ TRANSIT',
    url: 'https://www.njtransit.com/trip-planner-to',
    group: 'Transit',
    visible: true,
    order: 1,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'travel_transit__path',
    section: 'travel_transit',
    field: 'path',
    blockType: 'link_group',
    label: 'Check PATH service',
    url: 'https://www.panynj.gov/path/en/index.html',
    group: 'Transit',
    visible: true,
    order: 2,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'travel_shuttle__none',
    section: 'travel_shuttle',
    field: 'none',
    blockType: 'richtext',
    value: '<p>This demo does not run a shuttle. Use current public transit information or plan your own route to the map anchor.</p>',
    visible: true,
    order: 0,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'travel_local__museum',
    section: 'travel_local',
    field: 'museum',
    blockType: 'link_group',
    label: 'Check museum visit information',
    url: 'https://newarkmuseumart.org/visit/plan-your-visit/',
    group: 'Around the venue',
    visible: true,
    order: 0,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'travel_local__city-guide',
    section: 'travel_local',
    field: 'city-guide',
    blockType: 'link_group',
    label: 'Read the city guide',
    url: '/city-guide',
    group: 'Around the venue',
    visible: true,
    order: 1,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'city_guide_intro__welcome',
    section: 'city_guide_intro',
    field: 'welcome',
    blockType: 'richtext',
    value: '<p>Use Newark as the starting point for this fictional summit. The links below help you explore the real city. Check current hours, transport, and access details before a visit.</p>',
    visible: true,
    order: 0,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'city_guide_eat__downtown',
    section: 'city_guide_eat',
    field: 'downtown',
    blockType: 'list_item',
    text: 'Downtown Newark: Look for lunch near your arrival route. Leave time to return before afternoon workshops.',
    visible: true,
    order: 0,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'city_guide_eat__ironbound',
    section: 'city_guide_eat',
    field: 'ironbound',
    blockType: 'list_item',
    text: 'The Ironbound: Explore dining options east of Newark Penn Station. Check current menus and opening hours before choosing a place.',
    visible: true,
    order: 1,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'city_guide_eat__diet',
    section: 'city_guide_eat',
    field: 'diet',
    blockType: 'list_item',
    text: 'Dietary needs: Confirm ingredients and allergen handling directly with the restaurant.',
    visible: true,
    order: 2,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'city_guide_see__museum',
    section: 'city_guide_see',
    field: 'museum',
    blockType: 'list_item',
    text: 'The Newark Museum of Art: The real geographic anchor for this demo. Check the museum website for current exhibitions and visiting arrangements.',
    visible: true,
    order: 0,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'city_guide_see__park',
    section: 'city_guide_see',
    field: 'park',
    blockType: 'list_item',
    text: 'Military Park: A downtown landmark to include when planning a walk. Use a current map to choose your route.',
    visible: true,
    order: 1,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'city_guide_see__arts',
    section: 'city_guide_see',
    field: 'arts',
    blockType: 'list_item',
    text: 'New Jersey Performing Arts Center: Check its current calendar if you want an evening performance.',
    visible: true,
    order: 2,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'city_guide_around__rail',
    section: 'city_guide_around',
    field: 'rail',
    blockType: 'list_item',
    text: 'Compare arrival routes through Newark Penn Station and Newark Broad Street Station.',
    visible: true,
    order: 0,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'city_guide_around__map',
    section: 'city_guide_around',
    field: 'map',
    blockType: 'list_item',
    text: 'Use the travel page map for the geographic anchor. The interior summit plan is illustrative and does not show museum rooms.',
    visible: true,
    order: 1,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'city_guide_around__check',
    section: 'city_guide_around',
    field: 'check',
    blockType: 'list_item',
    text: 'Check transit service notices and the weather before leaving. Allow time for the final walk from your stop.',
    visible: true,
    order: 2,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'conduct_expectations__consent',
    section: 'conduct_expectations',
    field: 'consent',
    blockType: 'list_item',
    text: 'Ask before taking a photo, recording a conversation, or sharing another person’s contact details.',
    visible: true,
    order: 0,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'conduct_expectations__space',
    section: 'conduct_expectations',
    field: 'space',
    blockType: 'list_item',
    text: 'Make space for others to speak. Challenge ideas without personal attacks.',
    visible: true,
    order: 1,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'conduct_expectations__privacy',
    section: 'conduct_expectations',
    field: 'privacy',
    blockType: 'list_item',
    text: 'Keep private reports and sensitive source information out of shared notes.',
    visible: true,
    order: 2,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'conduct_expectations__harassment',
    section: 'conduct_expectations',
    field: 'harassment',
    blockType: 'list_item',
    text: 'Harassment, discrimination, threats, and unwanted contact are not acceptable.',
    visible: true,
    order: 3,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'conduct_expectations__response',
    section: 'conduct_expectations',
    field: 'response',
    blockType: 'list_item',
    text: 'The fictional organizer may pause a session or remove an attendee to protect others.',
    visible: true,
    order: 4,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'contact_channels__speakers',
    section: 'contact_channels',
    field: 'speakers',
    blockType: 'link_group',
    label: 'Speaker preparation',
    url: 'mailto:speakers@example.org',
    group: 'Example contacts',
    visible: true,
    order: 0,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'contact_channels__access',
    section: 'contact_channels',
    field: 'access',
    blockType: 'link_group',
    label: 'Access and dietary requests',
    url: 'mailto:access@example.org',
    group: 'Example contacts',
    visible: true,
    order: 1,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'contact_channels__conduct',
    section: 'contact_channels',
    field: 'conduct',
    blockType: 'link_group',
    label: 'Private conduct concerns',
    url: 'mailto:conduct@example.org',
    group: 'Example contacts',
    visible: true,
    order: 2,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'contact_channels__partners',
    section: 'contact_channels',
    field: 'partners',
    blockType: 'link_group',
    label: 'Sponsor and partnership questions',
    url: 'mailto:partners@example.org',
    group: 'Example contacts',
    visible: true,
    order: 3,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'recap_media__gallery',
    section: 'recap_media',
    field: 'gallery',
    blockType: 'link_group',
    label: 'Explore the current event story',
    url: '/',
    group: 'From the summit',
    visible: true,
    order: 0,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'recap_media__program',
    section: 'recap_media',
    field: 'program',
    blockType: 'link_group',
    label: 'Explore the current program',
    url: '/schedule',
    group: 'From the summit',
    visible: true,
    order: 1,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'recap_survey__contact',
    section: 'recap_survey',
    field: 'contact',
    blockType: 'link_group',
    label: 'See the example feedback contact',
    url: '/contact',
    group: 'Feedback',
    visible: true,
    order: 0,
    seeded: true,
    seededAt: '2026-01-01T00:00:00.000Z'
  }
]);

/** Fictional sessions across the three demo days. */
const DEMO_SESSIONS = Object.freeze([
  {
    id: 'session-arrival-1',
    dayId: 'day-1',
    startTime: '09:00',
    endTime: '09:30',
    title: 'Registration and morning coffee',
    description: 'Collect a badge, review the day with the host team, and meet other attendees. Coffee and tea are included in the fictional event plan.',
    location: 'Main hall',
    type: 'break',
    speakerIds: [],
    visible: true,
    order: 0,
    seeded: true,
    placeId: 'main-hall'
  },
  {
    id: 'session-welcome',
    dayId: 'day-1',
    startTime: '09:30',
    endTime: '10:00',
    title: 'Welcome and orientation',
    description: 'Start here if this is your first Harborlight summit or your first event with a partner newsroom. Marisol Reyes introduces the hosts and explains how the two workshop tracks fit together. Review the room plan, shared notes, conduct process, and quiet-space arrangements for this fictional event.\n\nChoose one question you want to answer during the three days. Share it with a neighbor and identify a session that can help. Bring your schedule and a notebook. You will leave with a first-day plan, a clear way to ask for help, and someone to compare notes with at the afternoon exchange.',
    location: 'Main hall',
    type: 'keynote',
    speakerIds: [
      'speaker-placeholder-1'
    ],
    visible: true,
    order: 1,
    seeded: true,
    placeId: 'main-hall'
  },
  {
    id: 'session-opening',
    dayId: 'day-1',
    startTime: '10:00',
    endTime: '10:20',
    title: 'Local news as shared work',
    description: 'What makes a partnership useful after the announcement? Marisol Reyes follows a fictional local investigation from its first tip to publication. She shows where reporting teams share work, where they need separate decisions, and how a small promise becomes a practical agreement.\n\nThis opening talk is for reporters, editors, and publishers who want to work across newsroom boundaries. Listen for one task your team could share and one responsibility it must keep. No preparation is needed. The takeaway is a short set of questions about ownership, editing, credit, and deadlines that you can use before agreeing to a joint story.',
    location: 'Main hall',
    type: 'keynote',
    speakerIds: [
      'speaker-placeholder-1'
    ],
    visible: true,
    order: 2,
    seeded: true,
    placeId: 'main-hall'
  },
  {
    id: 'session-workshop-a',
    dayId: 'day-1',
    startTime: '10:30',
    endTime: '12:00',
    title: 'Collaborative reporting basics',
    description: 'This workshop is for reporters and editors starting a joint project, especially teams without a dedicated partnerships manager. Lucia Bennett and Amara Okafor introduce a fictional investigation and ask each group to divide the reporting work. Decide who checks sources, who edits each version, and who makes the final publication call.\n\nWork through a missed deadline and a disputed byline before they happen on a real assignment. Bring a project idea and a notebook or laptop; a sample brief is available if you need one. You will leave with a reporting plan, a short partner agreement, and a checklist for resolving questions before they delay the story.',
    location: 'Room A',
    type: 'workshop',
    speakerIds: [
      'speaker-lucia-bennett',
      'speaker-amara-okafor'
    ],
    visible: true,
    order: 3,
    seeded: true,
    placeId: 'room-a',
    track: 'A'
  },
  {
    id: 'session-membership',
    dayId: 'day-1',
    startTime: '10:30',
    endTime: '12:00',
    title: 'A membership offer readers understand',
    description: 'For publishers, membership staff, and anyone writing a reader appeal, this workshop starts with the reader\'s reason to support your work. Priya Natarajan and Omar Farouk compare three fictional membership offers. Identify the promise, the price, and the work needed to deliver each one.\n\nDraft a short invitation, then exchange it with a partner who has not seen your newsroom\'s pitch. Check whether the benefit is clear without insider language. Bring an existing appeal or use the sample copy. You will leave with a revised message, a simple cost check, and a plan to test one change before sending it to a larger audience.',
    location: 'Room B',
    type: 'workshop',
    speakerIds: [
      'speaker-placeholder-3',
      'speaker-omar-farouk'
    ],
    visible: true,
    order: 4,
    seeded: true,
    placeId: 'room-b',
    track: 'B'
  },
  {
    id: 'session-lunch-1',
    dayId: 'day-1',
    startTime: '12:00',
    endTime: '13:00',
    title: 'Lunch and open tables',
    description: 'Join a table by topic or take a quiet break. The fictional meal plan includes vegetarian and vegan choices; attendees can flag dietary needs in advance.',
    location: 'Main hall',
    type: 'break',
    speakerIds: [],
    visible: true,
    order: 5,
    seeded: true,
    placeId: 'main-hall'
  },
  {
    id: 'session-verification',
    dayId: 'day-1',
    startTime: '13:00',
    endTime: '14:30',
    title: 'Verify a local data story',
    description: 'A spreadsheet can be tidy and still tell the wrong story. This lab is for reporters who can open a table but want a more reliable checking process. Samir Das provides a fictional public-spending file with duplicate rows, missing values, and inconsistent dates.\n\nWork in pairs to preserve the original, document each change, and compare your totals with the source notes. Then write a finding that states what the data can and cannot show. Bring a laptop with a spreadsheet tool; printed examples support the discussion. You will leave with a cleaning log, a verification checklist, and a source note another editor can follow without repeating every step.',
    location: 'Room A',
    type: 'workshop',
    speakerIds: [
      'speaker-samir-das'
    ],
    visible: true,
    order: 6,
    seeded: true,
    placeId: 'room-a',
    track: 'A'
  },
  {
    id: 'session-newsletter',
    dayId: 'day-1',
    startTime: '13:00',
    endTime: '14:30',
    title: 'Make your newsletter useful every week',
    description: 'For editors and audience staff responsible for a regular newsletter, this workshop focuses on a job the reader needs done. June Park asks each group to choose between three fictional audiences with different information needs. Edit a sample issue so the opening, links, and call to action serve that choice.\n\nTest the draft with a partner reading on a small screen. Check what they notice, what they skip, and whether the next step is clear. Bring a recent issue or use the sample. You will leave with a revised outline, an editing checklist, and a small test with a review date and a useful measure beyond opens.',
    location: 'Room B',
    type: 'workshop',
    speakerIds: [
      'speaker-june-park'
    ],
    visible: true,
    order: 7,
    seeded: true,
    placeId: 'room-b',
    track: 'B'
  },
  {
    id: 'session-break-1',
    dayId: 'day-1',
    startTime: '14:30',
    endTime: '14:45',
    title: 'Afternoon break',
    description: 'Refill water, check your notes, and move to the next session.',
    location: 'Main hall',
    type: 'break',
    speakerIds: [],
    visible: true,
    order: 8,
    seeded: true,
    placeId: 'main-hall'
  },
  {
    id: 'session-listening',
    dayId: 'day-1',
    startTime: '14:45',
    endTime: '16:15',
    title: 'Listening before the first interview',
    description: 'This workshop is for reporters and community editors planning interviews, listening sessions, or reader callouts. Elena Santos and Devon Achebe start with a fictional neighborhood question. Practice an invitation that explains why you are asking, how notes will be used, and what participation does not promise.\n\nTake turns as interviewer, participant, and observer. Revise questions that assume an answer or ask someone to speak for a whole community. Bring a reporting question; no private source details are needed. You will leave with an interview guide, plain-language consent notes, and a plan to return findings to participants. The final discussion covers language support, payment, and how to report disagreement fairly.',
    location: 'Room A',
    type: 'workshop',
    speakerIds: [
      'speaker-elena-santos',
      'speaker-placeholder-2'
    ],
    visible: true,
    order: 9,
    seeded: true,
    placeId: 'room-a',
    track: 'A'
  },
  {
    id: 'session-staffing',
    dayId: 'day-1',
    startTime: '14:45',
    endTime: '16:15',
    title: 'Plan coverage without burning out',
    description: 'For editors and operations staff in small newsrooms, this workshop makes the hidden work visible. Nora Chen provides a fictional coverage week with reporting, editing, travel, reader replies, and an unexpected absence. Map who does each task and where the plan depends on unpaid extra time.\n\nReduce the assignment list, define a handoff, and decide what can wait when news breaks. Bring a typical weekly schedule without personnel details, or use the sample. You will leave with a workload map, a handoff note, and a rule for deciding when to stop adding work. Discuss how to review the plan with staff without treating a capacity problem as an individual failure.',
    location: 'Room B',
    type: 'workshop',
    speakerIds: [
      'speaker-nora-chen'
    ],
    visible: true,
    order: 10,
    seeded: true,
    placeId: 'room-b',
    track: 'B'
  },
  {
    id: 'session-day-one-exchange',
    dayId: 'day-1',
    startTime: '16:30',
    endTime: '17:00',
    title: 'What we will try next',
    description: 'Turn the first day\'s notes into one change you can explain. Amara Okafor invites short reports from both tracks, then asks participants to compare a draft, a decision, or a question with someone from another newsroom. The aim is useful feedback before the idea loses its context.\n\nBring the worksheet or notes from your last session. Name the person who would use your proposed change and the first step needed to try it. You will leave with one revised action and a peer who can challenge your assumptions. Hosts collect shared questions for the next morning\'s partnership panel without including private project details.',
    location: 'Main hall',
    type: 'plenary',
    speakerIds: [
      'speaker-amara-okafor'
    ],
    visible: true,
    order: 11,
    seeded: true,
    placeId: 'main-hall'
  },
  {
    id: 'session-arrival-2',
    dayId: 'day-2',
    startTime: '09:00',
    endTime: '09:30',
    title: 'Morning coffee and peer check-in',
    description: 'Collect a badge, review the day with the host team, and meet other attendees. Coffee and tea are included in the fictional event plan.',
    location: 'Main hall',
    type: 'break',
    speakerIds: [],
    visible: true,
    order: 12,
    seeded: true,
    placeId: 'main-hall'
  },
  {
    id: 'session-panel',
    dayId: 'day-2',
    startTime: '09:30',
    endTime: '10:45',
    title: 'Sustaining local partnerships',
    description: 'For newsroom leaders and staff doing the day-to-day work of a partnership, this conversation looks beyond the first grant. Marisol Reyes, Priya Natarajan, and Amara Okafor discuss fictional examples of shared reporting, membership support, and cross-newsroom coordination. Each example names the costs, responsibilities, and decisions that became difficult after launch.\n\nCompare how the teams handle uneven workloads, a departing partner, and competing publication needs. Bring one practical question about a collaboration you manage or hope to start. Audience questions are part of the session. You will leave with a partnership health checklist and clearer questions to ask before renewing an agreement or adding another member.',
    location: 'Main hall',
    type: 'panel',
    speakerIds: [
      'speaker-placeholder-1',
      'speaker-placeholder-3',
      'speaker-amara-okafor'
    ],
    visible: true,
    order: 13,
    seeded: true,
    placeId: 'main-hall'
  },
  {
    id: 'session-audio',
    dayId: 'day-2',
    startTime: '11:00',
    endTime: '12:00',
    title: 'A short audio scene with a clear purpose',
    description: 'This practical session is for reporters who want to add a short audio scene to their work without building a new production team. Theo Brooks demonstrates how a location, a voice, and a clear question can carry a small story. Listen to two sample clips and identify what the listener still needs to know.\n\nRecord a brief interview in pairs, check permission, and make a simple edit plan from a transcript. Bring a phone with a recording app and headphones if available; paired work does not require your own equipment. You will leave with a short practice recording, a consent checklist, and a sequence for checking names, context, and sound before publication.',
    location: 'Room A',
    type: 'workshop',
    speakerIds: [
      'speaker-theo-brooks'
    ],
    visible: true,
    order: 14,
    seeded: true,
    placeId: 'room-a',
    track: 'A'
  },
  {
    id: 'session-sponsor-policy',
    dayId: 'day-2',
    startTime: '11:00',
    endTime: '12:00',
    title: 'Sponsorship rules your team can use',
    description: 'For publishers, sales staff, and editors who review commercial requests, this workshop turns broad principles into decisions a team can make. Omar Farouk and Nora Chen present a fictional sponsor offer with a useful payment and several unclear conditions. Separate the financial terms from requests that affect editorial judgment.\n\nDraft a response, identify who approves it, and write the disclosure a reader would see. Bring an existing policy with confidential terms removed, or use the sample. You will leave with a short decision guide, a disclosure example, and an escalation path for disputed requests. The discussion also covers renewal pressure and how to record an exception without making it the new default.',
    location: 'Room B',
    type: 'workshop',
    speakerIds: [
      'speaker-omar-farouk',
      'speaker-nora-chen'
    ],
    visible: true,
    order: 15,
    seeded: true,
    placeId: 'room-b',
    track: 'B'
  },
  {
    id: 'session-lunch-2',
    dayId: 'day-2',
    startTime: '12:00',
    endTime: '13:30',
    title: 'Lunch and open tables',
    description: 'Join a table by topic or take a quiet break. The fictional meal plan includes vegetarian and vegan choices; attendees can flag dietary needs in advance.',
    location: 'Main hall',
    type: 'break',
    speakerIds: [],
    visible: true,
    order: 16,
    seeded: true,
    placeId: 'main-hall'
  },
  {
    id: 'session-workshop-b',
    dayId: 'day-2',
    startTime: '13:30',
    endTime: '15:00',
    title: 'Audience research on a small budget',
    description: 'This workshop is for audience staff and editors who need a specific reader decision, not a large research report. Devon Achebe starts by asking what you would change if the answers surprised you. Choose a fictional newsroom problem or bring a question from your own work.\n\nThe first half-hour in Room B covers a small sample, a clear invitation, and questions readers can answer. At 2 p.m., the group moves to the main hall for the linked survey clinic and peer review. Bring up to three draft questions and a notebook or laptop. You will leave with a short survey, a sampling note, and a plan for using and sharing the results.',
    location: 'Room B',
    type: 'workshop',
    speakerIds: [
      'speaker-placeholder-2'
    ],
    visible: true,
    order: 17,
    seeded: true,
    placeId: 'room-b',
    track: 'B'
  },
  {
    id: 'session-workshop-money',
    dayId: 'day-2',
    startTime: '13:30',
    endTime: '15:00',
    title: 'Budgets that survive a thin year',
    description: 'For publishers and operations staff responsible for a small newsroom budget, this workshop tests the plan before cash runs short. Priya Natarajan and Omar Farouk provide a fictional budget with one major grant ending. Separate committed costs from choices the team can still change.\n\nBuild a monthly cash view, compare two responses, and discuss what each means for staff and coverage. Bring a budget with private amounts removed, or use the sample workbook. No finance software is needed. You will leave with a scenario sheet, a list of decisions tied to dates, and a short explanation you can take to a board or team meeting without hiding the tradeoffs.',
    location: 'Room A',
    type: 'workshop',
    speakerIds: [
      'speaker-placeholder-3',
      'speaker-omar-farouk'
    ],
    visible: true,
    order: 18,
    seeded: true,
    placeId: 'room-a',
    track: 'A'
  },
  {
    id: 'session-workshop-b-clinic',
    dayId: 'day-2',
    startTime: '14:00',
    endTime: '15:00',
    title: 'Bring your survey questions',
    description: 'This clinic is the second part of the audience research workshop. Participants move from Room B to the main hall at 2 p.m. Devon Achebe pairs groups to review the questions drafted during the opening exercise. Read each question aloud and explain what decision its answer would support.\n\nRemove leading language, split questions that ask two things, and add an answer choice for people whose experience does not fit your assumptions. Bring your draft and the intended audience description. You will leave with a revised question set, notes on who may be missing from the sample, and a small pilot plan. Attending the first part is useful; a sample draft is available for this exercise.',
    location: 'Main hall',
    type: 'workshop',
    speakerIds: [
      'speaker-placeholder-2'
    ],
    visible: true,
    order: 19,
    seeded: true,
    placeId: 'main-hall',
    track: 'B',
    parentId: 'session-workshop-b'
  },
  {
    id: 'session-break-2',
    dayId: 'day-2',
    startTime: '15:00',
    endTime: '15:15',
    title: 'Afternoon break',
    description: 'Refill water, check your notes, and move to the next session.',
    location: 'Main hall',
    type: 'break',
    speakerIds: [],
    visible: true,
    order: 20,
    seeded: true,
    placeId: 'main-hall'
  },
  {
    id: 'session-mapping',
    dayId: 'day-2',
    startTime: '15:15',
    endTime: '16:15',
    title: 'Maps that answer a reader question',
    description: 'For reporters and visual editors working with local data, this clinic asks whether a map answers the reader\'s question better than a table or sentence. Mateo Rivera and Samir Das introduce a fictional neighborhood dataset. Compare counts and rates, choose an area to show, and mark information the source does not provide.\n\nReview a draft at phone size. Check labels, color meaning, source notes, and the claim made by its title. Bring a map idea without private location data, or use the sample. You will leave with an annotated sketch, a checklist for uncertainty and access, and a reasoned choice about whether the story needs a map at all.',
    location: 'Room A',
    type: 'workshop',
    speakerIds: [
      'speaker-mateo-rivera',
      'speaker-samir-das'
    ],
    visible: true,
    order: 21,
    seeded: true,
    placeId: 'room-a',
    track: 'A'
  },
  {
    id: 'session-product',
    dayId: 'day-2',
    startTime: '15:15',
    endTime: '16:15',
    title: 'Test one product change',
    description: 'This workshop is for small teams considering a change to a form, newsletter, or local information page. June Park helps participants turn a broad complaint into one observable task. Choose a fictional reader problem and sketch the smallest change that could make that task easier.\n\nWrite a short test, try it with a partner, and record what happened before deciding whether the idea worked. Bring a screenshot or a plain description of a problem; no coding is required. You will leave with a test script, a list of findings, and a keep-or-change decision rule. The closing discussion covers maintenance time and how to avoid treating a preference as evidence.',
    location: 'Room B',
    type: 'workshop',
    speakerIds: [
      'speaker-june-park'
    ],
    visible: true,
    order: 22,
    seeded: true,
    placeId: 'room-b',
    track: 'B'
  },
  {
    id: 'session-day-two-exchange',
    dayId: 'day-2',
    startTime: '16:30',
    endTime: '17:00',
    title: 'Partnership exchange',
    description: 'This exchange is for anyone seeking a reporting partner, a useful skill, or a second opinion on unfinished work. Amara Okafor and Nora Chen guide short introductions around two questions: What do you need, and what can your team offer? Keep the request small enough for another newsroom to assess.\n\nBring one idea from the workshops and be ready to name its first task, likely cost, and deadline. Pair with someone outside your usual role to test whether the request is clear. You will leave with a draft follow-up note and a next conversation to arrange. Sharing contact information is optional; ask before adding anyone to a list.',
    location: 'Main hall',
    type: 'plenary',
    speakerIds: [
      'speaker-amara-okafor',
      'speaker-nora-chen'
    ],
    visible: true,
    order: 23,
    seeded: true,
    placeId: 'main-hall'
  },
  {
    id: 'session-arrival-3',
    dayId: 'day-3',
    startTime: '09:00',
    endTime: '09:30',
    title: 'Morning coffee and peer check-in',
    description: 'Collect a badge, review the day with the host team, and meet other attendees. Coffee and tea are included in the fictional event plan.',
    location: 'Main hall',
    type: 'break',
    speakerIds: [],
    visible: true,
    order: 24,
    seeded: true,
    placeId: 'main-hall'
  },
  {
    id: 'session-unconference',
    dayId: 'day-3',
    startTime: '09:30',
    endTime: '11:30',
    title: 'Unconference blocks',
    description: 'Bring a question that needs a conversation rather than a presentation. Elena Santos and Amara Okafor help participants group proposed topics at morning coffee. Possible starting points include rural coverage, language support, shared editing, and the work that falls between formal job roles. Participants choose the final topics.\n\nTwo rounds run across rooms A and B, with a pause to move between groups. Each group chooses a host and a note keeper, then records one useful finding and one unresolved question. No slides or prepared talk are needed. You will leave with peer examples, a short set of shared notes, and a next question to explore. Keep sensitive source and personnel details out of the discussion.',
    location: 'Rooms A and B',
    type: 'workshop',
    speakerIds: [
      'speaker-elena-santos',
      'speaker-amara-okafor'
    ],
    visible: true,
    order: 25,
    seeded: true
  },
  {
    id: 'session-unconference-notes',
    dayId: 'day-3',
    startTime: '11:30',
    endTime: '12:00',
    title: 'Report back from the unconference',
    description: 'Hear what the other unconference groups learned without repeating every conversation. Elena Santos invites each note keeper to share one finding, one useful example, and one question that still needs work. This session is useful even if you joined only one of the morning groups.\n\nBring your group\'s notes and check that everyone agrees with the summary before sharing it. Distinguish a tested practice from an idea someone wants to try. You will leave with a compact set of peer lessons and questions to carry into the afternoon planning workshops. The host also identifies topics that need a separate follow-up rather than a hurried answer in the room.',
    location: 'Main hall',
    type: 'plenary',
    speakerIds: [
      'speaker-elena-santos'
    ],
    visible: true,
    order: 26,
    seeded: true,
    placeId: 'main-hall'
  },
  {
    id: 'session-lunch-3',
    dayId: 'day-3',
    startTime: '12:00',
    endTime: '13:00',
    title: 'Lunch and open tables',
    description: 'Join a table by topic or take a quiet break. The fictional meal plan includes vegetarian and vegan choices; attendees can flag dietary needs in advance.',
    location: 'Main hall',
    type: 'break',
    speakerIds: [],
    visible: true,
    order: 27,
    seeded: true,
    placeId: 'main-hall'
  },
  {
    id: 'session-story-plan',
    dayId: 'day-3',
    startTime: '13:00',
    endTime: '14:30',
    title: 'Build your next shared story plan',
    description: 'This working session is for reporters and editors ready to turn a summit idea into a shared assignment. Lucia Bennett, Theo Brooks, and Mateo Rivera help groups define a question, choose evidence, and decide which formats serve the story. Start with your own idea or a fictional brief.\n\nAssign the first reporting tasks, set an editing order, and identify a decision that could stop or change the project. Bring workshop notes and a notebook or laptop. You will leave with a one-page story plan, named roles, a source-checking sequence, and a first review date. Partners also read each other\'s plans to find missing assumptions before anyone commits staff time.',
    location: 'Room A',
    type: 'workshop',
    speakerIds: [
      'speaker-lucia-bennett',
      'speaker-theo-brooks',
      'speaker-mateo-rivera'
    ],
    visible: true,
    order: 28,
    seeded: true,
    placeId: 'room-a',
    track: 'A'
  },
  {
    id: 'session-ninety-days',
    dayId: 'day-3',
    startTime: '13:00',
    endTime: '14:30',
    title: 'Your next 90 days',
    description: 'For publishers, editors, and operations staff carrying several summit ideas home, this workshop helps choose what fits your team\'s capacity. Priya Natarajan and Nora Chen ask participants to list proposed changes, estimate the work, and select a small number to test. A longer list is not the goal.\n\nGive each action an owner, a cost, a first step, and a date to review the evidence. Discuss what you will pause or stop to make room. Bring your notes and a rough view of available staff time. You will leave with a 90-day plan and a short team-meeting agenda that explains why these actions come first and how you will judge progress.',
    location: 'Room B',
    type: 'workshop',
    speakerIds: [
      'speaker-placeholder-3',
      'speaker-nora-chen'
    ],
    visible: true,
    order: 29,
    seeded: true,
    placeId: 'room-b',
    track: 'B'
  },
  {
    id: 'session-break-3',
    dayId: 'day-3',
    startTime: '14:30',
    endTime: '15:00',
    title: 'Afternoon break',
    description: 'Refill water, check your notes, and move to the next session.',
    location: 'Main hall',
    type: 'break',
    speakerIds: [],
    visible: true,
    order: 30,
    seeded: true,
    placeId: 'main-hall'
  },
  {
    id: 'session-closing',
    dayId: 'day-3',
    startTime: '15:00',
    endTime: '16:00',
    title: 'Closing conversation',
    description: 'Close the summit with a plan you can use the next working day. Priya Natarajan, Marisol Reyes, and Amara Okafor bring the two tracks together and invite participants to share decisions from the afternoon workshops. Name a specific action rather than a general ambition.\n\nBring your story plan or 90-day plan. Check that it has an owner, a first step, and a review date. Compare it with a peer and discuss what could prevent the first step from happening. You will leave with a revised commitment and a follow-up question for your team. The final conversation leaves time for unresolved program questions and feedback on what participants need next.',
    location: 'Main hall',
    type: 'plenary',
    speakerIds: [
      'speaker-placeholder-3',
      'speaker-placeholder-1',
      'speaker-amara-okafor'
    ],
    visible: true,
    order: 31,
    seeded: true,
    placeId: 'main-hall'
  }
]);

const DEMO_SPEAKERS = Object.freeze([
  {
    id: 'speaker-placeholder-1',
    firstName: 'Marisol',
    lastName: 'Reyes',
    slug: 'demo-marisol-reyes',
    email: null,
    bio: 'Marisol leads a bilingual reporting desk and coordinates investigations with rural partner outlets. Her team shares source notes, editing plans, and publication calendars. She brings a practical agreement that teams can adapt before their next joint story.',
    headshotPath: 'demo/speakers/marisol-reyes.webp',
    organization: 'Coastal Public Media',
    jobTitle: 'Managing editor',
    socialHandles: {},
    status: 'approved',
    uid: null,
    inviteToken: null,
    approvedAt: '2026-01-01T00:00:00.000Z',
    seeded: true
  },
  {
    id: 'speaker-placeholder-2',
    firstName: 'Devon',
    lastName: 'Achebe',
    slug: 'demo-devon-achebe',
    email: null,
    bio: 'Devon builds listening projects for a three-station radio cooperative. They turn interviews, callouts, and surveys into reporting decisions. Their workshops help small teams ask useful questions without buying a new platform.',
    headshotPath: 'demo/speakers/devon-achebe.webp',
    organization: 'Three Rivers Public Radio',
    jobTitle: 'Audience engagement director',
    socialHandles: {},
    status: 'approved',
    uid: null,
    inviteToken: null,
    approvedAt: '2026-01-01T00:00:00.000Z',
    seeded: true
  },
  {
    id: 'speaker-placeholder-3',
    firstName: 'Priya',
    lastName: 'Natarajan',
    slug: 'demo-priya-natarajan',
    email: null,
    bio: 'Priya runs a reader-supported neighborhood newsroom. She oversees membership, budgets, and partnerships. She shares the tradeoffs behind a revenue plan that pays reporters and leaves room for experiments.',
    headshotPath: 'demo/speakers/priya-natarajan.webp',
    organization: 'Harborlight Neighborhood News',
    jobTitle: 'Co-founder and publisher',
    socialHandles: {},
    status: 'approved',
    uid: null,
    inviteToken: null,
    approvedAt: '2026-01-01T00:00:00.000Z',
    seeded: true
  },
  {
    id: 'speaker-lucia-bennett',
    firstName: 'Lucia',
    lastName: 'Bennett',
    slug: 'demo-lucia-bennett',
    email: null,
    bio: 'Lucia edits public-service investigations across small newsrooms. She builds verification checklists and shared editing agreements. Her workshop starts with a tip and ends with a reporting plan each partner can use.',
    headshotPath: 'demo/speakers/lucia-bennett.webp',
    organization: 'Fieldnote News Lab',
    jobTitle: 'Investigations editor',
    socialHandles: {},
    status: 'approved',
    uid: null,
    inviteToken: null,
    approvedAt: '2026-01-01T00:00:00.000Z',
    seeded: true
  },
  {
    id: 'speaker-omar-farouk',
    firstName: 'Omar',
    lastName: 'Farouk',
    slug: 'demo-omar-farouk',
    email: null,
    bio: 'Omar helps local publishers price sponsorships and track renewal costs. He separates editorial decisions from sales work. His clinic uses a sample cash-flow sheet to test what happens when a grant ends.',
    headshotPath: 'demo/speakers/omar-farouk.webp',
    organization: 'Block by Block Ledger',
    jobTitle: 'Revenue director',
    socialHandles: {},
    status: 'approved',
    uid: null,
    inviteToken: null,
    approvedAt: '2026-01-01T00:00:00.000Z',
    seeded: true
  },
  {
    id: 'speaker-june-park',
    firstName: 'June',
    lastName: 'Park',
    slug: 'demo-june-park',
    email: null,
    bio: 'June designs accessible newsletters and local information tools. She tests pages with readers before adding features. Her sessions focus on clear forms, useful email habits, and small improvements teams can maintain.',
    headshotPath: 'demo/speakers/june-park.webp',
    organization: 'Signal Grove Studio',
    jobTitle: 'Product lead',
    socialHandles: {},
    status: 'approved',
    uid: null,
    inviteToken: null,
    approvedAt: '2026-01-01T00:00:00.000Z',
    seeded: true
  },
  {
    id: 'speaker-elena-santos',
    firstName: 'Elena',
    lastName: 'Santos',
    slug: 'demo-elena-santos',
    email: null,
    bio: 'Elena leads Spanish and English listening sessions with neighborhood groups. She trains reporters to explain consent and return findings to participants. Her workshop includes an interview guide and a plan for closing the feedback loop.',
    headshotPath: 'demo/speakers/elena-santos.webp',
    organization: 'Cedarline Noticias',
    jobTitle: 'Community editor',
    socialHandles: {},
    status: 'approved',
    uid: null,
    inviteToken: null,
    approvedAt: '2026-01-01T00:00:00.000Z',
    seeded: true
  },
  {
    id: 'speaker-theo-brooks',
    firstName: 'Theo',
    lastName: 'Brooks',
    slug: 'demo-theo-brooks',
    email: null,
    bio: 'Theo produces short audio stories with community reporters. He teaches field recording, transcript review, and low-cost editing. Participants leave his workshop with a short scene and a checklist for consent.',
    headshotPath: 'demo/speakers/theo-brooks.webp',
    organization: 'Public Square Audio',
    jobTitle: 'Audio producer',
    socialHandles: {},
    status: 'approved',
    uid: null,
    inviteToken: null,
    approvedAt: '2026-01-01T00:00:00.000Z',
    seeded: true
  },
  {
    id: 'speaker-amara-okafor',
    firstName: 'Amara',
    lastName: 'Okafor',
    slug: 'demo-amara-okafor',
    email: null,
    bio: 'Amara coordinates shared coverage among independent outlets. She helps partners divide work, settle credit, and measure what readers use. Her panel examines how to keep a collaboration useful after its first grant.',
    headshotPath: 'demo/speakers/amara-okafor.webp',
    organization: 'Commonline Reporting Network',
    jobTitle: 'Partnerships director',
    socialHandles: {},
    status: 'approved',
    uid: null,
    inviteToken: null,
    approvedAt: '2026-01-01T00:00:00.000Z',
    seeded: true
  },
  {
    id: 'speaker-samir-das',
    firstName: 'Samir',
    lastName: 'Das',
    slug: 'demo-samir-das',
    email: null,
    bio: 'Samir builds small data tools for public-interest reporting. He checks spreadsheets, documents assumptions, and teaches reproducible workflows. His workshop turns a messy sample table into a verified story lead.',
    headshotPath: 'demo/speakers/samir-das.webp',
    organization: 'Openfield Tools',
    jobTitle: 'Data editor',
    socialHandles: {},
    status: 'approved',
    uid: null,
    inviteToken: null,
    approvedAt: '2026-01-01T00:00:00.000Z',
    seeded: true
  },
  {
    id: 'speaker-nora-chen',
    firstName: 'Nora',
    lastName: 'Chen',
    slug: 'demo-nora-chen',
    email: null,
    bio: 'Nora manages people, schedules, and project costs at a worker-owned newsroom. She creates clear handoffs and realistic workloads. Her sessions help teams plan coverage without making overtime the default.',
    headshotPath: 'demo/speakers/nora-chen.webp',
    organization: 'Neighborwave Cooperative',
    jobTitle: 'Operations director',
    socialHandles: {},
    status: 'approved',
    uid: null,
    inviteToken: null,
    approvedAt: '2026-01-01T00:00:00.000Z',
    seeded: true
  },
  {
    id: 'speaker-mateo-rivera',
    firstName: 'Mateo',
    lastName: 'Rivera',
    slug: 'demo-mateo-rivera',
    email: null,
    bio: 'Mateo makes explanatory maps and graphics for local reporting teams. He checks labels, uncertainty, and mobile reading before publication. His clinic helps participants choose a visual that answers a reader question.',
    headshotPath: 'demo/speakers/mateo-rivera.webp',
    organization: 'Civic Thread Studio',
    jobTitle: 'Visual editor',
    socialHandles: {},
    status: 'approved',
    uid: null,
    inviteToken: null,
    approvedAt: '2026-01-01T00:00:00.000Z',
    seeded: true
  }
]);

const DEMO_ORGANIZATIONS = Object.freeze([
  {
    id: 'org-placeholder-1',
    name: 'Beacon Community Fund',
    tier: 'presenting',
    url: null,
    logoPath: 'demo/sponsors/beacon-community-fund.webp',
    description: 'Funds the fictional travel-grant pool and shared plenary sessions.',
    bio: 'Beacon Community Fund is a fictional grantmaker focused on the practical costs of public-service reporting. Its model supports small newsrooms that need time for records requests, editing, and collaboration. The fund asks teams to explain the information need, the work they will share, and how they will report back to readers. It does not select stories or approve coverage.\n\nAt Harborlight, Beacon represents a funder willing to pay for the work around a gathering, including travel support and time for participants to learn together. Its presence illustrates how an event can explain a sponsor\'s role without presenting financial support as editorial endorsement.',
    supportDescription: 'Presenting support covers the fictional travel-grant pool and shared plenary sessions. The summit team sets the program and chooses speakers independently. This demo does not accept grant applications or offer real travel awards.',
    readMorePath: '/schedule/session-closing',
    visible: true,
    order: 0,
    seeded: true
  },
  {
    id: 'org-placeholder-2',
    name: 'Lighthouse Press Trust',
    tier: 'supporting',
    url: null,
    logoPath: 'demo/sponsors/lighthouse-press-trust.webp',
    description: 'Supports speaker preparation, peer coaching, and workshop materials.',
    bio: 'Lighthouse Press Trust is a fictional nonprofit that helps newsroom teams build routines they can maintain. Its work centers on editor coaching, staff training, and the documents that make a handoff clear. A typical project pairs a short workshop with a later check on what the team used. The emphasis is on useful practice rather than a new platform.\n\nThe trust\'s role at Harborlight reflects that approach. It supports preparation time and materials so a speaker can bring an exercise that works for participants with different levels of experience. The fictional partnership also makes room for small-group questions after the main presentation.',
    supportDescription: 'Supporting funds cover speaker preparation, peer coaching, and workshop materials in the demo event plan. Participants can use the exercises without joining a service or sharing their contact information with the sponsor.',
    readMorePath: '/schedule/session-workshop-a',
    visible: true,
    order: 1,
    seeded: true
  },
  {
    id: 'org-placeholder-3',
    name: 'Tidewater Media Collective',
    tier: 'partner',
    url: null,
    logoPath: 'demo/sponsors/tidewater-media-collective.webp',
    description: 'Contributes reporting mentors and hosts the partnership exchange.',
    bio: 'Tidewater Media Collective is a fictional partnership of independent local outlets that share reporting tasks while keeping separate editorial identities. Members agree on project roles, source handling, editing, credit, and publication timing before work begins. The collective also keeps a record of staff time so partners can see whether the arrangement remains fair.\n\nAt Harborlight, Tidewater contributes the perspective of teams doing the daily coordination work. Its mentors help participants test a reporting agreement and make a clear request to a possible partner. The collective is a demo organization, and the event does not promise introductions to real newsrooms.',
    supportDescription: 'Partner support includes reporting mentors and hosts for the afternoon partnership exchange. The fictional mentors help participants define one next task and a workable follow-up, with no requirement to join a network.',
    readMorePath: '/schedule/session-day-two-exchange',
    visible: true,
    order: 2,
    seeded: true
  },
  {
    id: 'org-openfield-tools',
    name: 'Openfield Tools',
    tier: 'supporting',
    url: null,
    logoPath: 'demo/sponsors/openfield-tools.webp',
    description: 'Supports the data lab with open worksheets and hands-on coaching.',
    bio: 'Openfield Tools is a fictional small team that builds reporting worksheets and simple data-checking methods. It designs for newsrooms that need to inspect a source table, document an assumption, and hand the work to an editor. Its examples use ordinary spreadsheet functions and clear notes so the method remains useful when software changes.\n\nThe team supports Harborlight\'s data lab through teaching time and sample exercises. Its role is to help participants understand their evidence before choosing a tool. No paid account, product purchase, or upload of newsroom data is part of the fictional workshop arrangement.',
    supportDescription: 'Supporting contributions cover sample data, verification worksheets, and hands-on coaching for the data lab. Exercises use fictional records. Participants should keep private source files and credentials out of shared examples.',
    readMorePath: '/schedule/session-verification',
    visible: true,
    order: 3,
    seeded: true
  },
  {
    id: 'org-civic-thread-studio',
    name: 'Civic Thread Studio',
    tier: 'partner',
    url: null,
    logoPath: 'demo/sponsors/civic-thread-studio.webp',
    description: 'Contributes visual reporting clinics and accessible slide templates.',
    bio: 'Civic Thread Studio is a fictional visual reporting practice that makes maps, diagrams, and explanatory graphics for local news teams. Its process begins with the reader\'s question, then checks whether a visual helps answer it. Editors review labels, source limits, mobile reading, and alternatives for readers who cannot see the image.\n\nAt Harborlight, the studio contributes clinic time and examples that participants can mark up together. Its support shows how a specialist partner can teach a repeatable review method rather than deliver a finished graphic that the newsroom cannot update. The sponsor is fictional and does not offer a real booking service here.',
    supportDescription: 'Partner support covers visual reporting clinics and accessible slide examples. The summit\'s editors retain control of session content. Participants can bring a public example or work from the fictional map supplied for the exercise.',
    readMorePath: '/schedule/session-mapping',
    visible: true,
    order: 4,
    seeded: true
  },
  {
    id: 'org-common-ground-coffee',
    name: 'Common Ground Coffee',
    tier: 'partner',
    url: null,
    logoPath: 'demo/sponsors/common-ground-coffee.webp',
    description: 'Supports the fictional coffee breaks and morning welcome tables.',
    bio: 'Common Ground Coffee is a fictional neighborhood coffee cooperative built around shared ownership and a small, clearly priced menu. In the Harborlight scenario, it works with event teams to plan drinks, label ingredients, and keep service simple during short breaks. Its example makes the practical role of a local hospitality partner visible.\n\nThe cooperative\'s contribution supports the time between sessions, when participants compare notes and meet people outside their usual teams. It does not receive an attendee contact list. All food and drink arrangements on this site are part of the demo, with no real catering order or venue agreement.',
    supportDescription: 'Partner support covers morning coffee, tea, and staffed welcome tables in the fictional event plan. A real event would confirm ingredients, service access, and dietary arrangements with its caterer before publishing final details.',
    readMorePath: '/schedule/session-arrival-1',
    visible: true,
    order: 5,
    seeded: true
  }
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
  config.features.updates = true;
  config.features.icsExport = true;
  config.theme.logos.mark = null;
  Object.assign(config.event, DEMO_EVENT_OVERRIDES);

  const pages = defaultPages().map((page) => ({
    ...page,
    seeded: true,
    sections: page.sections.map((section) => section.id === 'recap_media'
      ? { ...section, allowedBlocks: [...section.allowedBlocks, 'image'] }
      : section),
  }));
  const content = buildSeedContent({
    pages,
    docs: config,
    tierA: DEMO_TIER_A,
    seededAt: DEMO_SEEDED_AT,
  }).map((doc) => {
    const overlay = DEMO_CONTENT[doc.id];
    return overlay ? { ...doc, ...overlay } : doc;
  }).concat(DEMO_PAGE_EXTRA_CONTENT);

  return {
    config,
    pages,
    content,
    updates: DEMO_UPDATES.map((update) => ({ ...update })),
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
  DEMO_PAGE_EXTRA_CONTENT,
};
