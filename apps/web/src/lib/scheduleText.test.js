// lib/scheduleText.js — the whole programme as plain text (issue #166).
import { describe, expect, it } from 'vitest';
import { schedulePlainText } from './scheduleText.js';

const eventConfig = {
  name: '[Fixture] Lakeshore Docs Camp',
  timezone: 'America/Chicago',
  days: [
    { id: 'd1', label: 'Day one', date: '2026-10-15' },
    { id: 'd2', label: 'Day two', date: '2026-10-16' },
  ],
};

const sessions = [
  {
    id: 's1',
    dayId: 'd1',
    startTime: '09:05',
    endTime: '09:45',
    title: 'Morning kickoff',
    location: 'Main hall',
    track: 'A',
    speakerIds: ['sp1'],
    visible: true,
  },
  {
    id: 's2',
    dayId: 'd1',
    startTime: '09:20',
    endTime: '09:45',
    title: 'Breakout clinic',
    location: 'Main hall',
    parentId: 's1',
    visible: true,
  },
];

const sessionsByDay = new Map([
  ['d1', sessions],
  ['d2', []],
]);

const columns = [{ letter: 'A', name: 'Practice' }];
const speakerNamesById = new Map([['sp1', 'Dana Reporter']]);

describe('schedulePlainText', () => {
  const text = schedulePlainText({
    days: eventConfig.days,
    sessionsByDay,
    columns,
    eventConfig,
    speakerNamesById,
  });

  it('carries the event name and every configured day', () => {
    expect(text).toContain('[Fixture] Lakeshore Docs Camp — Full programme');
    expect(text).toContain('Day one · Thursday, October 15');
    expect(text).toContain('Day two · Friday, October 16');
  });

  it('draws each session with its time, room, line, and resolved speakers', () => {
    // The period rides once, on the end — the same range grammar the page
    // prints (lib/eventTime.js) — and the meta line reads line then room,
    // the same fixed order the printed handout uses.
    expect(text).toContain('9:05–9:45 AM  Morning kickoff');
    expect(text).toContain('A · Practice · Main hall');
    expect(text).toContain('Speakers: Dana Reporter');
  });

  it('draws a calling point under its parent, never as a row of its own', () => {
    expect(text).toMatch(/9:20 AM  Breakout clinic \(part of Morning kickoff\)/);
    expect(text.match(/^9:20 AM/m)).toBeNull();
  });

  it('states an empty day rather than skipping it', () => {
    expect(text).toContain('No sessions are announced for this day.');
  });

  it('a session whose time cannot be resolved says so', () => {
    const text2 = schedulePlainText({
      days: [eventConfig.days[0]],
      sessionsByDay: new Map([['d1', [{ ...sessions[0], startTime: null }]]]),
      columns,
      eventConfig,
    });
    expect(text2).toContain('Time to be announced  Morning kickoff');
  });
});
