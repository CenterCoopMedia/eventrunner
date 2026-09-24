// The overview's milestone clock (issue #180).
import { describe, expect, it } from 'vitest';
import { daysPhrase, daysUntil, sortMilestones } from './milestones.js';

const ZONE = 'America/New_York';

describe('daysUntil', () => {
  const noonInZone = new Date('2026-10-14T16:00:00Z'); // 12:00 EDT on 14 October

  it('counts today as zero, the future as positive, and the past as negative', () => {
    expect(daysUntil('2026-10-14', ZONE, noonInZone)).toBe(0);
    expect(daysUntil('2026-10-15', ZONE, noonInZone)).toBe(1);
    expect(daysUntil('2026-10-26', ZONE, noonInZone)).toBe(12);
    expect(daysUntil('2026-10-13', ZONE, noonInZone)).toBe(-1);
    expect(daysUntil('2026-10-11', ZONE, noonInZone)).toBe(-3);
    expect(daysUntil('2027-10-14', ZONE, noonInZone)).toBe(365);
  });

  it('reads today on the event’s calendar, not the reader’s or UTC', () => {
    // 03:30 UTC on 15 October is still 23:30 on 14 October in New York.
    const lateEvening = new Date('2026-10-15T03:30:00Z');
    expect(daysUntil('2026-10-15', ZONE, lateEvening)).toBe(1);
    expect(daysUntil('2026-10-14', ZONE, lateEvening)).toBe(0);
    // A minute past midnight in New York, the day has turned.
    const justAfter = new Date('2026-10-15T04:01:00Z');
    expect(daysUntil('2026-10-15', ZONE, justAfter)).toBe(0);
    // The same instant is already the 15th in Tokyo's evening.
    expect(daysUntil('2026-10-15', 'Asia/Tokyo', lateEvening)).toBe(0);
  });

  it('counts calendar days across a daylight saving change', () => {
    // Clocks go back on 1 November 2026 in New York: that day has 25 hours.
    const before = new Date('2026-10-31T16:00:00Z');
    expect(daysUntil('2026-11-02', ZONE, before)).toBe(2);
    // Clocks go forward on 8 March 2026: that day has 23 hours.
    const late = new Date('2026-03-08T03:30:00Z'); // 22:30 EST on 7 March
    expect(daysUntil('2026-03-09', ZONE, late)).toBe(2);
    expect(daysUntil('2026-03-08', ZONE, late)).toBe(1);
  });

  it('answers null for a date it cannot read, and survives an unknown zone', () => {
    expect(daysUntil('soon', ZONE, new Date())).toBeNull();
    expect(daysUntil('2026-10-15', 'Not/AZone', new Date('2026-10-14T12:00:00Z'))).toBe(1);
  });
});

describe('daysPhrase', () => {
  it('says the days in words', () => {
    expect(daysPhrase(0)).toBe('Today');
    expect(daysPhrase(1)).toBe('In 1 day');
    expect(daysPhrase(12)).toBe('In 12 days');
    expect(daysPhrase(-1)).toBe('1 day ago');
    expect(daysPhrase(-3)).toBe('3 days ago');
    expect(daysPhrase(null)).toBe('');
  });
});

describe('sortMilestones', () => {
  it('orders by date, then by name, and leaves out what cannot be drawn', () => {
    expect(sortMilestones([
      { label: 'Programme announced', date: '2027-04-15' },
      { label: 'Proposals close', date: '2027-03-01' },
      { label: '  Early rate ends ', date: '2027-03-01' },
      { label: '', date: '2027-01-01' },
      { label: 'No date', date: '' },
      null,
    ])).toEqual([
      { label: 'Early rate ends', date: '2027-03-01' },
      { label: 'Proposals close', date: '2027-03-01' },
      { label: 'Programme announced', date: '2027-04-15' },
    ]);
    expect(sortMilestones(null)).toEqual([]);
    expect(sortMilestones([])).toEqual([]);
  });
});
