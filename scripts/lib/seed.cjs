'use strict';

/**
 * The fifteen default pages and their placeholder content (spec §5.3, §5.4).
 *
 * Pure. `defaultPages()` returns cmsPages documents in exactly the shape
 * `validatePageDoc` (functions/src/cms/pages.cjs) accepts — init runs that
 * real validator over every page before writing, so a seed can never
 * create a document the admin save endpoint would reject. Paths are
 * root-level (issue #52): a non-system page's `path` IS its URL, and none
 * of the generic pages may claim a segment in the shared reserved-path
 * registry.
 *
 * Placeholder strategy (§5.4): every seeded block carries `seeded: true`
 * and `seededAt`, its copy is a one-sentence description of what belongs
 * there prefixed `[Replace] `, stats are zeros with real labels, images
 * point at the neutral branding placeholders, and dates and venue render
 * from `config/event` so they are correct the moment init runs. No real
 * event's copy, in seeds, fixtures, tests, or the demo instance.
 *
 * The travel page (§5.3) is the one page whose shape matters as much as
 * its copy. Its repeating groups — lodging, transit, shuttle times, local
 * links — are variable-length CMS lists, seeded with NO items at all, so
 * an incomplete travel seed renders a sparse page rather than another
 * event's directions. `ContentPage` skips any section with zero visible
 * blocks, which is what makes "empty section renders nothing" fall out of
 * the data instead of needing a special case in the renderer.
 */

const { VENUE_MAP_SECTION_ID } = require('shared/venue');
const { buildLegalContent } = require('./legal.cjs');
const { getDefaultTemplate } = require('../../functions/src/email/templates.cjs');

/** Field-list sections seed empty (spec §5.3): zero items renders nothing. */
const EMPTY = [];

function section(id, label, description, allowedBlocks, maxBlocks, defaultBlocks = EMPTY, reorderable = true) {
  return { id, label, description, allowedBlocks, maxBlocks, reorderable, defaultBlocks };
}

function block(field, blockType, description) {
  return { field, blockType, description };
}

/**
 * The fifteen seeded pages (§5.3): home, schedule, speakers, sponsors,
 * attendees, updates (system pages, each owning a dedicated React route),
 * then travel, faq, conduct, contact, privacy, terms, recap, guidelines,
 * city_guide as generic content pages at their own root-level paths.
 *
 * recap, guidelines, and city_guide follow the travel page's empty-section
 * pattern all the way through, not just for its repeating lists: every
 * section on all three pages seeds with zero default blocks, so each page
 * renders the site's empty state until an operator writes something.
 * None of the three may carry a real event's copy, the way every other
 * placeholder here already does not — city_guide in particular names no
 * city, no restaurant, no attraction, and no transit line; the section
 * descriptions instruct an operator without guessing at their answer.
 *
 * EVERY SYSTEM ROUTE GETS A DOCUMENT, INCLUDING THE TWO THAT SEED NO
 * CONTENT. Attendees and Updates own dedicated routes (shared/routing
 * reserves both segments) and both render through `SystemPage`, which reads
 * the page's `template`, `layout`, and section slots. Without a document
 * there is nothing in the admin Pages list to open, so those two pages were
 * the only ones an operator could not shape. They seed the same way
 * schedule, speakers, and sponsors do: a document with no sections, because
 * the route's own component is the page and the sections are what an
 * operator adds around it.
 *
 * THEY ARE APPENDED, NOT INSERTED. `order` only sorts the admin Pages list,
 * and re-running init refreshes a seeded page that nobody has edited while
 * leaving an edited one alone. Renumbering the ten pages that came before
 * would therefore half-apply on a deployment where an operator had edited
 * some of them, scrambling their list. New numbers at the end change no
 * stored page at all, which is the same rule the layout schema follows:
 * existing documents keep working, and no migration runs.
 *
 * @returns {object[]} cmsPages documents
 */
function defaultPages() {
  return [
    {
      id: 'home',
      label: 'Home page',
      path: '/',
      icon: null,
      order: 0,
      visible: true,
      systemPage: true,
      sections: [
        // No registration action seeds here any more (M7 issue 8). The
        // event's own registration action is configuration, not content:
        // `config/event.registration` holds the destination and the label,
        // the home lead and the header both draw it from there, and an
        // unset destination draws nothing. A seeded cta block could not do
        // that — it had to invent a URL to be a valid block at all, and the
        // one it invented pointed at example.org, which is the dead button
        // the issue exists to remove. `cta` stays in the allowed list, so an
        // editor can still add an action of their own beside it.
        section('hero', 'Hero', 'The opening headline, one supporting line, and the primary action.',
          ['text', 'cta', 'image'], 4, [
            block('title', 'text', 'Event name headline.'),
            block('subtitle', 'text', 'One warm supporting sentence.'),
          ]),
        // The essentials, as a group of cards (M7 issue 9). A stat block
        // opens a card and the list items after it are that card's own
        // lines, so the dates can carry the facts that belong beside them
        // without a second section.
        //
        // Seeded as placeholders, not from config/event, on purpose. The
        // dates already render from configuration in the home page's own
        // Dates list, and a second copy of them here would be two answers
        // to one question that drift apart the moment an operator edits
        // either. What belongs in these cards is the event's own summary of
        // itself, which only the operator can write.
        //
        // ONE STAT AND THREE LINES, NOT THREE STATS. A stat carries the
        // six-part contract (design brief §2.1.1), so every seeded stat is
        // six [Replace] instructions an operator has to answer before the
        // block says anything — and three of them put fifteen of those
        // lines under the hero of a site nobody has edited yet. One figure
        // with its lines under it is a card an operator can finish in a
        // sitting, and the section takes twelve blocks, so a second fact
        // is one more stat away.
        //
        // Which facts: the dates are a figure and belong in the stat; where
        // the event happens is a name, an address and a way to get there,
        // which are lines. A venue is not a number, and dressing one as a
        // stat would mean inventing a count and a source line to cite it
        // to. Issue #234 tracks a block for a non-numeric fact.
        section('info', 'Key facts', 'The event’s own short answers. A stat opens a card; the list items after it are that card’s lines.',
          ['stat', 'list_item'], 12, [
            block('when', 'stat', 'When the event runs.'),
            block('where_venue', 'list_item', 'The venue’s name, labelled.'),
            block('where_address', 'list_item', 'The venue’s street address, labelled.'),
            block('where_transit', 'list_item', 'The nearest transit to the venue, labelled.'),
          ]),
        section('details', 'Details', 'Body copy describing what happens at the event.',
          ['richtext', 'image'], 6, [
            block('intro', 'richtext', 'What happens across the days.'),
          ]),
        section('highlights', 'Highlights', 'A short list of what attendees can expect.',
          ['list_item', 'richtext'], 12, [
            block('first', 'list_item', 'One thing attendees can expect.'),
          ]),
        section('stats', 'By the numbers', 'Headline figures with captions.',
          ['stat'], 6, [
            block('attendees', 'stat', 'Expected attendance.'),
            block('sessions', 'stat', 'Sessions planned.'),
          ]),
        section('history', 'History', 'Background on previous editions of the event.',
          ['richtext', 'image'], 6),
        // The sponsor strip (M7 issue 10). The section holds one optional
        // line of copy; the organizations themselves come from the
        // Organizations list, which is where an operator already manages
        // them. Deleting this section is how a client turns the strip off
        // without turning the sponsors feature off everywhere.
        section('sponsors', 'Sponsors', 'One line above the logo wall. The organizations come from the Organizations list, not from here.',
          ['text'], 1, [
            block('lede', 'text', 'One line thanking the organizations that support the event.'),
          ]),
        section('footer', 'Footer links', 'Grouped links rendered in the page footer.',
          ['link_group'], 12, [
            block('contact_link', 'link_group', 'How to reach the organizers.'),
          ]),
      ],
    },
    {
      id: 'schedule',
      label: 'Schedule',
      path: '/schedule',
      icon: null,
      order: 1,
      visible: true,
      systemPage: true,
      sections: [],
    },
    {
      id: 'speakers',
      label: 'Speakers',
      path: '/speakers',
      icon: null,
      order: 2,
      visible: true,
      systemPage: true,
      sections: [],
    },
    {
      id: 'sponsors',
      label: 'Sponsors',
      path: '/sponsors',
      icon: null,
      order: 3,
      visible: true,
      systemPage: true,
      sections: [],
    },
    {
      id: 'travel',
      label: 'Travel and venue',
      path: '/travel',
      icon: null,
      order: 4,
      visible: true,
      systemPage: false,
      sections: [
        section('travel_header', 'Page header', 'Title and one supporting line.',
          ['text'], 2, [
            block('page_title', 'text', 'Page headline.'),
            block('page_subtitle', 'text', 'One line about getting to the event.'),
          ]),
        section('travel_venue', 'Venue', 'Where the event happens. Seeded from the event configuration.',
          ['text', 'richtext', 'cta'], 6, [
            block('venue_name', 'text', 'Venue name.'),
            block('venue_address', 'text', 'Street address of the venue.'),
            block('venue_notes', 'richtext', 'Entrances, accessibility, and arrival notes.'),
          ]),
        // The uploaded venue map. This section holds NO seeded block: the
        // map is `config/event.venue.map`, set in admin Event settings from
        // the media library, and the page renders it wherever it states a
        // section with this id. Until somebody uploads one the section is
        // empty and renders nothing, exactly like the lists below — and any
        // richtext an operator adds here sits above it as arrival notes.
        section(VENUE_MAP_SECTION_ID, 'Venue map', 'The uploaded map of the building and the rooms on it. Upload the map in Event settings.',
          ['richtext'], 4),
        // Variable-length lists (§5.3): seeded with no items, so a client
        // with one hotel and five transit options is a CMS edit, and a
        // half-filled travel page renders sparse rather than wrong.
        section('travel_lodging', 'Lodging', 'One entry per hotel or block booking. Empty until a client adds one.',
          ['link_group', 'richtext'], 20),
        section('travel_transit', 'Getting here', 'One entry per travel option. Empty until a client adds one.',
          ['list_item', 'link_group', 'richtext'], 20),
        section('travel_shuttle', 'Shuttle', 'Pickup times, if the event runs a shuttle. Empty means no shuttle.',
          ['list_item', 'richtext'], 20),
        section('travel_local', 'Around the venue', 'Local links a client chooses to recommend.',
          ['link_group', 'richtext'], 20),
        section('travel_help', 'Travel help', 'Who to ask about travel.',
          ['text', 'richtext'], 4, [
            block('help_title', 'text', 'Heading for the travel help block.'),
            block('help_description', 'richtext', 'How to reach someone about travel questions.'),
          ]),
      ],
    },
    {
      id: 'faq',
      label: 'Frequently asked questions',
      path: '/faq',
      icon: null,
      order: 5,
      visible: true,
      systemPage: false,
      sections: [
        section('faq_intro', 'Introduction', 'One paragraph before the questions.',
          ['richtext'], 2, [
            block('summary', 'richtext', 'What this page answers.'),
          ]),
        section('faq_items', 'Questions and answers', 'One entry per common question.',
          ['faq_item', 'richtext'], 40, [
            block('what_is_this', 'faq_item', 'What the event is.'),
          ]),
      ],
    },
    {
      id: 'conduct',
      label: 'Code of conduct',
      path: '/conduct',
      icon: null,
      order: 6,
      visible: true,
      systemPage: false,
      sections: [
        section('conduct_intro', 'Introduction', 'Why the event has a code of conduct.',
          ['richtext'], 2, [
            block('summary', 'richtext', 'Who the code applies to.'),
          ]),
        section('conduct_expectations', 'What we expect', 'One entry per expectation.',
          ['list_item', 'richtext'], 20, [
            block('first', 'list_item', 'One expectation of attendees.'),
          ]),
        section('conduct_reporting', 'Reporting', 'How someone reports a problem.',
          ['richtext', 'link_group'], 6, [
            block('how_to_report', 'richtext', 'How to report a concern and who reads it.'),
          ]),
      ],
    },
    {
      id: 'contact',
      label: 'Contact',
      path: '/contact',
      icon: null,
      order: 7,
      visible: true,
      systemPage: false,
      sections: [
        section('contact_intro', 'Introduction', 'One line about how to reach the organizers.',
          ['richtext'], 2, [
            block('summary', 'richtext', 'How to reach the organizers.'),
          ]),
        section('contact_channels', 'Ways to reach us', 'One entry per contact route.',
          ['link_group', 'list_item'], 12, [
            block('support', 'link_group', 'General support address.'),
          ]),
      ],
    },
    {
      id: 'privacy',
      label: 'Privacy policy',
      path: '/privacy',
      icon: null,
      order: 8,
      visible: true,
      systemPage: false,
      sections: [
        section('privacy_intro', 'Introduction', 'Who operates the site and what this covers.', ['richtext'], 4),
        section('privacy_data', 'What we collect', 'Categories of personal information.', ['richtext'], 10),
        section('privacy_sharing', 'Who we share it with', 'Processors and third parties.', ['richtext'], 10),
        section('privacy_retention', 'How long we keep it', 'Retention periods.', ['richtext'], 6),
        section('privacy_rights', 'Your choices', 'Access, correction, and deletion.', ['richtext'], 6),
        section('privacy_contact', 'Contact', 'Where privacy questions go.', ['richtext'], 4),
      ],
    },
    {
      id: 'terms',
      label: 'Terms of service',
      path: '/terms',
      icon: null,
      order: 9,
      visible: true,
      systemPage: false,
      sections: [
        section('terms_intro', 'Introduction', 'Who operates the site and what these terms cover.', ['richtext'], 4),
        section('terms_accounts', 'Accounts', 'Sign-in and account responsibilities.', ['richtext'], 6),
        section('terms_registration', 'Registration', 'Tickets, payment, refunds.', ['richtext'], 6),
        section('terms_conduct', 'Conduct', 'The code of conduct and enforcement.', ['richtext'], 6),
        section('terms_liability', 'Disclaimers', 'Warranty, liability, governing law.', ['richtext'], 6),
        section('terms_contact', 'Contact', 'Where questions about the terms go.', ['richtext'], 4),
      ],
    },
    {
      id: 'attendees',
      label: 'Attendees',
      path: '/attendees',
      icon: null,
      order: 10,
      visible: true,
      systemPage: true,
      sections: [],
    },
    {
      id: 'updates',
      label: 'Updates',
      path: '/updates',
      icon: null,
      order: 11,
      visible: true,
      systemPage: true,
      sections: [],
    },
    // Issue "Seed a recap page and a guidelines page": two more generic
    // content pages, appended after updates for the same reason attendees
    // and updates sit at the end (see the comment above `defaultPages`).
    // Both seed EVERY section with zero default blocks, the same pattern
    // the travel page's variable-length lists use: a section's description
    // is the only placeholder text there is, an operator's own writing is
    // what fills it, and a page that carries nothing yet renders the site's
    // empty state rather than a guess at what either page should say.
    {
      id: 'recap',
      label: 'Event recap',
      path: '/recap',
      icon: null,
      order: 12,
      visible: true,
      systemPage: false,
      sections: [
        section('recap_summary', 'Summary', 'A short look back at how the event went.',
          ['richtext'], 4),
        section('recap_stats', 'By the numbers', 'Headline figures from the event.',
          ['stat'], 6),
        section('recap_highlights', 'Highlights', 'One entry per takeaway or theme from the event.',
          ['list_item', 'richtext'], 20),
        section('recap_media', 'Photos and recordings', 'Links to photos, recordings, or other event media.',
          ['link_group', 'richtext'], 20),
        section('recap_next', 'More from the event', 'Links to the schedule, speakers, or a program download.',
          ['link_group'], 10),
        section('recap_survey', 'Feedback', 'A link to a post-event survey, if there is one.',
          ['cta', 'link_group'], 4),
      ],
    },
    {
      id: 'guidelines',
      label: 'Speaker guidelines',
      path: '/guidelines',
      icon: null,
      order: 13,
      visible: true,
      systemPage: false,
      sections: [
        section('guidelines_intro', 'Introduction', 'One paragraph welcoming speakers to this page.',
          ['richtext'], 2),
        section('guidelines_formats', 'Session formats', 'One entry per session format speakers may be assigned, with its length and shape.',
          ['list_item', 'richtext'], 20),
        section('guidelines_deadlines', 'Deadlines', 'Key dates a speaker needs to know, such as when materials are due.',
          ['list_item', 'richtext'], 20),
        section('guidelines_av', 'On-site setup', 'What is provided in the room and what a speaker should bring.',
          ['richtext', 'list_item'], 20),
        section('guidelines_sharing', 'Sharing your materials', 'How slides, recordings, and photos are handled after the event.',
          ['richtext'], 10),
        section('guidelines_help', 'Questions', 'Who a speaker can contact with questions before the event.',
          ['richtext', 'link_group'], 6),
      ],
    },
    // Issue "Seed a city guide page": a third generic content page appended
    // after guidelines for the same reason recap and guidelines sit after
    // updates (see the comment above `defaultPages`). Every section seeds
    // with zero default blocks, the travel page's variable-length-list
    // pattern: a section's description is the only placeholder text there
    // is, and no copy about any city appears here or anywhere else in this
    // seed — an operator's own writing is what fills it in.
    //
    // Directions to and around the venue itself already live on the travel
    // page ("Around the venue" and "Getting here" — travel_local and
    // travel_transit above); this page is the wider city, not the venue.
    {
      id: 'city_guide',
      label: 'City guide',
      path: '/city-guide',
      icon: null,
      order: 14,
      visible: true,
      systemPage: false,
      sections: [
        // Every generic page's first section renders its heading offscreen
        // (ContentPage.jsx treats it as repeating the page title), so a page
        // whose real first section is actual content — Places to eat here —
        // needs a leading intro section the way faq, conduct, and contact
        // already have one, or that first content section loses both its
        // visible heading and its entry in the section index.
        section('city_guide_intro', 'Introduction', 'One paragraph before the city guide.',
          ['richtext'], 2),
        section('city_guide_eat', 'Places to eat', 'One entry per restaurant, cafe, or other place to eat near the venue.',
          ['list_item', 'richtext'], 20),
        section('city_guide_see', 'Things to see', 'One entry per sight, attraction, or activity near the venue.',
          ['list_item', 'richtext'], 20),
        section('city_guide_around', 'Getting around', 'One entry per transit option, parking note, or way to move between places.',
          ['list_item', 'richtext'], 20),
      ],
    },
  ];
}

/** Page ids seeded from the §5.5 legal templates rather than placeholders. */
const LEGAL_PAGE_IDS = Object.freeze(['privacy', 'terms']);

/** Full street address from `config/event.venue`, blank parts dropped. */
function venueAddress(venue = {}) {
  const line = [venue.addressLine1, venue.addressLine2].filter(Boolean).join(', ');
  const town = [venue.city, venue.region].filter(Boolean).join(', ');
  const tail = [town, venue.postalCode, venue.country].filter(Boolean).join(' ');
  return [line, tail].filter(Boolean).join(', ');
}

/**
 * Per-field seed values that come from configuration rather than
 * placeholder copy (§5.4: "dates and venue render from config/event, so
 * they are correct as soon as init runs"). Keyed `<section>.<field>`;
 * anything absent here falls through to `placeholderBlock`.
 */
/**
 * The four parts of the stat contract (design brief §2.1.1) as seeded
 * placeholder copy. Each one names what the operator has to supply, in the
 * same `[Replace] ` form every other placeholder uses (§5.4).
 *
 * @param {string} subject what this particular number is about
 * @returns {{ takeaway: string, description: string, source: string, alt: string }}
 */
function statContract(subject) {
  return {
    takeaway: `[Replace] State what ${subject} shows, in words.`,
    description: `[Replace] Say what this number counts, and over what period.`,
    source: '[Replace] Name where the number came from, and the date you read it.',
    alt: '[Replace] Describe the finding for a screen reader.',
  };
}

const CONFIG_SEEDS = Object.freeze({
  'hero.title': ({ event }) => ({ value: event.name }),
  // A stat carries the four-part contract from PR3 on (design brief
  // §2.1.1), and a seeded stat is no exception: the figure and its caption
  // are correct as seeded, and the four parts arrive as the instruction for
  // what to write, because nobody but the operator knows what this number
  // will count or where it came from.
  'stats.attendees': () => ({ value: '0', label: 'attendees expected', ...statContract('attendance') }),
  'stats.sessions': () => ({ value: '0', label: 'sessions planned', ...statContract('the session count') }),
  'travel_venue.venue_name': ({ event }) => ({
    value: event.venue?.name || '[Replace] Venue name.',
  }),
  'travel_venue.venue_address': ({ event }) => ({
    value: venueAddress(event.venue) || '[Replace] Street address of the venue.',
  }),
  'footer.contact_link': ({ event }) => ({
    group: 'About',
    label: 'Contact the organizers',
    url: `mailto:${event.legal?.supportEmail || 'support@example.org'}`,
  }),
  'contact_channels.support': ({ event }) => ({
    group: 'Email',
    label: 'Email the organizers',
    url: `mailto:${event.legal?.supportEmail || 'support@example.org'}`,
  }),
  'conduct_reporting.how_to_report': ({ event }) => ({
    value:
      `<p>[Replace] Describe how a concern is reported and who reads it. Reports go to ` +
      `${event.legal?.conductEmail || event.legal?.supportEmail || '[Replace] conduct address'}.</p>`,
  }),
});

/**
 * Placeholder fields for one block type (§5.4). The description of what
 * belongs in the block IS the placeholder copy — an operator reading the
 * live page sees the instruction, not another event's sentence.
 *
 * @param {string} blockType
 * @param {string} description
 * @returns {object} the block's type-specific fields
 */
function placeholderBlock(blockType, description) {
  const text = `[Replace] ${description}`;
  switch (blockType) {
    case 'text':
      return { value: text };
    case 'richtext':
      return { value: `<p>${text}</p>` };
    case 'image':
      return { url: 'branding/og-default.svg', alt: text, caption: '' };
    case 'cta':
      return { label: '[Replace] Button label', url: 'https://example.org', external: true };
    case 'stat':
      return { value: '0', label: text, ...statContract('this number') };
    case 'list_item':
      return { text };
    case 'faq_item':
      return { question: text, answer: `<p>[Replace] Answer this question in a sentence or two.</p>` };
    case 'link_group':
      return { group: 'Links', label: text, url: 'https://example.org' };
    default:
      // Unreachable while defaultBlocks pass validatePageDoc, which
      // rejects unknown block types by name before a seed is built.
      throw new Error(`No placeholder for block type "${blockType}"`);
  }
}

/**
 * The two legal pages' content docs, composed from the CURRENT effective
 * config (§5.5).
 *
 * Split out of `buildSeedContent` because the legal copy is derived from
 * configuration that changes AFTER init: the privacy and terms text says
 * whether Google sign-in exists, and that only becomes true when the
 * operator attests the manual Auth steps. Anything that changes those
 * inputs can therefore rebuild these blocks from this one function and
 * refresh whichever of them a client has not yet edited.
 *
 * @param {{ docs: { event: object, providers: object, features?: object },
 *           seededAt?: string, pageIds?: string[] }} args
 * @returns {Array<object>} content docs, each with an `id`
 */
function buildLegalContentDocs({ docs, seededAt = new Date(0).toISOString(), pageIds = LEGAL_PAGE_IDS }) {
  const legal = buildLegalContent({
    event: docs.event,
    providers: docs.providers,
    features: docs.features,
  });
  const out = [];
  for (const pageId of pageIds) {
    const perSection = new Map();
    for (const item of legal[pageId]) {
      const order = perSection.get(item.section) ?? 0;
      perSection.set(item.section, order + 1);
      out.push({
        id: `${item.section}__${item.field}`,
        section: item.section,
        field: item.field,
        blockType: item.blockType,
        value: item.value,
        visible: true,
        order,
        seeded: true,
        seededAt,
      });
    }
  }
  return out;
}

/**
 * Every seeded cmsContent document for a page set (§5.1 step e, §5.4).
 *
 * Docs are keyed `<section>__<field>` — the same key the web snapshot and
 * `getBlock(section, field)` use — and carry `seeded: true` plus
 * `seededAt`, which is what makes "how much of this site is still sample
 * content" an answerable question (the launch-readiness seeded-content row
 * counts exactly these).
 *
 * `pages` is the set actually being seeded, not necessarily every default
 * page: content is keyed by section id alone, so a page the caller has
 * decided not to write (init-event's path- and section-collision
 * preflights drop one whose ids another page already owns) must not be
 * passed here either, or its blocks land under the other page's sections.
 *
 * @param {{ pages: object[], docs: { event: object, providers: object, features?: object },
 *           tierA?: object, seededAt?: string }} args
 * @returns {Array<object>} content docs, each with an `id`
 */
function buildSeedContent({ pages, docs, tierA = {}, seededAt = new Date(0).toISOString() }) {
  const ctx = { event: docs.event, providers: docs.providers, features: docs.features, tierA };
  const out = [];
  const push = (sectionId, field, blockType, fields, order) => {
    out.push({
      id: `${sectionId}__${field}`,
      section: sectionId,
      field,
      blockType,
      ...fields,
      visible: true,
      order,
      seeded: true,
      seededAt,
    });
  };

  // §5.5: the legal pages are composed from the provider-aware templates,
  // not from generic placeholders — a `manual`-ticketing deployment's
  // privacy policy must not carry a "[Replace] name your ticketing vendor"
  // block it should never fill in.
  const legalPageIds = pages.map((page) => page.id).filter((id) => LEGAL_PAGE_IDS.includes(id));
  out.push(...buildLegalContentDocs({ docs, seededAt, pageIds: legalPageIds }));

  for (const page of pages) {
    if (LEGAL_PAGE_IDS.includes(page.id)) continue;
    for (const sec of page.sections) {
      sec.defaultBlocks.forEach((def, order) => {
        const seed = CONFIG_SEEDS[`${sec.id}.${def.field}`];
        const fields = seed ? seed(ctx) : placeholderBlock(def.blockType, def.description);
        push(sec.id, def.field, def.blockType, fields, order);
      });
    }
  }
  return out;
}

/**
 * The two `email_templates/{id}` overrides seeded at init (spec §5.1 step f,
 * §6.3): "the two client-visible templates whose copy is event-specific" —
 * `ticket.get_ticket` and `ticket.claim_prompt` are the only templates that
 * seed a Firestore override at all; every other shipped default (§6.3's
 * phase 2/3 list) runs straight from code, no override doc, no seed step.
 *
 * The seeded override is a COPY of the shipped default (functions/src/
 * email/templates/ticket.*.cjs), not new client-specific prose — there is
 * no admin editing surface for `email_templates` yet, so a starting point
 * identical to what already renders is the correct seed: it is guaranteed
 * to pass `validateTemplateBody` against itself (same source), and it gives
 * a future editor something live to start customizing rather than a
 * doc that silently diverges from what the mail actually says today.
 *
 * @param {{ seededAt?: string, ids?: string[] }} [args]
 * @returns {Array<{ id: string, subject: string, html: string, text: string,
 *                   seeded: true, seededAt: string }>}
 */
const EMAIL_TEMPLATE_OVERRIDE_IDS = Object.freeze(['ticket.get_ticket', 'ticket.claim_prompt']);

function buildEmailTemplateSeeds({ seededAt = new Date(0).toISOString(), ids = EMAIL_TEMPLATE_OVERRIDE_IDS } = {}) {
  return ids.map((id) => {
    const template = getDefaultTemplate(id);
    if (!template) {
      // A code bug (a seeded id with no shipped default), not a data state.
      throw new Error(`buildEmailTemplateSeeds: no shipped template default for "${id}"`);
    }
    return {
      id,
      subject: template.subject,
      html: template.html,
      text: template.text,
      seeded: true,
      seededAt,
    };
  });
}

/**
 * cmsContent documents an EARLIER release seeded and this one no longer
 * emits (Codex review of the configured registration action: P1).
 *
 * Dropping a block from `defaultPages()` only stops new sites from getting
 * it. `seedCollection` writes and refreshes; it never deletes, and it
 * decides purely by the ids it was handed, so a document nothing seeds any
 * more is a document nothing ever looks at again. On every site that ran
 * init before the change it stays live, stays published, and keeps drawing
 * the control the release removed — for `hero__register_cta` that is the
 * dead Register button, usually still pointed at the example.org
 * destination the old seed invented when a client had no link of their own.
 *
 * init removes these on a re-run (`removeObsoleteSeeds`, scripts/lib/write.cjs)
 * under the same ownership rule every seed write follows: only while the
 * document is still seed-owned in both revisions. An editor's own cta at
 * this id, or a seeded one they have since edited, is theirs and stays.
 *
 * Entries are permanent once added. A site can be upgraded from any older
 * release, so the list is what this release must clean up, not what the
 * last one did.
 */
const OBSOLETE_CONTENT_IDS = Object.freeze([
  // M7 issue 8: the hero's seeded registration action. The destination is
  // configuration now (`config/event.registration`), read by the page and
  // by the ticket provider's email alike, and an unset one draws nothing.
  'hero__register_cta',
]);

module.exports = {
  defaultPages,
  buildSeedContent,
  buildLegalContentDocs,
  buildEmailTemplateSeeds,
  placeholderBlock,
  LEGAL_PAGE_IDS,
  OBSOLETE_CONTENT_IDS,
  EMAIL_TEMPLATE_OVERRIDE_IDS,
  internals: { venueAddress, CONFIG_SEEDS },
};
