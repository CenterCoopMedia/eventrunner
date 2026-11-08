import { describe, expect, it } from 'vitest';
import { REMINDABLE_SPEAKER_STATUSES } from 'shared/speakerReadiness';
import { DASHBOARD_SPEAKER_STATUSES, isSpeakerDashboardEligible } from './speakerDashboardEligibility.js';

describe('dashboard statuses', () => {
  it('match the statuses that get reminders', () => {
    expect(DASHBOARD_SPEAKER_STATUSES).toEqual(REMINDABLE_SPEAKER_STATUSES);
  });

  it('let only linked, active speakers in', () => {
    expect(isSpeakerDashboardEligible({ status: 'accepted' })).toBe(true);
    expect(isSpeakerDashboardEligible({ status: 'draft' })).toBe(false);
    expect(isSpeakerDashboardEligible(null)).toBe(false);
  });
});
