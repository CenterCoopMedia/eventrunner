const ELIGIBLE_STATUSES = Object.freeze(['accepted', 'approved']);

/** The canonical speaker states that may enter the speaker dashboard. */
export function isSpeakerDashboardEligible(speaker) {
  return ELIGIBLE_STATUSES.includes(speaker?.status);
}
