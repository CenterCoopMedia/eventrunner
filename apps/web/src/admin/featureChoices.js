// The words staff see for each config/features key. The Features page
// lists them, and the content block editor names one when a link leads to a
// section that is off (AdminContentBlockEditor.jsx). One list, so the
// warning names the switch exactly as the Features page labels it.

/** Human-readable choices; the stored keys and whole-document payload stay unchanged. */
export const FEATURE_CHOICES = {
  schedule: { label: 'Public schedule', hint: 'Show the public schedule.' },
  speakers: { label: 'Speaker directory', hint: 'Show the public speaker directory.' },
  sponsors: { label: 'Sponsor list', hint: 'Show the public sponsor list.' },
  attendeeDirectory: { label: 'Attendee directory', hint: 'Let signed-in attendees browse each other.' },
  sessionBookmarks: { label: 'Session bookmarks', hint: 'Let attendees bookmark sessions.' },
  sessionReactions: { label: 'Session reactions', hint: 'Let attendees react to sessions.' },
  sessionMaterials: { label: 'Session materials', hint: 'Publish slides and handouts on sessions.' },
  badges: { label: 'Attendee badges', hint: 'Enable attendee badges.' },
  customBadges: { label: 'Custom badges', hint: 'Let attendees create their own profile badges.' },
  liveUpdates: { label: 'Live updates', hint: 'Show the live updates feed during the event.' },
  feedbackInbox: { label: 'Feedback inbox', hint: 'Collect attendee feedback.' },
  schedulePdf: { label: 'Schedule PDF', hint: 'Offer the schedule as a PDF.' },
  icsExport: { label: 'Calendar export', hint: 'Offer calendar (.ics) export.' },
  calendarSync: { label: 'Calendar sync', hint: 'Let attendees sync bookmarked sessions to their calendar.' },
  updates: { label: 'Written updates', hint: 'Publish written updates.' },
  autoApproveTicketHolders: { label: 'Automatic ticket approval', hint: 'Approve ticket holders without review.' },
  publicAttendeeProfiles: { label: 'Public attendee profiles', hint: 'Make attendee profiles publicly visible.' },
  webmcpPublic: { label: 'Public browser tools', hint: 'Expose bounded public read-only site tools in supported browsers.' },
  webmcpAdmin: { label: 'Admin browser tools', hint: 'Expose authenticated read-only admin diagnostics in supported browsers.' },
  changeRequests: { label: 'Change requests', hint: 'Let signed-in visitors and staff send change requests.' },
};

/**
 * The Features page label for a key, or the key itself for one this list
 * does not know yet.
 *
 * @param {string} key
 * @returns {string}
 */
export function featureLabel(key) {
  return FEATURE_CHOICES[key]?.label ?? key;
}
