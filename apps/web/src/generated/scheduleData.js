// GENERATED FILE — committed synthetic demo copy (spec §2.4, §5.4, §8.6).
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
    title: '[Demo] Welcome and orientation',
    description: '[Replace] Short description of the opening session.',
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
    title: '[Demo] Workshop: collaborative reporting basics',
    description: '[Replace] What attendees will practice in this workshop.',
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
    title: '[Demo] Panel: sustaining local partnerships',
    description: '[Replace] The question this panel will dig into.',
    location: 'Main hall',
    type: 'panel',
    speakerIds: ['speaker-placeholder-1', 'speaker-placeholder-3'],
    visible: true,
    order: 0,
    seeded: true,
  },
  {
    id: 'session-closing',
    dayId: 'day-2',
    startTime: '15:00',
    endTime: '16:00',
    title: '[Demo] Closing conversation',
    description: '[Replace] How the event wraps up and what happens next.',
    location: 'Main hall',
    type: 'plenary',
    speakerIds: [],
    visible: true,
    order: 1,
    seeded: true,
  },
];

export const speakers = [
  {
    id: 'speaker-placeholder-1',
    name: '[Demo] Alex Placeholder',
    title: '[Replace] Role, Organization',
    bio: '[Replace] Two-sentence speaker bio.',
    photoPath: 'branding/mark.svg',
    visible: true,
    seeded: true,
  },
  {
    id: 'speaker-placeholder-2',
    name: '[Demo] Sam Example',
    title: '[Replace] Role, Organization',
    bio: '[Replace] Two-sentence speaker bio.',
    photoPath: 'branding/mark.svg',
    visible: true,
    seeded: true,
  },
  {
    id: 'speaker-placeholder-3',
    name: '[Demo] Riley Specimen',
    title: '[Replace] Role, Organization',
    bio: '[Replace] Two-sentence speaker bio.',
    photoPath: 'branding/mark.svg',
    visible: true,
    seeded: true,
  },
];

export default scheduleData;
