// GENERATED FILE — committed synthetic demo copy (spec §2.4, §5.2–5.4, §8.6).
//
// Shape mirrors published cmsPages docs. systemPage: true marks pages with a
// dedicated React route (home, schedule, speakers, sponsors); non-system
// pages render at their own root-level `path` (e.g. /faq) through the
// generic catch-all route (issue #52). Section ids are generic vocabulary
// (spec §5.3) and tie to cmsContent docs via each block's `section` field.
// scripts/generate-content.cjs regenerates this file at deploy time
// (out-of-tree via GENERATED_DIR); this committed copy is the fictional
// demo event.

export const pagesData = [
  {
    id: 'home',
    label: 'Home page',
    path: '/',
    icon: null,
    order: 0,
    visible: true,
    systemPage: true,
    seeded: true,
    sections: [
      {
        id: 'hero',
        label: 'Hero',
        description: 'The opening headline, one supporting line, and the primary action.',
        allowedBlocks: ['text', 'cta', 'image'],
        maxBlocks: 4,
        reorderable: true,
        defaultBlocks: [
          { field: 'title', blockType: 'text', description: 'Event name headline.' },
          { field: 'subtitle', blockType: 'text', description: 'One warm supporting sentence.' },
          { field: 'register_cta', blockType: 'cta', description: 'Primary registration action.' },
        ],
      },
      {
        id: 'details',
        label: 'Details',
        description: 'Body copy describing what happens at the event.',
        allowedBlocks: ['richtext', 'image'],
        maxBlocks: 6,
        reorderable: true,
        defaultBlocks: [
          { field: 'intro', blockType: 'richtext', description: 'What happens across the days.' },
        ],
      },
      {
        id: 'stats',
        label: 'By the numbers',
        description: 'Headline figures with captions.',
        allowedBlocks: ['stat'],
        maxBlocks: 6,
        reorderable: true,
        defaultBlocks: [
          { field: 'attendees', blockType: 'stat', description: 'Expected attendance.' },
          { field: 'sessions', blockType: 'stat', description: 'Sessions planned.' },
        ],
      },
      {
        id: 'footer',
        label: 'Footer links',
        description: 'Grouped links rendered in the page footer.',
        allowedBlocks: ['link_group'],
        maxBlocks: 12,
        reorderable: true,
        defaultBlocks: [
          { field: 'contact_link', blockType: 'link_group', description: 'How to reach the organizers.' },
        ],
      },
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
    seeded: true,
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
    seeded: true,
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
    seeded: true,
    sections: [],
  },
  {
    id: 'faq',
    label: 'Frequently asked questions',
    path: '/faq',
    icon: null,
    order: 4,
    visible: true,
    systemPage: false,
    seeded: true,
    sections: [
      {
        id: 'faq',
        label: 'Questions and answers',
        description: 'One entry per common question.',
        allowedBlocks: ['faq_item', 'richtext'],
        maxBlocks: 30,
        reorderable: true,
        defaultBlocks: [
          { field: 'what_is_this', blockType: 'faq_item', description: 'What the event is.' },
        ],
      },
    ],
  },
];

export default pagesData;
