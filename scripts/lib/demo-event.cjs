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
      mapUrl: 'https://www.google.com/maps/search/?api=1&query=The+Newark+Museum+of+Art+49+Washington+Street+Newark+NJ',
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
    description: 'Meet the hosts, choose a workshop track, and review the conduct and access arrangements in the demo plan.',
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
    description: 'A newsroom partnership starts with one useful promise. Marisol shares a reporting example and a method for agreeing on the work.',
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
    description: 'Build a shared reporting plan. Agree on sources, editing, credit, and publication dates using a fictional investigation.',
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
    description: 'Write a clear membership offer and test it against three reader needs. Bring a draft message or use the sample newsroom.',
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
    description: 'Clean a sample public-spending table, check totals, and record assumptions. Leave with a source note another reporter can follow.',
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
    description: 'Choose a reader need, edit a sample issue, and design one small test. Use plain text and a clear call to action.',
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
    description: 'Practice a community interview, explain consent, and build a plan to share findings with participants.',
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
    description: 'Map a week of work, identify hidden tasks, and build a handoff that protects time for editing and rest.',
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
    description: 'Compare one change from each workshop. Find a peer who can review your next draft.',
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
    description: 'Three newsroom leaders explain how they fund shared coverage after the first year. Questions focus on costs, credit, and difficult decisions.',
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
    description: 'Record a short interview in pairs. Check consent, sound, and context before making the first edit.',
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
    description: 'Work through a sample sponsor request. Draft a policy that separates editorial judgment from commercial support.',
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
    description: 'Start with one decision your newsroom needs to make. Draft a short survey, then move to the main hall for the linked review clinic.',
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
    description: 'Test a sample budget against the loss of one grant. Identify costs, reserves, and decisions to make before cash runs short.',
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
    description: 'The second part of the audience workshop moves to the main hall. Review draft questions in small groups and remove leading language.',
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
    description: 'Choose a useful map extent, check labels, and explain missing data. Review a sample neighborhood map at mobile size.',
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
    description: 'Sketch a form or newsletter change, write a simple test, and decide what evidence would make you keep it.',
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
    description: 'Share a reporting need or a skill your team can offer. Hosts help match ideas for follow-up after the summit.',
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
    description: 'Pitch a question at morning coffee. Join a participant-led conversation about rural coverage, language access, or shared editing. Groups rotate halfway through.',
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
    description: 'Each group shares one finding and one open question. Add useful resources to the shared notes.',
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
    description: 'Bring an idea from the summit. Define the first reporting step, the partner roles, and the evidence needed to publish.',
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
    description: 'Turn workshop notes into a short plan with an owner, a cost, and a review date for each action.',
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
    description: 'Share the decisions from three days of work. Name the next action, find a follow-up partner, and leave time for final questions.',
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
