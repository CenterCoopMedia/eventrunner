'use strict';

// Curated public historical material only. No attendee list, private speaker
// contacts, live invitation tokens or client deployment export is used.
const { buildConfigDocs } = require('./answers.cjs');
const { defaultPages, buildSeedContent } = require('./seed.cjs');
const { buildPublicSpeaker } = require('shared/speaker');
const { resolveLegacyColors } = require('shared/theme');
const DEMO_UPDATES = require('./demo-updates.json');
const DEMO_SEEDED_AT = '2026-01-01T00:00:00.000Z';
const PROGRAM_SOURCE = 'https://www.eventbrite.com/e/2026-nc-news-information-summit-tickets-1676080575119';
const RECAP_SOURCE = 'https://www.elon.edu/u/news/2026/04/01/nc-news-information-summit-draws-record-attendance-spotlights-ais-impact-on-local-news/';
const DEMO_TIER_A = Object.freeze({ slug: 'demo-event', projectId: 'demo-run-of-show', region: 'us-central1', publicUrl: 'https://example.org', storageBucket: null, allowedOrigins: [], emailProvider: 'console', ticketingProvider: 'none', ticketingEventId: null, operatorNotifier: 'none' });
const DEMO_ANSWERS = Object.freeze({
  adminEmails: ['demo-admin@example.org', 'demo-operator@example.org'],
  event: {
    name: 'NC News & Information Summit', shortName: 'NC Local', tagline: 'Historical 2026 program · EventRunner demo', timezone: 'America/New_York',
    days: [{ id: 'day-1', label: 'Friday', date: '2026-03-27', startTime: '08:00', endTime: '16:30' }],
    tracks: [{ letter: 'A', name: 'Reporting & public information' }, { letter: 'B', name: 'Community & collaboration' }],
    registration: { opensAt: null, closesAt: null, externalUrl: null, actionLabel: null },
    venue: {
      name: 'McKimmon Center', addressLine1: '1101 Gorman Street', addressLine2: null, city: 'Raleigh', region: 'NC', postalCode: '27606', country: 'US',
      mapUrl: 'https://www.openstreetmap.org/search?query=1101%20Gorman%20Street%20Raleigh%20NC%2027606',
      places: [3, 4, 6, 9].map((room) => ({ id: `room-${room}`, name: `Room ${room}`, floor: null })), movements: [], map: null,
    },
    sender: { email: 'summit@example.org', name: 'NC Local historical demo', replyTo: null },
    legal: { operatorName: 'EventRunner historical demo', postalAddressHtml: '<p>Historical NC Local summit mock-up. No registration, email delivery or staffed event service.</p>', supportEmail: 'support@example.org', conductEmail: 'conduct@example.org' },
    seo: { description: 'Past-event demo of the 2026 NC News & Information Summit in Raleigh: Selected historical sessions, speakers and documented partners.', organizerName: 'NC Local and NC Open Government Coalition', organizerUrl: 'https://nclocal.org/' },
  },
  theme: { preset: 'newsroom', colors: resolveLegacyColors({ preset: 'newsroom' }), mode: 'light', header: 'masthead' },
});

// Titles, rooms, times and affiliations come from the supplied published
// agenda. No room, speaker role, biography or interior route is inferred.
const PROGRAM = [
  ['keynote', '09:00', '10:00', null, 'keynote', 'A', 'Keynote: NC’s AI Crossroads: Innovation, Investigation & the Public Interest.', [
    ['Alex Mahadevan', 'Poynter'], ['Lisa Sorg', 'Inside Climate News'], ['Dr. Siobahn Day Grady', 'NC Central University'], ['Ricky Leung', 'Code the Dream'],
  ]],
  ['elections', '10:45', '11:45', 3, 'panel', 'A', 'The Journalists’ Guide to the 2026 Elections.', [
    ['Brooks Fuller', 'Common Cause NC'], ['Tyler Daye', 'Common Cause NC'], ['Kyle Ingram', 'The News & Observer'], ['Olivia McCall', 'Wake County Board of Elections'],
  ]],
  ['education-records', '10:45', '11:45', 4, 'panel', 'A', 'Fighting for Public Records on the Education Beat.', [
    ['Korie Dean', 'The Assembly'], ['Rachel Keith', 'WHQR'], ['Corinne Saunders', 'Outer Banks Insider'], ['Beth Soja', 'Reporters Committee for Freedom of the Press'],
  ]],
  ['immigration', '13:00', '14:00', 3, 'panel', 'A', 'Lessons Learned from the Immigration Emergencies.', [
    ['Ely Portillo', 'WFAE'], ['Patricia Ortiz', 'Enlace Latino NC'], ['Alvaro Gurdián', 'La Noticia'], ['Brandon Kingdollar', 'NC Newsline (at the time)'], ['Christina Piaia', 'ProJourn'],
  ]],
  ['community-journalism', '13:00', '14:00', 9, 'panel', 'B', 'When Journalism Becomes Transformative, Not Transactional.', [
    ['Antionette Kerr', 'Davidson Local'], ['Derwin Montgomery', 'The Winston-Salem Chronicle'], ['Aminah Ghaffar-Fulp', '7 Directions of Service'],
  ]],
  ['newsroom-ai', '14:15', '15:15', 4, 'workshop', 'A', 'AI for the Newsroom: A Hands-on Guide to NotebookLM and Pinpoint.', [['Iain Christie', 'Google News Initiative']]],
  ['mutual-aid', '14:15', '15:15', 6, 'panel', 'B', 'Building a Local News Mutual Aid Network for Times of Crisis.', [
    ['Alicia Bell', 'Racial Equity in Journalism Fund at Borealis Philanthropy'], ['Chris Rudisill', 'Charlotte Journalism Collaborative'],
  ]],
  ['ethics-disclosures', '14:15', '15:15', 9, 'workshop', 'A', 'From Filings to Stories: Turning Ethics Disclosures Into Coverage.', [['Audrey Nielsen', 'Independent journalist'], ['Diara J. Townes', 'NC Local']]],
];
function speakerSlug(name) {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/^dr\. /, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
const DEMO_SPEAKERS = Object.freeze(PROGRAM.flatMap((entry) => entry[7].map(([name, organization]) => {
  const words = name.split(' ');
  const slug = speakerSlug(name);
  return { id: `speaker-${slug}`, firstName: words.slice(0, -1).join(' '), lastName: words.at(-1), slug, email: null,
    bio: `Listed in the historical 2026 program for “${entry[6]}” Affiliation at the summit: ${organization}.`,
    organization, jobTitle: '2026 summit speaker', headshotPath: null, socialHandles: {}, status: 'approved', uid: null, inviteToken: null, approvedAt: DEMO_SEEDED_AT, seeded: true };
})));
const DEMO_SESSIONS = Object.freeze([
  { id: 'session-check-in', startTime: '08:00', endTime: '09:00', title: 'Breakfast and check-in', type: 'break', speakerIds: [] },
  ...PROGRAM.map(([id, startTime, endTime, room, type, track, title, people]) => ({
    id: `session-${id}`, startTime, endTime, title, type, track, location: room ? `Room ${room}` : 'Room not specified in this demo', placeId: room ? `room-${room}` : null,
    description: 'Selected session from the published March 27, 2026 program. All times Eastern. This past-event demo offers no attendance or registration.', speakerIds: people.map(([name]) => `speaker-${speakerSlug(name)}`),
  })),
  { id: 'session-awards', startTime: '10:00', endTime: '10:30', title: 'Sunshine Awards and Frank Barrows Award', type: 'break', speakerIds: [] },
  { id: 'session-lunch', startTime: '12:00', endTime: '13:00', title: 'Lunch · WUNC’s Due South broadcast', type: 'break', speakerIds: [], description: 'WUNC participated in the lunch broadcast. This role is distinct from summit co-production and sponsorship.' },
  { id: 'session-final-block', startTime: '15:30', endTime: '16:30', title: 'Final concurrent program block', type: 'break', speakerIds: [], description: 'The day continued with concurrent sessions from 3:30–4:30 p.m. This eight-session selection does not reproduce those sessions. See the original agenda for the full program.' },
].map((session, order) => ({ dayId: 'day-1', location: 'McKimmon Center', visible: true, seeded: true, order, ...session })));
const DEMO_ORGANIZATIONS = Object.freeze([
  ['nc-local', 'NC Local', 'Co-producers', 'https://nclocal.org/', 'Statewide nonprofit, nonpartisan newsroom and ecosystem organization. Co-produced the 2026 summit.', 'branding/nclocal-logo.png'],
  ['nc-open-government', 'NC Open Government Coalition', 'Co-producers', 'https://www.elon.edu/u/nc-open-government/', 'Co-produced the 2026 summit with NC Local.', null],
  ['wunc', 'WUNC', 'Lunch broadcast participant', 'https://www.wunc.org/', 'Due South participated with a lunch broadcast from noon to 1 p.m.', null],
  ['assembly', 'The Assembly', 'Afterparty sponsor', 'https://www.theassemblync.com/', 'Sponsored the 5–8 p.m. afterparty at Trophy Brewing’s The Bend Bar, 853 W Morgan St, Raleigh.', null],
].map(([id, name, tier, url, description, logoPath], order) => ({ id: `org-${id}`, name, tier, url, description, logoPath, bio: description, supportDescription: `${tier}. Historical role only; this mock-up does not imply endorsement of EventRunner.`, readMorePath: null, visible: true, order, seeded: true })));
const DEMO_TIMELINE = Object.freeze([]);
const DEMO_CONTENT = Object.freeze({
  hero__title: { value: 'North Carolina’s local news community, together.' },
  hero__subtitle: { value: 'Explore the sessions and people behind the fifth annual NC News & Information Summit, a day of shared learning about journalism, public information and the communities they serve.' },
  info__when: { label: 'When', note: 'Friday, March 27, 2026 · 8 a.m.–4:30 p.m. Eastern. Past event.' },
  info__where: { label: 'Where', value: 'McKimmon Center', note: '1101 Gorman Street, Raleigh, NC 27606' },
  info__where_transit: { text: 'Raleigh, North Carolina. No interior route or walking time is inferred.' },
  info__who: { label: 'Who', value: 'North Carolina’s journalists, newsrooms and information providers', note: 'Eight selected historical sessions. Registration is closed.' },
  details__intro: { value: '<p>NC Local serves North Carolina with statewide reporting, newsroom partnerships and community listening. The Hub connects the local news ecosystem through resources, a newsletter and convenings.</p><p>Catherine Komp, NC Local’s Ecosystem Engagement Director, leads ecosystem engagement and the annual summit. This past-event mock-up uses a selected historical 2026 program to show an EventRunner site for that community.</p><p>The headline is adapted for this demo. It is not an official quote. No future event, attendance, endorsement or registration is offered.</p>' },
  highlights__first: { text: 'Reporting, public records, elections, immigration, community work and practical newsroom AI.' },
  sponsors__lede: { value: 'Historical roles: Co-produced by NC Local and NC Open Government Coalition. WUNC participated in the lunch broadcast. The Assembly sponsored the afterparty.' },
  footer__contact_link: { group: 'NC Local', label: 'About NC Local', url: 'https://nclocal.org/about/' },
  travel_header__page_title: { value: 'Raleigh locations' },
  travel_header__page_subtitle: { value: 'Historical locations from March 27, 2026. This demo offers no travel bookings.' },
  travel_venue__venue_notes: { value: '<p>McKimmon Center, 1101 Gorman Street, Raleigh, NC 27606. The summit ran from 8 a.m. to 4:30 p.m. Eastern.</p><p>Selected concurrent sessions used Rooms 3, 4, 6 and 9. The keynote room is not specified in this demo. No floor plan, walking time or accessibility route is inferred.</p>' },
  travel_help__help_title: { value: 'Historical event information' },
  travel_help__help_description: { value: '<p>Use the original program and recap for historical context. This mock-up has no staffed event help desk.</p>' },
  faq_intro__summary: { value: '<p>This past-event demo includes eight selected sessions, not the full historical agenda.</p>' },
  faq_items__what_is_this: { question: 'Is this a future event?', answer: '<p>No. The summit took place on Friday, March 27, 2026. Registration, ticket claims and email actions are disabled. Historical names and roles do not imply endorsement of EventRunner.</p>' },
  conduct_intro__summary: { value: '<p>This historical mock-up does not operate an event or a staffed conduct reporting service.</p>' },
  conduct_expectations__first: { text: 'This demo does not establish an NC Local conduct policy.' },
  conduct_reporting__how_to_report: { value: '<p>There is no active event reporting channel. This site does not send email.</p>' },
  contact_intro__summary: { value: '<p>Learn about the organization on the official NC Local website. This demo does not accept inquiries or send email.</p>' },
  contact_channels__support: { group: 'Official organization website', label: 'NC Local', url: 'https://nclocal.org/' },
  privacy_intro__summary: { value: '<p>This historical EventRunner demo does not create accounts, accept registrations or send email. This sample page is not NC Local’s privacy policy.</p>' },
  privacy_data__account: { value: '<p>Speaker names and affiliations reflect the published program. No attendee directory or private speaker contacts are shown.</p>' },
  privacy_data__signin: { value: '<p>Account features are disabled. Do not enter personal information in demo fields.</p>' },
  privacy_sharing__processors: { value: '<p>Source and map links open websites with their own policies.</p>' },
  privacy_retention__period: { value: '<p>This demo does not collect registration data.</p>' },
  privacy_rights__requests: { value: '<p>Consult the official NC Local website for its privacy information.</p>' },
  privacy_contact__address: { value: '<p>This demo has no active privacy contact form or email service.</p>' },
  terms_intro__summary: { value: '<p>This is an EventRunner mock-up of a historical NC Local event. It is not an official NC Local website or an attendance offer.</p>' },
  terms_accounts__eligibility: { value: '<p>Browse the historical program and speakers without an account. This demo does not issue tickets.</p>' },
  terms_conduct__expectations: { value: '<p>No staffed event service or new conduct policy is offered here.</p>' },
  terms_liability__disclaimer: { value: '<p>Historical names, roles and locations do not imply endorsement of EventRunner or a future booking.</p>' },
  terms_contact__address: { value: '<p>This demo does not accept support email.</p>' },
});
function extra(section, field, blockType, fields, order = 0) {
  return { id: `${section}__${field}`, section, field, blockType, ...fields, order, visible: true, seeded: true, seededAt: DEMO_SEEDED_AT };
}
const DEMO_PAGE_EXTRA_CONTENT = Object.freeze([
  extra('hero', 'program', 'cta', { label: 'Explore the program', url: '/schedule', style: 'primary' }, 2),
  extra('hero', 'speakers', 'cta', { label: 'View speakers', url: '/speakers', style: 'secondary' }, 3),
  extra('details', 'hub', 'richtext', { value: '<p><a href="https://nclocal.org/hub/">Explore The Hub</a> for newsroom resources, an ecosystem newsletter and convenings.</p>' }, 1),
  extra('highlights', 'afterparty', 'list_item', { text: 'The Assembly sponsored the historical 5–8 p.m. afterparty at Trophy Brewing’s The Bend Bar, 853 W Morgan St, Raleigh.' }, 1),
  extra('travel_local', 'afterparty', 'richtext', { value: '<p>The afterparty took place from 5–8 p.m. at Trophy Brewing’s The Bend Bar, 853 W Morgan St, Raleigh. The Assembly was the afterparty sponsor.</p>' }),
  extra('travel_local', 'program', 'link_group', { group: 'Historical sources', label: 'Original 2026 program (ended listing)', url: PROGRAM_SOURCE }, 1),
  extra('city_guide_intro', 'welcome', 'richtext', { value: '<p>Raleigh, North Carolina, was the setting for the fifth annual NC News & Information Summit.</p>' }),
  extra('city_guide_around', 'locations', 'richtext', { value: '<p>Summit: McKimmon Center, 1101 Gorman Street, Raleigh, NC 27606.</p><p>Afterparty: Trophy Brewing’s The Bend Bar, 853 W Morgan St, Raleigh.</p>' }),
  extra('recap_summary', 'body', 'richtext', { value: `<p>The fifth annual summit took place March 27, 2026.</p><p><a href="${RECAP_SOURCE}">Read Elon University’s historical recap</a>.</p>` }),
  extra('recap_media', 'panel', 'image', { url: 'hero/nclocal-summit.jpg', alt: 'Speakers on the 2026 NC News & Information Summit keynote panel.', caption: 'Historical summit photograph. Source: Elon University, April 1, 2026 recap.' }),
  extra('contact_channels', 'hub', 'link_group', { group: 'Official organization website', label: 'The Hub', url: 'https://nclocal.org/hub/' }, 1),
  extra('guidelines_intro', 'historical', 'richtext', { value: '<p>This demo describes historical speakers. It does not invite speakers or accept profile, slide or email submissions.</p>' }),
]);
function demoEvent() {
  const built = buildConfigDocs({ answers: DEMO_ANSWERS, tierA: DEMO_TIER_A, now: () => Date.parse(DEMO_SEEDED_AT) });
  if (!built.ok) throw new Error(`demo fixture no longer validates: ${built.errors.join('; ')}`);
  const config = built.docs;
  Object.assign(config.features, { updates: true, attendeeDirectory: false, icsExport: false });
  Object.assign(config.theme.logos, { primary: 'branding/nclocal-logo.png', mark: 'branding/nclocal-logo.png', footer: 'branding/nclocal-logo.png', ogDefault: 'branding/nclocal-og.png', favicon: 'branding/nclocal-favicon.svg' });
  Object.assign(config.event, { announcedAt: '2026-01-01T12:00:00', archivedAt: '2026-03-28T00:00:00' });
  config.event.seo.defaultOgImagePath = 'branding/nclocal-og.png';
  config.event.seo.organizerUrl = 'https://nclocal.org/';
  const visiblePages = new Set(['home', 'schedule', 'speakers', 'sponsors', 'updates', 'travel', 'recap', 'faq', 'privacy', 'terms', 'contact', 'city_guide', 'conduct', 'guidelines']);
  const labels = { schedule: 'Program', sponsors: 'Partners', travel: 'Locations', city_guide: 'Raleigh', recap: 'Recap' };
  const pages = defaultPages().filter((page) => visiblePages.has(page.id)).map((page) => ({
    ...page, label: labels[page.id] ?? page.label, seeded: true,
    sections: page.sections.filter((section) => !['stats', 'history', 'sponsor_packages'].includes(section.id)).map((section) => {
      if (section.id === 'sponsors') return { ...section, label: 'Historical partners' };
      if (section.id === 'recap_media') return { ...section, allowedBlocks: [...section.allowedBlocks, 'image'] };
      return section;
    }),
  }));
  const content = buildSeedContent({ pages, docs: config, tierA: DEMO_TIER_A, seededAt: DEMO_SEEDED_AT }).filter((doc) => DEMO_CONTENT[doc.id]).map((doc) => ({ ...doc, ...DEMO_CONTENT[doc.id] })).concat(DEMO_PAGE_EXTRA_CONTENT);
  return { config, pages, content, updates: DEMO_UPDATES.map((update) => ({ ...update })), sessions: DEMO_SESSIONS.map((s) => ({ ...s })), speakers: DEMO_SPEAKERS.map((s) => ({ ...s })), organizations: DEMO_ORGANIZATIONS.map((o) => ({ ...o })), timeline: [] };
}
function demoSnapshot() {
  const demo = demoEvent();
  return { event: demo.config.event, features: demo.config.features, theme: demo.config.theme, pages: demo.pages, content: demo.content, sessions: demo.sessions, speakers: demo.speakers.map((speaker) => ({ id: speaker.id, ...buildPublicSpeaker(speaker) })), organizations: demo.organizations, timeline: demo.timeline };
}
module.exports = { demoEvent, demoSnapshot, DEMO_ANSWERS, DEMO_TIER_A, DEMO_SEEDED_AT, DEMO_SESSIONS, DEMO_SPEAKERS, DEMO_ORGANIZATIONS, DEMO_TIMELINE, DEMO_CONTENT, DEMO_PAGE_EXTRA_CONTENT };
