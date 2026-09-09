// GENERATED FILE — committed synthetic demo copy (spec §2.4, §5.2–5.4, §8.6).
//
// Regenerate with:  node scripts/generate-content.cjs --demo
//
// Shape mirrors published cmsPages docs. systemPage: true marks pages with a
// dedicated React route (home, schedule, speakers, sponsors, attendees,
// updates); non-system pages render at their own root-level `path` (e.g.
// /faq) through the generic catch-all route (issue #52). A system page may
// carry no sections at all — the route IS the page, and the sections are
// what an operator adds around it. Section ids are generic vocabulary
// (spec §5.3) and tie to cmsContent docs via each block `section` field;
// ids are unique across pages because cmsContent is keyed
// `<section>__<field>` globally, not per page.

export const pagesData = [
  {
    id: 'home',
    label: 'Home page',
    path: '/',
    icon: null,
    order: 0,
    visible: true,
    systemPage: true,
    sections: [
      {
        id: 'hero',
        label: 'Hero',
        description: 'The opening headline, one supporting line, and the primary action.',
        allowedBlocks: [
          'text',
          'cta',
          'image',
        ],
        maxBlocks: 4,
        reorderable: true,
        defaultBlocks: [
          {
            field: 'title',
            blockType: 'text',
            description: 'Event name headline.',
          },
          {
            field: 'subtitle',
            blockType: 'text',
            description: 'One warm supporting sentence.',
          },
          {
            field: 'register_cta',
            blockType: 'cta',
            description: 'Primary registration action.',
          },
        ],
      },
      {
        id: 'details',
        label: 'Details',
        description: 'Body copy describing what happens at the event.',
        allowedBlocks: [
          'richtext',
          'image',
        ],
        maxBlocks: 6,
        reorderable: true,
        defaultBlocks: [
          {
            field: 'intro',
            blockType: 'richtext',
            description: 'What happens across the days.',
          },
        ],
      },
      {
        id: 'highlights',
        label: 'Highlights',
        description: 'A short list of what attendees can expect.',
        allowedBlocks: [
          'list_item',
          'richtext',
        ],
        maxBlocks: 12,
        reorderable: true,
        defaultBlocks: [
          {
            field: 'first',
            blockType: 'list_item',
            description: 'One thing attendees can expect.',
          },
        ],
      },
      {
        id: 'stats',
        label: 'By the numbers',
        description: 'Headline figures with captions.',
        allowedBlocks: [
          'stat',
        ],
        maxBlocks: 6,
        reorderable: true,
        defaultBlocks: [
          {
            field: 'attendees',
            blockType: 'stat',
            description: 'Expected attendance.',
          },
          {
            field: 'sessions',
            blockType: 'stat',
            description: 'Sessions planned.',
          },
        ],
      },
      {
        id: 'history',
        label: 'History',
        description: 'Background on previous editions of the event.',
        allowedBlocks: [
          'richtext',
          'image',
        ],
        maxBlocks: 6,
        reorderable: true,
        defaultBlocks: [],
      },
      {
        id: 'footer',
        label: 'Footer links',
        description: 'Grouped links rendered in the page footer.',
        allowedBlocks: [
          'link_group',
        ],
        maxBlocks: 12,
        reorderable: true,
        defaultBlocks: [
          {
            field: 'contact_link',
            blockType: 'link_group',
            description: 'How to reach the organizers.',
          },
        ],
      },
    ],
    seeded: true,
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
    seeded: true,
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
    seeded: true,
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
    seeded: true,
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
      {
        id: 'travel_header',
        label: 'Page header',
        description: 'Title and one supporting line.',
        allowedBlocks: [
          'text',
        ],
        maxBlocks: 2,
        reorderable: true,
        defaultBlocks: [
          {
            field: 'page_title',
            blockType: 'text',
            description: 'Page headline.',
          },
          {
            field: 'page_subtitle',
            blockType: 'text',
            description: 'One line about getting to the event.',
          },
        ],
      },
      {
        id: 'travel_venue',
        label: 'Venue',
        description: 'Where the event happens. Seeded from the event configuration.',
        allowedBlocks: [
          'text',
          'richtext',
          'cta',
        ],
        maxBlocks: 6,
        reorderable: true,
        defaultBlocks: [
          {
            field: 'venue_name',
            blockType: 'text',
            description: 'Venue name.',
          },
          {
            field: 'venue_address',
            blockType: 'text',
            description: 'Street address of the venue.',
          },
          {
            field: 'venue_notes',
            blockType: 'richtext',
            description: 'Entrances, accessibility, and arrival notes.',
          },
        ],
      },
      {
        id: 'travel_map',
        label: 'Venue map',
        description: 'The uploaded map of the building and the rooms on it. Upload the map in Event settings.',
        allowedBlocks: [
          'richtext',
        ],
        maxBlocks: 4,
        reorderable: true,
        defaultBlocks: [],
      },
      {
        id: 'travel_lodging',
        label: 'Lodging',
        description: 'One entry per hotel or block booking. Empty until a client adds one.',
        allowedBlocks: [
          'link_group',
          'richtext',
        ],
        maxBlocks: 20,
        reorderable: true,
        defaultBlocks: [],
      },
      {
        id: 'travel_transit',
        label: 'Getting here',
        description: 'One entry per travel option. Empty until a client adds one.',
        allowedBlocks: [
          'list_item',
          'link_group',
          'richtext',
        ],
        maxBlocks: 20,
        reorderable: true,
        defaultBlocks: [],
      },
      {
        id: 'travel_shuttle',
        label: 'Shuttle',
        description: 'Pickup times, if the event runs a shuttle. Empty means no shuttle.',
        allowedBlocks: [
          'list_item',
          'richtext',
        ],
        maxBlocks: 20,
        reorderable: true,
        defaultBlocks: [],
      },
      {
        id: 'travel_local',
        label: 'Around the venue',
        description: 'Local links a client chooses to recommend.',
        allowedBlocks: [
          'link_group',
          'richtext',
        ],
        maxBlocks: 20,
        reorderable: true,
        defaultBlocks: [],
      },
      {
        id: 'travel_help',
        label: 'Travel help',
        description: 'Who to ask about travel.',
        allowedBlocks: [
          'text',
          'richtext',
        ],
        maxBlocks: 4,
        reorderable: true,
        defaultBlocks: [
          {
            field: 'help_title',
            blockType: 'text',
            description: 'Heading for the travel help block.',
          },
          {
            field: 'help_description',
            blockType: 'richtext',
            description: 'How to reach someone about travel questions.',
          },
        ],
      },
    ],
    seeded: true,
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
      {
        id: 'faq_intro',
        label: 'Introduction',
        description: 'One paragraph before the questions.',
        allowedBlocks: [
          'richtext',
        ],
        maxBlocks: 2,
        reorderable: true,
        defaultBlocks: [
          {
            field: 'summary',
            blockType: 'richtext',
            description: 'What this page answers.',
          },
        ],
      },
      {
        id: 'faq_items',
        label: 'Questions and answers',
        description: 'One entry per common question.',
        allowedBlocks: [
          'faq_item',
          'richtext',
        ],
        maxBlocks: 40,
        reorderable: true,
        defaultBlocks: [
          {
            field: 'what_is_this',
            blockType: 'faq_item',
            description: 'What the event is.',
          },
        ],
      },
    ],
    seeded: true,
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
      {
        id: 'conduct_intro',
        label: 'Introduction',
        description: 'Why the event has a code of conduct.',
        allowedBlocks: [
          'richtext',
        ],
        maxBlocks: 2,
        reorderable: true,
        defaultBlocks: [
          {
            field: 'summary',
            blockType: 'richtext',
            description: 'Who the code applies to.',
          },
        ],
      },
      {
        id: 'conduct_expectations',
        label: 'What we expect',
        description: 'One entry per expectation.',
        allowedBlocks: [
          'list_item',
          'richtext',
        ],
        maxBlocks: 20,
        reorderable: true,
        defaultBlocks: [
          {
            field: 'first',
            blockType: 'list_item',
            description: 'One expectation of attendees.',
          },
        ],
      },
      {
        id: 'conduct_reporting',
        label: 'Reporting',
        description: 'How someone reports a problem.',
        allowedBlocks: [
          'richtext',
          'link_group',
        ],
        maxBlocks: 6,
        reorderable: true,
        defaultBlocks: [
          {
            field: 'how_to_report',
            blockType: 'richtext',
            description: 'How to report a concern and who reads it.',
          },
        ],
      },
    ],
    seeded: true,
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
      {
        id: 'contact_intro',
        label: 'Introduction',
        description: 'One line about how to reach the organizers.',
        allowedBlocks: [
          'richtext',
        ],
        maxBlocks: 2,
        reorderable: true,
        defaultBlocks: [
          {
            field: 'summary',
            blockType: 'richtext',
            description: 'How to reach the organizers.',
          },
        ],
      },
      {
        id: 'contact_channels',
        label: 'Ways to reach us',
        description: 'One entry per contact route.',
        allowedBlocks: [
          'link_group',
          'list_item',
        ],
        maxBlocks: 12,
        reorderable: true,
        defaultBlocks: [
          {
            field: 'support',
            blockType: 'link_group',
            description: 'General support address.',
          },
        ],
      },
    ],
    seeded: true,
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
      {
        id: 'privacy_intro',
        label: 'Introduction',
        description: 'Who operates the site and what this covers.',
        allowedBlocks: [
          'richtext',
        ],
        maxBlocks: 4,
        reorderable: true,
        defaultBlocks: [],
      },
      {
        id: 'privacy_data',
        label: 'What we collect',
        description: 'Categories of personal information.',
        allowedBlocks: [
          'richtext',
        ],
        maxBlocks: 10,
        reorderable: true,
        defaultBlocks: [],
      },
      {
        id: 'privacy_sharing',
        label: 'Who we share it with',
        description: 'Processors and third parties.',
        allowedBlocks: [
          'richtext',
        ],
        maxBlocks: 10,
        reorderable: true,
        defaultBlocks: [],
      },
      {
        id: 'privacy_retention',
        label: 'How long we keep it',
        description: 'Retention periods.',
        allowedBlocks: [
          'richtext',
        ],
        maxBlocks: 6,
        reorderable: true,
        defaultBlocks: [],
      },
      {
        id: 'privacy_rights',
        label: 'Your choices',
        description: 'Access, correction, and deletion.',
        allowedBlocks: [
          'richtext',
        ],
        maxBlocks: 6,
        reorderable: true,
        defaultBlocks: [],
      },
      {
        id: 'privacy_contact',
        label: 'Contact',
        description: 'Where privacy questions go.',
        allowedBlocks: [
          'richtext',
        ],
        maxBlocks: 4,
        reorderable: true,
        defaultBlocks: [],
      },
    ],
    seeded: true,
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
      {
        id: 'terms_intro',
        label: 'Introduction',
        description: 'Who operates the site and what these terms cover.',
        allowedBlocks: [
          'richtext',
        ],
        maxBlocks: 4,
        reorderable: true,
        defaultBlocks: [],
      },
      {
        id: 'terms_accounts',
        label: 'Accounts',
        description: 'Sign-in and account responsibilities.',
        allowedBlocks: [
          'richtext',
        ],
        maxBlocks: 6,
        reorderable: true,
        defaultBlocks: [],
      },
      {
        id: 'terms_registration',
        label: 'Registration',
        description: 'Tickets, payment, refunds.',
        allowedBlocks: [
          'richtext',
        ],
        maxBlocks: 6,
        reorderable: true,
        defaultBlocks: [],
      },
      {
        id: 'terms_conduct',
        label: 'Conduct',
        description: 'The code of conduct and enforcement.',
        allowedBlocks: [
          'richtext',
        ],
        maxBlocks: 6,
        reorderable: true,
        defaultBlocks: [],
      },
      {
        id: 'terms_liability',
        label: 'Disclaimers',
        description: 'Warranty, liability, governing law.',
        allowedBlocks: [
          'richtext',
        ],
        maxBlocks: 6,
        reorderable: true,
        defaultBlocks: [],
      },
      {
        id: 'terms_contact',
        label: 'Contact',
        description: 'Where questions about the terms go.',
        allowedBlocks: [
          'richtext',
        ],
        maxBlocks: 4,
        reorderable: true,
        defaultBlocks: [],
      },
    ],
    seeded: true,
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
    seeded: true,
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
    seeded: true,
  },
  {
    id: 'recap',
    label: 'Event recap',
    path: '/recap',
    icon: null,
    order: 12,
    visible: true,
    systemPage: false,
    sections: [
      {
        id: 'recap_summary',
        label: 'Summary',
        description: 'A short look back at how the event went.',
        allowedBlocks: [
          'richtext',
        ],
        maxBlocks: 4,
        reorderable: true,
        defaultBlocks: [],
      },
      {
        id: 'recap_stats',
        label: 'By the numbers',
        description: 'Headline figures from the event.',
        allowedBlocks: [
          'stat',
        ],
        maxBlocks: 6,
        reorderable: true,
        defaultBlocks: [],
      },
      {
        id: 'recap_highlights',
        label: 'Highlights',
        description: 'One entry per takeaway or theme from the event.',
        allowedBlocks: [
          'list_item',
          'richtext',
        ],
        maxBlocks: 20,
        reorderable: true,
        defaultBlocks: [],
      },
      {
        id: 'recap_media',
        label: 'Photos and recordings',
        description: 'Links to photos, recordings, or other event media.',
        allowedBlocks: [
          'link_group',
          'richtext',
        ],
        maxBlocks: 20,
        reorderable: true,
        defaultBlocks: [],
      },
      {
        id: 'recap_next',
        label: 'More from the event',
        description: 'Links to the schedule, speakers, or a program download.',
        allowedBlocks: [
          'link_group',
        ],
        maxBlocks: 10,
        reorderable: true,
        defaultBlocks: [],
      },
      {
        id: 'recap_survey',
        label: 'Feedback',
        description: 'A link to a post-event survey, if there is one.',
        allowedBlocks: [
          'cta',
          'link_group',
        ],
        maxBlocks: 4,
        reorderable: true,
        defaultBlocks: [],
      },
    ],
    seeded: true,
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
      {
        id: 'guidelines_intro',
        label: 'Introduction',
        description: 'One paragraph welcoming speakers to this page.',
        allowedBlocks: [
          'richtext',
        ],
        maxBlocks: 2,
        reorderable: true,
        defaultBlocks: [],
      },
      {
        id: 'guidelines_formats',
        label: 'Session formats',
        description: 'One entry per session format speakers may be assigned, with its length and shape.',
        allowedBlocks: [
          'list_item',
          'richtext',
        ],
        maxBlocks: 20,
        reorderable: true,
        defaultBlocks: [],
      },
      {
        id: 'guidelines_deadlines',
        label: 'Deadlines',
        description: 'Key dates a speaker needs to know, such as when materials are due.',
        allowedBlocks: [
          'list_item',
          'richtext',
        ],
        maxBlocks: 20,
        reorderable: true,
        defaultBlocks: [],
      },
      {
        id: 'guidelines_av',
        label: 'On-site setup',
        description: 'What is provided in the room and what a speaker should bring.',
        allowedBlocks: [
          'richtext',
          'list_item',
        ],
        maxBlocks: 20,
        reorderable: true,
        defaultBlocks: [],
      },
      {
        id: 'guidelines_sharing',
        label: 'Sharing your materials',
        description: 'How slides, recordings, and photos are handled after the event.',
        allowedBlocks: [
          'richtext',
        ],
        maxBlocks: 10,
        reorderable: true,
        defaultBlocks: [],
      },
      {
        id: 'guidelines_help',
        label: 'Questions',
        description: 'Who a speaker can contact with questions before the event.',
        allowedBlocks: [
          'richtext',
          'link_group',
        ],
        maxBlocks: 6,
        reorderable: true,
        defaultBlocks: [],
      },
    ],
    seeded: true,
  },
  {
    id: 'city_guide',
    label: 'City guide',
    path: '/city-guide',
    icon: null,
    order: 14,
    visible: true,
    systemPage: false,
    sections: [
      {
        id: 'city_guide_intro',
        label: 'Introduction',
        description: 'One paragraph before the city guide.',
        allowedBlocks: [
          'richtext',
        ],
        maxBlocks: 2,
        reorderable: true,
        defaultBlocks: [],
      },
      {
        id: 'city_guide_eat',
        label: 'Places to eat',
        description: 'One entry per restaurant, cafe, or other place to eat near the venue.',
        allowedBlocks: [
          'list_item',
          'richtext',
        ],
        maxBlocks: 20,
        reorderable: true,
        defaultBlocks: [],
      },
      {
        id: 'city_guide_see',
        label: 'Things to see',
        description: 'One entry per sight, attraction, or activity near the venue.',
        allowedBlocks: [
          'list_item',
          'richtext',
        ],
        maxBlocks: 20,
        reorderable: true,
        defaultBlocks: [],
      },
      {
        id: 'city_guide_around',
        label: 'Getting around',
        description: 'One entry per transit option, parking note, or way to move between places.',
        allowedBlocks: [
          'list_item',
          'richtext',
        ],
        maxBlocks: 20,
        reorderable: true,
        defaultBlocks: [],
      },
    ],
    seeded: true,
  },
];

export default pagesData;
