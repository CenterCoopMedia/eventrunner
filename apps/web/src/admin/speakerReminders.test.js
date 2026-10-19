import { describe, expect, it } from 'vitest';
import {
  describeMissing,
  formatWhen,
  itemLabels,
  newBatchId,
  readGroup,
  rowsInGroup,
  sendLabel,
  sendSummary,
} from './speakerReminders.js';

const rows = [
  { id: 'a', readiness: { missing: ['bio', 'materials'] } },
  { id: 'b', readiness: { missing: [] } },
  { id: 'c', readiness: { missing: ['description'] } },
];

describe('speaker reminder helpers', () => {
  it('reads a group from the address and keeps the rows the group names', () => {
    expect(readGroup('materials')).toBe('materials');
    expect(readGroup('nope')).toBe('any');
    expect(readGroup(null)).toBe('any');
    expect(rowsInGroup(rows, 'any').map((row) => row.id)).toEqual(['a', 'c']);
    expect(rowsInGroup(rows, 'all').map((row) => row.id)).toEqual(['a', 'b', 'c']);
    expect(rowsInGroup(rows, 'materials').map((row) => row.id)).toEqual(['a']);
  });

  it('names the missing items with the sessions they apply to', () => {
    expect(describeMissing({
      missing: ['headshot', 'description', 'materials'],
      descriptionSessions: [{ id: 's1', title: 'One' }],
      materialsSessions: [{ id: 's1', title: 'One' }, { id: 's2', title: 'Two' }],
    })).toBe('Headshot, Session description (One), Materials (One; Two)');
    expect(describeMissing({ missing: [] })).toBe('Nothing missing');
    expect(itemLabels(['materials', 'bio'])).toBe('Biography, Materials');
  });

  it('counts in words', () => {
    expect(sendLabel(1)).toBe('Send 1 reminder');
    expect(sendLabel(3)).toBe('Send 3 reminders');
    expect(sendSummary({ sent: [1, 2], alreadySent: [1], skipped: [], failed: [] })).toBe(
      'Sent 2 reminders. 1 speaker already had this reminder, so nothing more was sent.',
    );
  });

  it('makes a batch id the server accepts, and formats a time on the event clock', () => {
    expect(newBatchId()).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(formatWhen('2026-10-19T12:00:00.000Z', 'UTC')).toBe('Oct 19, 2026, 12:00 PM (UTC)');
    expect(formatWhen(null, 'UTC')).toBe('');
  });
});
