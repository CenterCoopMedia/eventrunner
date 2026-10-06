// GENERATED FILE — committed public demo copy (spec §2.4, §5.4, §8.6).
//
// Regenerate with:  node scripts/generate-content.cjs --demo
// At deploy time the same script reads config/event + config/features from
// the project and writes out-of-tree (--out / GENERATED_DIR), so this
// committed copy uses the explicitly approved public historical demo
// fixture. No private deployment export is committed. config/bootstrap is never
// emitted here (§2.4).

export const eventConfig = {
  name: 'NC News & Information Summit',
  shortName: 'NC Local',
  tagline: 'Historical 2026 program · EventRunner demo',
  timezone: 'America/New_York',
  days: [
    {
      id: 'day-1',
      label: 'Friday',
      date: '2026-03-27',
      startTime: '08:00',
      endTime: '16:30',
    },
  ],
  tracks: [
    {
      letter: 'A',
      name: 'Reporting & public information',
    },
    {
      letter: 'B',
      name: 'Community & collaboration',
    },
  ],
  registration: {
    opensAt: null,
    closesAt: null,
    externalUrl: null,
    actionLabel: null,
  },
  venue: {
    name: 'McKimmon Center',
    addressLine1: '1101 Gorman Street',
    addressLine2: null,
    city: 'Raleigh',
    region: 'NC',
    postalCode: '27606',
    country: 'US',
    mapUrl: 'https://www.openstreetmap.org/search?query=1101%20Gorman%20Street%20Raleigh%20NC%2027606',
    places: [
      {
        id: 'room-3',
        name: 'Room 3',
        floor: null,
      },
      {
        id: 'room-4',
        name: 'Room 4',
        floor: null,
      },
      {
        id: 'room-6',
        name: 'Room 6',
        floor: null,
      },
      {
        id: 'room-9',
        name: 'Room 9',
        floor: null,
      },
    ],
    movements: [],
    map: null,
  },
  sender: {
    email: 'summit@example.org',
    name: 'NC Local historical demo',
    replyTo: null,
    domainVerified: false,
    domainVerifiedAt: null,
  },
  legal: {
    operatorName: 'EventRunner historical demo',
    postalAddressHtml: '<p>Historical NC Local summit mock-up. No registration, email delivery or staffed event service.</p>',
    supportEmail: 'support@example.org',
    conductEmail: 'conduct@example.org',
    reviewRequired: true,
  },
  social: {
    hashtag: null,
    handles: [],
  },
  announcedAt: '2026-01-01T12:00:00',
  archivedAt: '2026-03-28T00:00:00',
  seo: {
    description: 'Past-event demo of the 2026 NC News & Information Summit in Raleigh: Selected historical sessions, speakers and documented partners.',
    defaultOgImagePath: 'branding/nclocal-og.png',
    organizerName: 'NC Local and NC Open Government Coalition',
    organizerUrl: 'https://nclocal.org/',
  },
  auth: {
    googleProviderEnabled: false,
    authorizedDomainsConfigured: false,
    attestedAt: null,
    attestedBy: null,
  },
  historicalDemo: true,
};

export const features = {
  schedule: true,
  speakers: true,
  sponsors: true,
  attendeeDirectory: false,
  sessionBookmarks: false,
  sessionReactions: false,
  sessionMaterials: false,
  badges: false,
  customBadges: false,
  liveUpdates: false,
  feedbackInbox: false,
  schedulePdf: false,
  icsExport: false,
  calendarSync: false,
  updates: true,
  autoApproveTicketHolders: false,
  publicAttendeeProfiles: false,
  webmcpPublic: false,
  webmcpAdmin: false,
  changeRequests: false,
};

export const theme = {
  preset: 'newsroom',
  optionPicks: {},
  fonts: {
    heading: 'merriweather',
    body: 'merriweather',
    data: 'cabin',
    mono: 'plex-mono',
  },
  tokens: {
    light: {
      surface: '#' + 'ffffff',
      surfaceAlt: '#' + 'f4f0eb',
      ink: '#' + '111111',
      inkMuted: '#' + '676767',
      primary: '#' + '093a46',
      primaryDark: '#' + '001c28',
      primaryLight: '#' + 'c1c4dc',
      accent: '#' + '093a46',
      success: '#' + '16603e',
      warning: '#' + '86520a',
      danger: '#' + 'aa202c',
      highlight: '#' + '7c5a0e',
      keynote: '#' + '093a46',
    },
    dark: {
      surface: '#' + '001c28',
      surfaceAlt: '#' + '092a36',
      ink: '#' + 'f9f7f5',
      inkMuted: '#' + 'c2ced1',
      primary: '#' + 'c1c4dc',
      primaryDark: '#' + 'e0e1ed',
      primaryLight: '#' + '093a46',
      accent: '#' + 'c2ced1',
      success: '#' + '74c896',
      warning: '#' + 'e4ae58',
      danger: '#' + 'f2888e',
      highlight: '#' + 'debe6c',
      keynote: '#' + 'c1c4dc',
    },
  },
  texture: 'flat',
  radius: 'editorial',
  density: 'comfortable',
  mode: 'light',
  header: 'masthead',
  logos: {
    primary: 'branding/nclocal-logo.png',
    mark: 'branding/nclocal-logo.png',
    footer: 'branding/nclocal-logo.png',
    ogDefault: 'branding/nclocal-og.png',
    favicon: 'branding/nclocal-favicon.svg',
  },
};

export default eventConfig;
