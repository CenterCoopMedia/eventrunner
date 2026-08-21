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
  tagline: '[Replace] A three-day gathering for people who make community media work.',
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
    addressLine1: '1 Placeholder Plaza',
    addressLine2: null,
    city: 'Demoville',
    region: 'ST',
    postalCode: '00000',
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
    postalAddressHtml: '[Replace] Operator postal address for the email footer.',
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
    description: '[Replace] One-sentence description of the event for search and social cards.',
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
    heading: 'serif-editorial',
    body: 'sans-humanist',
    accent: 'script-casual',
  },
  texture: 'paper',
  radius: 'soft',
  logos: {
    primary: 'branding/logo.svg',
    mark: 'branding/mark.svg',
    footer: 'branding/mark.svg',
    ogDefault: 'branding/og-default.svg',
    favicon: 'branding/favicon.svg',
  },
};

export default eventConfig;
