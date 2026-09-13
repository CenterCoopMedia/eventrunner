// GENERATED FILE — committed synthetic demo copy (spec §2.4, §5.4, §8.6).
//
// Regenerate with:  node scripts/generate-content.cjs --demo
// At deploy time the same script reads config/event + config/features from
// the project and writes out-of-tree (--out / GENERATED_DIR), so this
// committed copy — a fictional demo event, never a real organization name,
// city, or dates — is what CI builds from. config/bootstrap is never
// emitted here (§2.4).

export const eventConfig = {
  name: 'Harborlight Media Summit',
  shortName: 'Harborlight',
  tagline: 'Stronger local news. Further together.',
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
    externalUrl: null,
    actionLabel: null,
  },
  venue: {
    name: 'The Newark Museum of Art',
    addressLine1: '49 Washington Street',
    addressLine2: null,
    city: 'Newark',
    region: 'NJ',
    postalCode: '07102',
    country: 'US',
    mapUrl: 'https://www.google.com/maps/search/?api=1&query=The+Newark+Museum+of+Art+49+Washington+Street+Newark+NJ',
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
        accessibleRoute: 'Illustrative route only. Follow the marked gallery and lift on the demo plan. This is not a surveyed museum route.',
      },
      {
        from: 'room-a',
        to: 'main-hall',
        walkingMinutes: 3,
        accessibleRoute: 'Illustrative route only. Follow the marked gallery and lift on the demo plan. This is not a surveyed museum route.',
      },
      {
        from: 'main-hall',
        to: 'room-b',
        walkingMinutes: 5,
        accessibleRoute: 'Illustrative route only. Follow the marked gallery and lift on the demo plan. This is not a surveyed museum route.',
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
        accessibleRoute: 'Illustrative route only. Follow the marked gallery and lift on the demo plan. This is not a surveyed museum route.',
      },
      {
        from: 'room-b',
        to: 'room-a',
        walkingMinutes: 1,
      },
    ],
    map: {
      image: 'branding/demo-venue-plan.svg',
      alt: 'Illustrative summit floor plan with the main hall, rooms A and B, registration, and a quiet room. This is not the museum floor plan.',
      markers: [
        {
          placeId: 'main-hall',
          x: 52,
          y: 27,
        },
        {
          placeId: 'room-a',
          x: 20,
          y: 79,
        },
        {
          placeId: 'room-b',
          x: 65,
          y: 79,
        },
      ],
    },
  },
  sender: {
    email: 'summit@example.org',
    name: 'Harborlight Media Summit',
    replyTo: null,
    domainVerified: false,
    domainVerifiedAt: null,
  },
  legal: {
    operatorName: 'Harborlight Cooperative',
    postalAddressHtml: '<p>Harborlight Cooperative<br>Fictional demo organization<br>Contact: support@example.org</p>',
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
    description: 'Schedule, speaker, workshop, and travel information for the fictional Harborlight Media Summit.',
    defaultOgImagePath: 'branding/og-default.svg',
    organizerName: 'Harborlight Cooperative',
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
  customBadges: false,
  liveUpdates: false,
  feedbackInbox: false,
  schedulePdf: false,
  icsExport: true,
  calendarSync: false,
  updates: true,
  autoApproveTicketHolders: false,
  publicAttendeeProfiles: false,
  webmcpPublic: false,
  webmcpAdmin: false,
};

export const theme = {
  preset: 'newsroom',
  optionPicks: {},
  fonts: {},
  mode: 'light',
  header: 'masthead',
  logos: {
    primary: 'branding/logo.svg',
    mark: null,
    footer: 'branding/mark.svg',
    ogDefault: 'branding/og-default.svg',
    favicon: 'branding/favicon.svg',
  },
};

export default eventConfig;
