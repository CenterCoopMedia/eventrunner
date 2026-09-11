// lib/scheduleState.js — the running and finished marks (issue #167).
import { describe, expect, it } from 'vitest';
import { sessionStateOf } from './scheduleState.js';

const eventConfig = {
  timezone: 'America/Chicago',
  days: [{ id: 'd1', label: 'Day one', date: '2026-10-15' }],
};

// 09:05–09:45 CDT (UTC−5) on 2026-10-15.
const session = { id: 's1', dayId: 'd1', startTime: '09:05', endTime: '09:45' };

const at = (utc) => new Date(utc);

describe('sessionStateOf', () => {
  it('a session inside its window is running', () => {
    expect(sessionStateOf(eventConfig, session, at('2026-10-15T14:30:00Z'))).toBe('running');
  });

  it('a session whose end has passed is finished', () => {
    expect(sessionStateOf(eventConfig, session, at('2026-10-15T14:45:00Z'))).toBe('finished');
    expect(sessionStateOf(eventConfig, session, at('2026-10-15T18:00:00Z'))).toBe('finished');
  });

  it('a session that has not started is not marked', () => {
    expect(sessionStateOf(eventConfig, session, at('2026-10-15T13:00:00Z'))).toBeNull();
    expect(sessionStateOf(eventConfig, session, at('2026-10-14T13:00:00Z'))).toBeNull();
  });

  it('the window reads the event timezone, not the browser clock zone', () => {
    // 09:05 CDT is 14:05 UTC; a browser in UTC reading its own 09:05 wall
    // clock (13:05Z, hmm — the point is the boundary) must not move the
    // mark. One minute before the real start is not running; one minute
    // after is.
    expect(sessionStateOf(eventConfig, session, at('2026-10-15T14:04:00Z'))).toBeNull();
    expect(sessionStateOf(eventConfig, session, at('2026-10-15T14:06:00Z'))).toBe('running');
  });

  it('a session whose times cannot be resolved is never marked', () => {
    expect(sessionStateOf(eventConfig, { ...session, startTime: null }, at('2026-10-15T15:00:00Z'))).toBeNull();
    expect(sessionStateOf(eventConfig, { ...session, dayId: 'ghost' }, at('2026-10-15T15:00:00Z'))).toBeNull();
    expect(sessionStateOf(eventConfig, session, 'not a date')).toBeNull();
  });

  it('a midnight-crossing end belongs to the next day', () => {
    // 23:30–00:15 starts on d1; the end rolls to 00:15 CDT on the 16th
    // (05:15Z). 23:45 CDT on the 15th is 04:45Z.
    const late = { id: 's2', dayId: 'd1', startTime: '23:30', endTime: '00:15' };
    expect(sessionStateOf(eventConfig, late, at('2026-10-16T04:45:00Z'))).toBe('running');
    expect(sessionStateOf(eventConfig, late, at('2026-10-16T05:14:00Z'))).toBe('running');
    expect(sessionStateOf(eventConfig, late, at('2026-10-16T05:15:00Z'))).toBe('finished');
  });
});
