// GENERATED FILE — committed synthetic demo copy (spec §2.4, §5.4, §8.6).
//
// Shape mirrors published cmsContent docs: keyed `<section>__<field>`, each
// doc carrying { section, field, blockType, ...block fields, visible, order,
// seeded }. blockType values come from the code-side BLOCK_TYPES registry
// (functions/src/cms/blockTypes.cjs): text, richtext, image, cta, stat,
// list_item, faq_item, link_group.
//
// Copy strategy (spec §5.4): realistic-shaped synthetic text, `[Replace]`
// prefixes on anything an operator must rewrite, never a real org's copy.

export const siteContent = {
  hero__title: {
    section: 'hero',
    field: 'title',
    blockType: 'text',
    value: '[Demo] Harborlight Media Summit',
    visible: true,
    order: 0,
    seeded: true,
  },
  hero__subtitle: {
    section: 'hero',
    field: 'subtitle',
    blockType: 'text',
    value: '[Replace] One warm sentence about who this event is for and why it matters.',
    visible: true,
    order: 1,
    seeded: true,
  },
  hero__register_cta: {
    section: 'hero',
    field: 'register_cta',
    blockType: 'cta',
    label: 'Register for the summit',
    url: 'https://example.org/register',
    external: true,
    visible: true,
    order: 2,
    seeded: true,
  },
  details__intro: {
    section: 'details',
    field: 'intro',
    blockType: 'richtext',
    value: '<p>[Replace] A short paragraph describing what happens across the two days: sessions, workshops, and time to meet collaborators.</p>',
    visible: true,
    order: 0,
    seeded: true,
  },
  stats__attendees: {
    section: 'stats',
    field: 'attendees',
    blockType: 'stat',
    value: '0',
    label: 'Attendees expected',
    visible: true,
    order: 0,
    seeded: true,
  },
  stats__sessions: {
    section: 'stats',
    field: 'sessions',
    blockType: 'stat',
    value: '0',
    label: 'Sessions planned',
    visible: true,
    order: 1,
    seeded: true,
  },
  faq__what_is_this: {
    section: 'faq',
    field: 'what_is_this',
    blockType: 'faq_item',
    question: '[Replace] What is this event?',
    answer: '<p>[Replace] Answer describing the event in one or two sentences.</p>',
    visible: true,
    order: 0,
    seeded: true,
  },
  footer__contact_link: {
    section: 'footer',
    field: 'contact_link',
    blockType: 'link_group',
    group: 'About',
    label: 'Contact the organizers',
    url: 'mailto:support@example.org',
    visible: true,
    order: 0,
    seeded: true,
  },
};

export default siteContent;
