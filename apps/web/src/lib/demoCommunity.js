import { speakers } from '@generated/scheduleData.js';

/** Fictional public profiles for the static demo. No account fields. */
export const demoAttendees = speakers
  .filter((speaker) => speaker.slug?.startsWith('demo-'))
  .map((speaker) => ({
    id: `demo-attendee-${speaker.slug.slice(5)}`,
    displayName: speaker.displayName,
    organization: speaker.organization,
    jobTitle: speaker.jobTitle,
    bio: speaker.bio,
    photoPath: speaker.headshotPath,
    speakerId: speaker.id,
    profileVisibility: 'public',
    badges: [],
    customBadges: [],
  }));

/** September announcements for the fictional October 14–16 summit. */
export const demoUpdates = [
  {
    id: 'demo-program-ready',
    title: 'The three-day program is ready',
    body: 'Choose your first workshop and leave room for a conversation you did not plan. The October 14–16 program includes reporting labs, revenue workshops, peer clinics, and a two-hour unconference.\n\nThe Practice and Sustainability tracks run beside shared sessions and meals. Each workshop includes an exercise. Bring a notebook or laptop, and use the sample files if you do not have a project to bring.\n\nHarborlight is a fictional event. The schedule demonstrates a complete summit; there are no tickets or real bookings.',
    publishAt: '2026-09-12T13:00:00.000Z',
    visible: true,
    pinned: true,
  },
  {
    id: 'demo-survey-clinic',
    title: 'Bring one question to the survey clinic',
    body: 'What do you need to learn from your readers? Start with that decision before drafting a survey. Devon Achebe will lead the audience research workshop on Thursday, October 15, from 1:30 to 3 p.m.\n\nThe group starts in Room B. The linked review clinic moves to the main hall at 2 p.m. Bring three draft questions or use the fictional newsroom example. The goal is a short survey that readers can answer without guessing what you mean.',
    publishAt: '2026-09-10T14:00:00.000Z',
    visible: true,
    pinned: false,
  },
  {
    id: 'demo-newark-guide',
    title: 'Explore the Newark travel guide',
    body: 'The travel page now includes a real map anchor at The Newark Museum of Art, 49 Washington Street. Compare train routes through Newark Penn Station and Newark Broad Street Station before planning a visit.\n\nThe museum is a geographic reference for this demo. No event booking or partnership is implied. The room plan and walking times are illustrative. Check the museum website for current visitor information and parking guidance.',
    publishAt: '2026-09-08T15:00:00.000Z',
    visible: true,
    pinned: false,
  },
  {
    id: 'demo-speaker-preparation',
    title: 'A short checklist for speakers',
    body: 'Start with what participants should be able to do after your session. Build one exercise around that outcome, and leave time for questions.\n\nFor this fictional event, speaker bios and portraits are due September 30. Slides are due October 7. Use readable text, describe useful visuals aloud, and remove private source details from examples. The speaker guidelines page has the full preparation notes.',
    publishAt: '2026-09-04T13:00:00.000Z',
    visible: true,
    pinned: false,
  },
];
