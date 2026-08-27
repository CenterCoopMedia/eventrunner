// eventTime.js display-resolution tests, focused on the invalid-calendar-date
// hardening: Date.UTC silently normalizes out-of-range components (e.g.
// 2026-02-30 becomes 2026-03-02), so a wall clock built from an impossible
// date used to resolve — and render — as if it were a real, different day.
import { describe, expect, it } from 'vitest';
import {
  zonedDateTime,
  formatDayDate,
  formatEventDateRange,
  formatSessionTimeRange,
} from './eventTime.js';

describe('zonedDateTime', () => {
  it('resolves a real calendar date', () => {
    const resolved = zonedDateTime('2026-06-10', '09:00', 'America/New_York');
    expect(resolved).toBeInstanceOf(Date);
  });

  it('rejects a date that Date.UTC would silently normalize (Feb 30)', () => {
    expect(zonedDateTime('2026-02-30', '09:00', 'America/New_York')).toBeNull();
  });

  it('rejects a date that Date.UTC would silently normalize (April 31)', () => {
    expect(zonedDateTime('2026-04-31', '09:00', 'America/New_York')).toBeNull();
  });

  it('rejects a date with an out-of-range month component', () => {
    expect(zonedDateTime('2026-13-01', '09:00', 'America/New_York')).toBeNull();
  });

  it('still resolves the real last day of February in a leap year', () => {
    expect(zonedDateTime('2028-02-29', '09:00', 'America/New_York')).toBeInstanceOf(Date);
  });

  it('rejects Feb 29 in a non-leap year', () => {
    expect(zonedDateTime('2026-02-29', '09:00', 'America/New_York')).toBeNull();
  });
});

describe('formatDayDate', () => {
  it('is null for an invalid calendar date rather than a rolled-over one', () => {
    expect(formatDayDate({ date: '2026-02-30' }, 'America/New_York')).toBeNull();
  });
});

describe('formatSessionTimeRange', () => {
  it('is null when the session day date is an invalid calendar date', () => {
    const eventConfig = {
      timezone: 'America/New_York',
      days: [{ id: 'day-1', date: '2026-02-30' }],
    };
    const session = { dayId: 'day-1', startTime: '09:00', endTime: '10:00' };
    expect(formatSessionTimeRange(eventConfig, session)).toBeNull();
  });
});

// The masthead nameplate's dateline (design brief §2.1). Days are runtime
// config, so the helper must survive a malformed array without blanking the
// shell that renders it on every page.
describe('formatEventDateRange', () => {
  const ZONE = 'America/New_York';

  it('collapses a range inside one month', () => {
    const days = [
      { date: '2026-10-14' },
      { date: '2026-10-15' },
      { date: '2026-10-16' },
    ];
    expect(formatEventDateRange(days, ZONE)).toBe('October 14–16, 2026');
  });

  it('names both months when the event crosses one', () => {
    expect(
      formatEventDateRange([{ date: '2026-10-30' }, { date: '2026-11-01' }], ZONE),
    ).toBe('October 30 – November 1, 2026');
  });

  it('names both years when the event crosses one', () => {
    expect(
      formatEventDateRange([{ date: '2026-12-31' }, { date: '2027-01-01' }], ZONE),
    ).toBe('December 31, 2026 – January 1, 2027');
  });

  it('renders a single day as one date', () => {
    expect(formatEventDateRange([{ date: '2026-10-14' }], ZONE)).toBe('October 14, 2026');
  });

  it('orders the range by date, not by array order', () => {
    expect(
      formatEventDateRange([{ date: '2026-10-16' }, { date: '2026-10-14' }], ZONE),
    ).toBe('October 14–16, 2026');
  });

  it('drops days it cannot resolve and keeps the rest', () => {
    expect(
      formatEventDateRange([{ date: '2026-02-30' }, { date: '2026-10-14' }], ZONE),
    ).toBe('October 14, 2026');
  });

  it('is null for a missing, empty, or unusable days list', () => {
    expect(formatEventDateRange(undefined, ZONE)).toBeNull();
    expect(formatEventDateRange([], ZONE)).toBeNull();
    expect(formatEventDateRange('not an array', ZONE)).toBeNull();
    expect(formatEventDateRange([{ date: '2026-02-30' }], ZONE)).toBeNull();
  });
});
