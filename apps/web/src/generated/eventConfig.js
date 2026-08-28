// GENERATED FILE — committed synthetic demo copy (spec §2.4, §5.4, §8.6).
//
// Regenerate with:  node scripts/generate-content.cjs --demo
// At deploy time the same script reads config/event + config/features from
// the project and writes out-of-tree (--out / GENERATED_DIR), so this
// committed copy — a fictional demo event, never a real organization name,
// city, or dates — is what CI builds from. config/bootstrap is never
// emitted here (§2.4).

export const eventConfig = {
  name: '[Demo] Harborlight Media Summit',
  shortName: 'DEMO-SUMMIT',
  tagline: 'A three-day event for people who operate local and cooperative newsrooms.',
  timezone: 'America/New_York',
  days: [
    {
      id: 'day-1',
      label: 'Day one',
      date: '2026-10-14',
      startTime: '09:00',
      endTime: '17:00',
    },
    {
      id: 'day-2',
      label: 'Day two',
      date: '2026-10-15',
      startTime: '09:00',
      endTime: '17:00',
    },
    {
      id: 'day-3',
      label: 'Day three',
      date: '2026-10-16',
      startTime: '09:00',
      endTime: '16:00',
    },
  ],
  tracks: [
    {
      letter: 'A',
      name: 'Practice',
    },
    {
      letter: 'B',
      name: 'Sustainability',
    },
  ],
  registration: {
    opensAt: '2026-06-01T09:00:00',
    closesAt: '2026-10-09T23:59:00',
    externalUrl: 'https://example.org/register',
  },
  venue: {
    name: '[Demo] Harborlight Hall',
    addressLine1: '1 Harborlight Way',
    addressLine2: null,
    city: 'Millhaven',
    region: 'MH',
    postalCode: '58211',
    country: 'US',
    mapUrl: null,
    places: [
      {
        id: 'main-hall',
        name: 'Main hall',
        floor: 'Ground floor',
      },
      {
        id: 'room-a',
        name: 'Room A',
        floor: 'First floor',
      },
      {
        id: 'room-b',
        name: 'Room B',
        floor: 'First floor',
      },
    ],
    movements: [
      {
        from: 'main-hall',
        to: 'room-a',
        walkingMinutes: 4,
        accessibleRoute: 'Lift beside the north stair to the first floor, then left along the gallery. Step-free the whole way.',
      },
      {
        from: 'room-a',
        to: 'main-hall',
        walkingMinutes: 3,
        accessibleRoute: 'The same lift back down, then straight ahead into the hall.',
      },
      {
        from: 'main-hall',
        to: 'room-b',
        walkingMinutes: 5,
        accessibleRoute: 'Lift beside the north stair to the first floor, then right to the end of the gallery.',
      },
      {
        from: 'room-b',
        to: 'main-hall',
        walkingMinutes: 4,
      },
      {
        from: 'room-a',
        to: 'room-b',
        walkingMinutes: 1,
        accessibleRoute: 'Along the first-floor gallery. No steps between the two rooms.',
      },
      {
        from: 'room-b',
        to: 'room-a',
        walkingMinutes: 1,
      },
    ],
  },
  sender: {
    email: 'summit@example.org',
    name: '[Demo] Harborlight Media Summit',
    replyTo: null,
    domainVerified: false,
    domainVerifiedAt: null,
  },
  legal: {
    operatorName: '[Demo] Harborlight Cooperative',
    postalAddressHtml: '<p>[Demo] Harborlight Cooperative<br>1 Harborlight Way<br>Millhaven, MH 58211</p>',
    supportEmail: 'support@example.org',
    conductEmail: 'conduct@example.org',
    reviewRequired: true,
  },
  social: {
    hashtag: null,
    handles: [],
  },
  announcedAt: '2026-05-01T12:00:00',
  archivedAt: null,
  seo: {
    description: 'Schedule, speaker, workshop, and travel information for the fictional [Demo] Harborlight Media Summit.',
    defaultOgImagePath: 'branding/og-default.svg',
    organizerName: '[Demo] Harborlight Cooperative',
    organizerUrl: 'https://example.org',
  },
  auth: {
    googleProviderEnabled: false,
    authorizedDomainsConfigured: false,
    attestedAt: null,
    attestedBy: null,
  },
};

export const features = {
  schedule: true,
  speakers: true,
  sponsors: true,
  attendeeDirectory: true,
  sessionBookmarks: false,
  sessionReactions: false,
  sessionMaterials: false,
  badges: false,
  liveUpdates: false,
  feedbackInbox: false,
  schedulePdf: false,
  icsExport: false,
  updates: false,
  autoApproveTicketHolders: false,
  publicAttendeeProfiles: false,
  webmcpPublic: false,
};

export const theme = {
  preset: 'newsroom',
  optionPicks: {},
  fonts: {},
  mode: 'light',
  header: 'masthead',
  logos: {
    primary: 'branding/logo.svg',
    mark: 'branding/mark.svg',
    footer: 'branding/mark.svg',
    ogDefault: 'branding/og-default.svg',
    favicon: 'branding/favicon.svg',
  },
};

export default eventConfig;
