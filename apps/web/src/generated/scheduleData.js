// GENERATED FILE — committed synthetic demo copy (spec §2.4, §5.4, §8.6).
//
// Regenerate with:  node scripts/generate-content.cjs --demo
//
// Shape mirrors published cmsSchedule docs. dayId values are stable keys
// from config/event.days (eventConfig.js). All names are fictional; no real
// speakers, ever (spec §5.4).

export const scheduleData = [
  {
    id: 'session-welcome',
    dayId: 'day-1',
    startTime: '09:30',
    endTime: '10:00',
    title: 'Welcome and orientation',
    description: 'Coffee, badge pickup, and a short welcome from the organizing committee before the first sessions begin.',
    location: 'Main hall',
    type: 'keynote',
    speakerIds: [
      'speaker-placeholder-1',
    ],
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
    description: 'Setting up a cross-newsroom reporting partnership, from shared documents to shared bylines.',
    location: 'Room A',
    type: 'workshop',
    speakerIds: [
      'speaker-placeholder-2',
    ],
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
    description: 'Three newsroom leaders on what it actually takes to keep a shared-coverage partnership funded past year one.',
    location: 'Main hall',
    type: 'panel',
    speakerIds: [
      'speaker-placeholder-1',
      'speaker-placeholder-3',
    ],
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
    description: 'Simple survey and interview methods for newsrooms with no research budget and no research team.',
    location: 'Room B',
    type: 'workshop',
    speakerIds: [
      'speaker-placeholder-2',
    ],
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
    description: 'Participant-proposed sessions, posted on the board each morning — bring a topic or just show up.',
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
    description: 'A short conversation on what came out of the three days and where the network goes from here.',
    location: 'Main hall',
    type: 'plenary',
    speakerIds: [
      'speaker-placeholder-3',
    ],
    visible: true,
    order: 1,
    seeded: true,
  },
];

export const speakers = [
  {
    id: 'speaker-placeholder-1',
    firstName: '[Demo] Marisol',
    lastName: 'Reyes',
    displayName: '[Demo] Marisol Reyes',
    slug: 'demo-marisol-reyes',
    bio: 'Managing editor at a bilingual community newsroom, focused on collaborative investigations with rural partner outlets.',
    headshotPath: 'branding/mark.svg',
    organization: 'Coastal Public Media',
    jobTitle: 'Managing Editor',
    socialHandles: {},
  },
  {
    id: 'speaker-placeholder-2',
    firstName: '[Demo] Devon',
    lastName: 'Achebe',
    displayName: '[Demo] Devon Achebe',
    slug: 'demo-devon-achebe',
    bio: 'Runs audience engagement for a three-station public radio network and teaches newsroom data-literacy workshops.',
    headshotPath: 'branding/mark.svg',
    organization: 'Three Rivers Public Radio',
    jobTitle: 'Audience Engagement Director',
    socialHandles: {},
  },
  {
    id: 'speaker-placeholder-3',
    firstName: '[Demo] Priya',
    lastName: 'Natarajan',
    displayName: '[Demo] Priya Natarajan',
    slug: 'demo-priya-natarajan',
    bio: 'Co-founded a reader-funded local news cooperative and advises other outlets on member-supported revenue models.',
    headshotPath: 'branding/mark.svg',
    organization: 'Harborlight Neighborhood News',
    jobTitle: 'Co-founder and Publisher',
    socialHandles: {},
  },
];

export default scheduleData;
