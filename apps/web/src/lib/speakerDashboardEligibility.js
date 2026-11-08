// The statuses that may enter the speaker dashboard are the linked, active
// ones: the same set that gets reminders (shared/speakerReadiness).
import { REMINDABLE_SPEAKER_STATUSES } from 'shared/speakerReadiness';

/** The canonical speaker states that may enter the speaker dashboard. */
export function isSpeakerDashboardEligible(speaker) {
  return REMINDABLE_SPEAKER_STATUSES.includes(speaker?.status);
}
