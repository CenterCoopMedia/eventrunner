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
  tagline: 'A three-day gathering for the people who keep community media working.',
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
    description: 'Three days of sessions, workshops, and hallway conversation for people who run local and cooperative newsrooms — schedule, speakers, and travel details for the [Demo] Harborlight Media Summit.',
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
};

export const theme = {
  fonts: {
    heading: 'sans-humanist',
    body: 'sans-humanist',
    data: 'sans-humanist',
  },
  texture: 'flat',
  radius: 'sharp',
  mode: 'light',
  logos: {
    primary: 'branding/logo.svg',
    mark: 'branding/mark.svg',
    footer: 'branding/mark.svg',
    ogDefault: 'branding/og-default.svg',
    favicon: 'branding/favicon.svg',
  },
};

export default eventConfig;
