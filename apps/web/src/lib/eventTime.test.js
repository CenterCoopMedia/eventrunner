// eventTime.js display-resolution tests, focused on the invalid-calendar-date
// hardening: Date.UTC silently normalizes out-of-range components (e.g.
// 2026-02-30 becomes 2026-03-02), so a wall clock built from an impossible
// date used to resolve — and render — as if it were a real, different day.
import { describe, expect, it } from 'vitest';
import {
  countdownParts,
  eventDateRangeLabel,
  formatDayDate,
  formatEventDateRange,
  formatSessionStart,
  formatSessionTimeRange,
  resolveEventStart,
  zonedDateTime,
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

describe('formatSessionStart', () => {
  const config = {
    timezone: 'America/New_York',
    days: [{ id: 'd1', date: '2026-10-14' }],
  };

  it('carries the period a range would have dropped', () => {
    // "9:00-9:45 AM" reads right as a range and wrong as a row header: a
    // time standing on its own has to say which half of the day it is in.
    const session = { dayId: 'd1', startTime: '09:00', endTime: '09:45' };
    expect(formatSessionTimeRange(config, session).startLabel).toBe('9:00');
    expect(formatSessionStart(config, session)).toEqual({
      startIso: '2026-10-14T09:00',
      startLabel: '9:00 AM',
    });
  });

  it('fails soft the same way the range does', () => {
    expect(formatSessionStart(config, { dayId: 'nope', startTime: '09:00' })).toBeNull();
    expect(formatSessionStart(config, { dayId: 'd1', startTime: 'noon' })).toBeNull();
  });
});

describe('resolveEventStart', () => {
  const ZONE = 'America/New_York';

  it('resolves the earliest configured day, not the first in array order', () => {
    const eventConfig = {
      timezone: ZONE,
      days: [
        { date: '2026-10-16', startTime: '09:00', endTime: '17:00' },
        { date: '2026-10-14', startTime: '10:00', endTime: '17:00' },
      ],
    };
    expect(resolveEventStart(eventConfig)).toEqual(zonedDateTime('2026-10-14', '10:00', ZONE));
  });

  it('is null with no timezone', () => {
    expect(resolveEventStart({ days: [{ date: '2026-10-14', startTime: '09:00' }] })).toBeNull();
  });

  it('is null with no days', () => {
    expect(resolveEventStart({ timezone: ZONE, days: [] })).toBeNull();
    expect(resolveEventStart({ timezone: ZONE })).toBeNull();
  });

  it('is null for the whole list when just one day is malformed — the same fail-closed rule getEventPhase applies, so the countdown never targets a day the lifecycle clock does not recognize', () => {
    const eventConfig = {
      timezone: ZONE,
      days: [
        { date: '2026-10-14' }, // missing startTime
        { date: '2026-10-15', startTime: '09:00', endTime: '17:00' },
      ],
    };
    expect(resolveEventStart(eventConfig)).toBeNull();
  });

  it('is null when a day has no endTime — validDays requires one too, and a day it cannot see can never bring the lifecycle clock to in_progress, so the countdown must never target it either', () => {
    const eventConfig = {
      timezone: ZONE,
      days: [{ date: '2026-10-14', startTime: '09:00' }], // no endTime
    };
    expect(resolveEventStart(eventConfig)).toBeNull();
  });

  it('is null when endTime is malformed', () => {
    const eventConfig = {
      timezone: ZONE,
      days: [{ date: '2026-10-14', startTime: '09:00', endTime: 'five pm' }],
    };
    expect(resolveEventStart(eventConfig)).toBeNull();
  });
});

describe('countdownParts', () => {
  it('splits a duration into days, hours, minutes, seconds', () => {
    const ms =
      2 * 86_400_000 + 3 * 3_600_000 + 4 * 60_000 + 5 * 1000;
    expect(countdownParts(ms)).toEqual({ days: 2, hours: 3, minutes: 4, seconds: 5 });
  });

  it('never returns a negative figure', () => {
    expect(countdownParts(-1)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 });
    expect(countdownParts(-86_400_000)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  });

  it('is zeroed for non-finite input', () => {
    expect(countdownParts(NaN)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  });
});

describe('eventDateRangeLabel', () => {
  // The same shapes the seed writes into the home page's When fact
  // (scripts/lib/seed.cjs eventDateRange), so the fact the page shows live
  // and the fact the seed stored agree to the character.
  it('states one day, a run inside a month, a run across months, and a run across years', () => {
    expect(eventDateRangeLabel({ days: [{ date: '2026-10-14' }] })).toBe('October 14, 2026');
    expect(
      eventDateRangeLabel({ days: [{ date: '2026-10-16' }, { date: '2026-10-14' }, { date: '2026-10-15' }] }),
    ).toBe('October 14–16, 2026');
    expect(eventDateRangeLabel({ days: [{ date: '2026-09-30' }, { date: '2026-10-02' }] })).toBe(
      'September 30 – October 2, 2026',
    );
    expect(eventDateRangeLabel({ days: [{ date: '2026-12-31' }, { date: '2027-01-02' }] })).toBe(
      'December 31, 2026 – January 2, 2027',
    );
  });

  it('answers null with no dated day, and ignores a malformed date', () => {
    expect(eventDateRangeLabel({ days: [] })).toBeNull();
    expect(eventDateRangeLabel({})).toBeNull();
    expect(eventDateRangeLabel({ days: [{ date: 'soon' }, { date: '2026-10-14' }] })).toBe('October 14, 2026');
  });

  it('drops a date that is not a real calendar date rather than throwing', () => {
    // '2026-13-01' passes a shape check and makes an invalid Date, which the
    // formatter throws on — and the home page with it (adversarial review,
    // 2026-09-24). config/event is runtime data, so it may say anything.
    expect(eventDateRangeLabel({ days: [{ date: '2026-13-01' }] })).toBeNull();
    expect(eventDateRangeLabel({ days: [{ date: '2026-02-30' }, { date: '2026-10-14' }] })).toBe('October 14, 2026');
    expect(eventDateRangeLabel({ days: [{ date: '2026-02-28' }] })).toBe('February 28, 2026');
  });
});
