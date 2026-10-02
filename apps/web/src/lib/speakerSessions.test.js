import { describe, expect, it } from 'vitest';
import {
  nextSpeakerSession,
  selectOwnSpeakerSessions,
} from './speakerSessions.js';

const EVENT = {
  timezone: 'America/Chicago',
  days: [
    { id: 'day-1', label: 'Thursday', date: '2026-10-15', startTime: '08:00', endTime: '18:00' },
    { id: 'day-2', label: 'Friday', date: '2026-10-16', startTime: '08:00', endTime: '18:00' },
  ],
};

function session(id, patch = {}) {
  return {
    id,
    title: id,
    dayId: 'day-1',
    startTime: '10:00',
    endTime: '11:00',
    visible: true,
    speakerIds: ['speaker-own'],
    ...patch,
  };
}

describe('speaker session selection', () => {
  it('keeps only visible sessions assigned by canonical speaker id and orders them by event time', () => {
    const rows = [
      session('later-day', { dayId: 'day-2', startTime: '08:00', endTime: '09:00' }),
      session('other-speaker', { speakerIds: ['speaker-other'], startTime: '08:00' }),
      session('hidden', { visible: false, startTime: '08:30' }),
      session('same-time-second', { order: 2 }),
      session('same-time-first', { order: 1 }),
      session('missing-clock', { dayId: 'missing-day' }),
    ];

    expect(selectOwnSpeakerSessions(rows, 'speaker-own', EVENT).map((row) => row.id)).toEqual([
      'same-time-first',
      'same-time-second',
      'later-day',
      'missing-clock',
    ]);
    expect(selectOwnSpeakerSessions(rows, 'Speaker Own', EVENT)).toEqual([]);
  });

  it('uses timezone-resolved instants and keeps a running session ahead of a later one', () => {
    const current = session('current', { startTime: '09:00', endTime: '10:30' });
    const later = session('later', { startTime: '11:00', endTime: '12:00' });
    const sessions = [later, current];

    // 10:00 in Chicago. A browser in any timezone gets the same answer.
    expect(nextSpeakerSession(sessions, EVENT, new Date('2026-10-15T15:00:00.000Z'))?.id).toBe('current');
    expect(nextSpeakerSession(sessions, EVENT, new Date('2026-10-15T15:30:00.000Z'))?.id).toBe('later');
  });

  it('does not claim that an unresolved or open-ended past session is next', () => {
    const missingStart = session('missing-start', { startTime: null });
    const openEndedPast = session('open-ended-past', { startTime: '09:00', endTime: null });
    const openEndedFuture = session('open-ended-future', { startTime: '11:00', endTime: null });
    const now = new Date('2026-10-15T15:00:00.000Z');

    expect(nextSpeakerSession([missingStart, openEndedPast, openEndedFuture], EVENT, now)?.id)
      .toBe('open-ended-future');
    expect(nextSpeakerSession([missingStart, openEndedPast], EVENT, now)).toBeNull();
    expect(nextSpeakerSession([], EVENT, now)).toBeNull();
  });
});
