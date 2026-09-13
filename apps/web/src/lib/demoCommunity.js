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

export { default as demoUpdates } from '../../../../scripts/lib/demo-updates.json';
