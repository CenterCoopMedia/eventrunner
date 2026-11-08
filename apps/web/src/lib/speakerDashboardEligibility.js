// The linked, active statuses: the same set that gets reminders
// (REMINDABLE_SPEAKER_STATUSES in shared/speakerReadiness). This file loads
// with the first page through useAccountViews, so it keeps its own two-value
// copy rather than pull that module into the initial bundle. The test checks
// that the two lists stay equal.
export const DASHBOARD_SPEAKER_STATUSES = Object.freeze(['accepted', 'approved']);

/** The canonical speaker states that may enter the speaker dashboard. */
export function isSpeakerDashboardEligible(speaker) {
  return DASHBOARD_SPEAKER_STATUSES.includes(speaker?.status);
}
