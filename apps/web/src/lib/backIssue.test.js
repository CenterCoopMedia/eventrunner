// The back issue: when a day becomes an archive (design brief §2.1).
//
// Every boundary here is on the EVENT's wall clock, never the reader's, so
// a visitor in another timezone sees the same programme as a visitor
// standing in the hall. The fixtures below run in America/Chicago and the
// assertions name instants in UTC, which is what makes that visible.
import { describe, expect, it } from 'vitest';
import { dayHasPassed, eventIsArchived, isBackIssue } from './backIssue.js';

const EVENT = {
  timezone: 'America/Chicago',
  announcedAt: '2026-01-01T00:00',
  archivedAt: null,
  days: [
    { id: 'day-1', label: 'Day one', date: '2026-10-15', startTime: '09:00', endTime: '17:00' },
    { id: 'day-2', label: 'Day two', date: '2026-10-16', startTime: '09:00', endTime: '17:00' },
  ],
};
const DAY = EVENT.days[0];

describe('dayHasPassed', () => {
  it('is false while the day is still running', () => {
    // 21:00 UTC is 16:00 in Chicago: an hour of the day is left.
    expect(dayHasPassed(DAY, EVENT, new Date('2026-10-15T21:00:00Z'))).toBe(false);
  });

  it('is true once the day’s last minute is behind the event', () => {
    // 23:00 UTC is 18:00 in Chicago, an hour after the day ended.
    expect(dayHasPassed(DAY, EVENT, new Date('2026-10-15T23:00:00Z'))).toBe(true);
  });

  it('runs a day with no stated end to midnight', () => {
    // Filing a programme as an archive while people are still in the room
    // is the one failure this device must not have.
    const open = { id: 'day-1', date: '2026-10-15' };
    expect(dayHasPassed(open, EVENT, new Date('2026-10-15T23:00:00Z'))).toBe(false);
    expect(dayHasPassed(open, EVENT, new Date('2026-10-16T06:00:00Z'))).toBe(true);
  });

  it('says no where the day cannot be resolved at all', () => {
    expect(dayHasPassed({ id: 'x', date: 'someday' }, EVENT, new Date())).toBe(false);
    expect(dayHasPassed(null, EVENT, new Date())).toBe(false);
    expect(dayHasPassed(DAY, { timezone: 'Mars/Olympus' }, new Date())).toBe(false);
  });
});

describe('eventIsArchived', () => {
  it('is false until the operator sets a date, and it passes', () => {
    const now = new Date('2026-11-01T12:00:00Z');
    expect(eventIsArchived(EVENT, now)).toBe(false);
    expect(eventIsArchived({ ...EVENT, archivedAt: '2026-12-01T00:00' }, now)).toBe(false);
    expect(eventIsArchived({ ...EVENT, archivedAt: '2026-10-20T00:00' }, now)).toBe(true);
  });
});

describe('isBackIssue', () => {
  it('is true for a past day of a live event', () => {
    const duringDayTwo = new Date('2026-10-16T15:00:00Z');
    expect(isBackIssue(EVENT.days[0], EVENT, duringDayTwo)).toBe(true);
    expect(isBackIssue(EVENT.days[1], EVENT, duringDayTwo)).toBe(false);
  });

  it('is true for every day of an archived event, including one still to come', () => {
    const archived = { ...EVENT, archivedAt: '2026-01-02T00:00' };
    const beforeTheEvent = new Date('2026-06-01T12:00:00Z');
    expect(isBackIssue(EVENT.days[1], archived, beforeTheEvent)).toBe(true);
  });
});
