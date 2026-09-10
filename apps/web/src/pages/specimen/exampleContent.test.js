// The book's fallbacks: the event's own content wherever it states some,
// and the authored example only where it states none.
//
// The direction matters as much as the fallback. A reader opens the book to
// see the system drawn in the event's own words; a fallback that took over
// while the event had its own rooms would show them somebody else's.
import { describe, expect, it } from 'vitest';
import {
  EXAMPLE_DAY,
  EXAMPLE_MOVEMENTS,
  EXAMPLE_PLACES,
  EXAMPLE_SESSIONS,
  EXAMPLE_TRACKS,
  specimenDays,
  specimenEventConfig,
  specimenPlaces,
  specimenSchedule,
  specimenTracks,
} from './exampleContent.js';

const STATED = Object.freeze({
  days: [
    { id: 'day-1', label: 'Day one', date: '2026-10-14', startTime: '09:00', endTime: '17:00' },
    { id: 'day-2', label: 'Day two', date: '2026-10-15', startTime: '09:00', endTime: '17:00' },
  ],
  tracks: [{ letter: 'C', name: 'Craft' }],
  venue: {
    name: 'Harborlight Hall',
    places: [{ id: 'atrium', name: 'Atrium' }],
    movements: [{ from: 'atrium', to: 'atrium', walkingMinutes: 0 }],
  },
});

describe('the event’s own content wins', () => {
  it('keeps the stated lines, rooms and days', () => {
    expect(specimenTracks(STATED)).toEqual(STATED.tracks);
    expect(specimenPlaces(STATED)).toEqual(STATED.venue.places);
    expect(specimenDays(STATED)).toEqual(STATED.days);
  });

  it('keeps the recorded movements beside the rooms they name', () => {
    const config = specimenEventConfig(STATED);
    expect(config.venue.places).toEqual(STATED.venue.places);
    expect(config.venue.movements).toEqual(STATED.venue.movements);
  });

  it('draws the second day, because a middle day is the fullest programme', () => {
    const sessions = [
      { id: 'a', dayId: 'day-1', title: 'Opening' },
      { id: 'b', dayId: 'day-2', title: 'Workshop' },
    ];
    expect(specimenSchedule(STATED, sessions)).toEqual({
      day: STATED.days[1],
      sessions: [sessions[1]],
    });
  });

  it('falls back to the first day when the second holds no session', () => {
    const sessions = [{ id: 'a', dayId: 'day-1', title: 'Opening' }];
    expect(specimenSchedule(STATED, sessions).day).toEqual(STATED.days[0]);
  });
});

describe('the authored example fills a field the event leaves out', () => {
  // `tracks` and `venue` are optional and `days` may be empty: each of
  // these is a document validateEventConfig accepts.
  const BARE = Object.freeze({ name: 'Harborlight Summit', timezone: 'America/New_York', days: [] });

  it('gives lines, rooms and a day to a configuration with none', () => {
    expect(specimenTracks(BARE)).toEqual(EXAMPLE_TRACKS);
    expect(specimenPlaces(BARE)).toEqual(EXAMPLE_PLACES);
    expect(specimenDays(BARE)).toEqual([EXAMPLE_DAY]);
  });

  it('takes the example movements with the example rooms, never on their own', () => {
    // A recorded move names two rooms. The event's movements beside the
    // authored rooms would state a walk between places it does not have.
    const config = specimenEventConfig(BARE);
    expect(config.venue.places).toEqual(EXAMPLE_PLACES);
    expect(config.venue.movements).toEqual(EXAMPLE_MOVEMENTS);
    for (const movement of config.venue.movements) {
      const ids = config.venue.places.map((place) => place.id);
      expect(ids).toContain(movement.from);
      expect(ids).toContain(movement.to);
    }
  });

  it('gives a day and its sessions when the snapshot holds neither', () => {
    expect(specimenSchedule(BARE, [])).toEqual({
      day: EXAMPLE_DAY,
      sessions: [...EXAMPLE_SESSIONS],
    });
  });

  it('gives the example day when the sessions are on a day the event dropped', () => {
    const orphaned = [{ id: 'a', dayId: 'day-9', title: 'Left behind' }];
    expect(specimenSchedule(STATED, orphaned).day).toEqual(EXAMPLE_DAY);
  });

  it('survives a configuration that is missing altogether', () => {
    expect(specimenTracks(undefined)).toEqual(EXAMPLE_TRACKS);
    expect(specimenPlaces(undefined)).toEqual(EXAMPLE_PLACES);
    expect(specimenDays(undefined)).toEqual([EXAMPLE_DAY]);
    expect(specimenEventConfig(undefined).venue.places).toEqual(EXAMPLE_PLACES);
    expect(specimenSchedule(undefined, undefined).day).toEqual(EXAMPLE_DAY);
  });
});

describe('the example sessions are a schedule, not a list', () => {
  it('holds one calling point inside a session on the same day', () => {
    const parents = EXAMPLE_SESSIONS.filter((session) => session.parentId);
    expect(parents.length).toBeGreaterThan(0);
    const ids = EXAMPLE_SESSIONS.map((session) => session.id);
    for (const child of parents) expect(ids).toContain(child.parentId);
    for (const session of EXAMPLE_SESSIONS) expect(session.dayId).toBe(EXAMPLE_DAY.id);
  });

  it('names only rooms and lines the example content defines', () => {
    const placeIds = EXAMPLE_PLACES.map((place) => place.id);
    const letters = EXAMPLE_TRACKS.map((track) => track.letter);
    for (const session of EXAMPLE_SESSIONS) {
      expect(placeIds).toContain(session.placeId);
      if (session.track) expect(letters).toContain(session.track);
    }
  });
});
