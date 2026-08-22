'use strict';

/**
 * The ten default pages and their placeholder content (spec §5.3, §5.4).
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
 * The ten seeded pages (§5.3): home, schedule, speakers, sponsors (system
 * pages, each owning a dedicated React route), then travel, faq, conduct,
 * contact, privacy, terms as generic content pages at their own root-level
 * paths.
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
        section('hero', 'Hero', 'The opening headline, one supporting line, and the primary action.',
          ['text', 'cta', 'image'], 4, [
            block('title', 'text', 'Event name headline.'),
            block('subtitle', 'text', 'One warm supporting sentence.'),
            block('register_cta', 'cta', 'Primary registration action.'),
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
const CONFIG_SEEDS = Object.freeze({
  'hero.title': ({ event }) => ({ value: event.name }),
  'hero.register_cta': ({ event, tierA }) => ({
    label: 'Register',
    url: event.registration?.externalUrl || tierA?.publicUrl || 'https://example.org',
    external: true,
  }),
  'stats.attendees': () => ({ value: '0', label: 'Attendees expected' }),
  'stats.sessions': () => ({ value: '0', label: 'Sessions planned' }),
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
      return { value: '0', label: text };
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

module.exports = {
  defaultPages,
  buildSeedContent,
  buildLegalContentDocs,
  buildEmailTemplateSeeds,
  placeholderBlock,
  LEGAL_PAGE_IDS,
  EMAIL_TEMPLATE_OVERRIDE_IDS,
  internals: { venueAddress, CONFIG_SEEDS },
};
