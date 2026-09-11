// lib/scheduleView.js — the schedule's narrowing rules (issues #162, #163).
import { describe, expect, it } from 'vitest';
import {
  buildSearchIndex,
  collectFormats,
  filterEntries,
  matchesFilters,
  matchesQuery,
  readScheduleView,
  sortEntries,
  writeScheduleView,
} from './scheduleView.js';

const speakers = new Map([
  ['sp-1', 'Dana Reporter'],
  ['sp-2', 'Lee Editor'],
]);

const columns = [
  { letter: 'A', name: 'Practice' },
  { letter: 'B', name: 'Evidence' },
];

const day = [
  {
    id: 's1',
    title: 'Opening plenary',
    description: 'Where local news goes next',
    location: 'Main hall',
    track: 'A',
    speakerIds: ['sp-1'],
  },
  {
    id: 's2',
    title: 'Community hour',
    location: 'Lobby',
    type: 'reception',
  },
  {
    id: 's3',
    title: 'Fact-check clinic',
    parentId: 's2',
    location: 'Lobby table',
    speakerIds: ['sp-2'],
  },
  {
    id: 's4',
    title: 'Evidence workshop',
    track: 'B',
    type: 'workshop',
    description: 'Hands-on document digging',
  },
];

describe('buildSearchIndex', () => {
  it('carries the title, the description, the room, the track name, and the resolved speakers', () => {
    const index = buildSearchIndex(day, speakers, columns);
    const text = index.get('s1');
    expect(text).toContain('opening plenary');
    expect(text).toContain('where local news goes next');
    expect(text).toContain('main hall');
    expect(text).toContain('practice');
    expect(text).toContain('dana reporter');
  });

  it('matches a speaker by display name, not by stored id', () => {
    const index = buildSearchIndex(day, speakers, columns);
    expect(matchesQuery(index.get('s1'), 'Dana')).toBe(true);
    expect(matchesQuery(index.get('s1'), 'sp-1')).toBe(false);
  });

  it('drops a speaker id with no resolved name instead of indexing the raw id', () => {
    const index = buildSearchIndex([{ id: 'x', title: 'T', speakerIds: ['ghost'] }], speakers, columns);
    expect(index.get('x')).toBe('t');
  });

  it('an empty query keeps every session', () => {
    expect(matchesQuery('anything', '')).toBe(true);
    expect(matchesQuery('', '   ')).toBe(true);
  });
});

describe('collectFormats', () => {
  it('lists the formats the data carries, with counts, in first-seen order', () => {
    expect(collectFormats(day)).toEqual([
      { value: 'reception', label: 'reception', count: 1 },
      { value: 'workshop', label: 'workshop', count: 1 },
    ]);
  });

  it('offers nothing when no session names a format', () => {
    expect(collectFormats([{ id: 'x', title: 'T' }])).toEqual([]);
  });
});

describe('matchesFilters', () => {
  it('a facet with nothing on filters nothing', () => {
    expect(matchesFilters(day[3], {})).toBe(true);
    expect(matchesFilters(day[3], { formats: [], tracks: [] })).toBe(true);
  });

  it('a format filter keeps only the sessions of that format', () => {
    expect(matchesFilters(day[3], { formats: ['workshop'] })).toBe(true);
    expect(matchesFilters(day[1], { formats: ['workshop'] })).toBe(false);
  });

  it('a track filter compares the letter the session stores', () => {
    expect(matchesFilters(day[3], { tracks: ['b'] })).toBe(true);
    expect(matchesFilters(day[3], { tracks: ['B'] })).toBe(true);
    expect(matchesFilters(day[1], { tracks: ['b'] })).toBe(false);
  });

  it('a session must pass every facet that is on', () => {
    expect(matchesFilters(day[3], { formats: ['workshop'], tracks: ['b'] })).toBe(true);
    expect(matchesFilters(day[3], { formats: ['workshop'], tracks: ['a'] })).toBe(false);
  });
});

describe('filterEntries', () => {
  it('keeps the matched parent with all of its calling points', () => {
    const entries = filterEntries(day, (s) => s.id === 's2');
    expect(entries).toHaveLength(1);
    expect(entries[0].session.id).toBe('s2');
    expect(entries[0].children.map((child) => child.id)).toEqual(['s3']);
  });

  it('keeps the parent row of a matched calling point, with only the matched child under it', () => {
    const entries = filterEntries(day, (s) => s.id === 's3');
    expect(entries).toHaveLength(1);
    expect(entries[0].session.id).toBe('s2');
    expect(entries[0].children.map((child) => child.id)).toEqual(['s3']);
  });

  it('never turns a matched calling point into a row of its own', () => {
    const entries = filterEntries(day, (s) => s.id === 's3');
    expect(entries.some((entry) => entry.session.id === 's3')).toBe(false);
  });

  it('drops what matches nothing', () => {
    const entries = filterEntries(day, (s) => s.id === 'missing');
    expect(entries).toEqual([]);
  });

  it('keeps the day order the caller passed', () => {
    const entries = filterEntries(day, () => true);
    expect(entries.map((entry) => entry.session.id)).toEqual(['s1', 's2', 's4']);
    expect(entries[1].children.map((child) => child.id)).toEqual(['s3']);
  });

  it('refuses a session that names itself as its parent', () => {
    const loop = [{ id: 'x', title: 'T', parentId: 'x' }];
    expect(filterEntries(loop, () => true).map((entry) => entry.session.id)).toEqual(['x']);
  });
});

describe('the view in the URL', () => {
  const known = {
    dayIds: ['day-1', 'day-2'],
    formats: ['panel', 'workshop'],
    tracks: ['A', 'B'],
  };

  it('round trips: what write carries, read gives back', () => {
    const view = {
      q: 'editing',
      formats: ['workshop'],
      tracks: ['B'],
      day: 'day-2',
      sort: 'saved',
    };
    const params = writeScheduleView(view, { firstDayId: 'day-1' });
    expect(params.toString()).toBe('q=editing&format=workshop&track=B&day=day-2&sort=saved');
    expect(readScheduleView(params, known)).toEqual(view);
  });

  it('omits the defaults, so a cleared view keeps a clean URL', () => {
    const params = writeScheduleView(
      { q: '', formats: [], tracks: [], day: 'day-1', sort: 'time' },
      { firstDayId: 'day-1' },
    );
    expect(params.toString()).toBe('');
  });

  it('unknown values fall back to the default', () => {
    const params = new URLSearchParams(
      'q=&format=ghost,panel&track=Z&day=day-9&sort=controversial',
    );
    expect(readScheduleView(params, known)).toEqual({
      q: '',
      formats: ['panel'],
      tracks: [],
      day: null,
      sort: 'time',
    });
  });

  it('reads safely when handed nothing usable', () => {
    expect(readScheduleView(null, known)).toEqual({
      q: '',
      formats: [],
      tracks: [],
      day: null,
      sort: 'time',
    });
  });
});

describe('sortEntries', () => {
  const entry = (id, startTime, order = 0, title = id) => ({
    session: { id, startTime, order, title },
    children: [],
  });
  const entries = [entry('a', '10:00'), entry('b', '09:00'), entry('c', '11:00')];

  it('time keeps the programme order the caller produced', () => {
    expect(sortEntries(entries, 'time').map((e) => e.session.id)).toEqual(['a', 'b', 'c']);
  });

  it('saved puts the most bookmarked first, ties keeping programme order', () => {
    const counts = new Map([['b', 4], ['c', 4], ['a', 1]]);
    expect(sortEntries(entries, 'saved', counts).map((e) => e.session.id)).toEqual(['b', 'c', 'a']);
  });

  it('an absent count reads as zero', () => {
    const counts = new Map([['a', 2]]);
    expect(sortEntries(entries, 'saved', counts).map((e) => e.session.id)).toEqual(['a', 'b', 'c']);
  });

  it('no counts at all falls back to the programme time order', () => {
    // Without counts every session reads as zero, so the time tiebreaker
    // decides — which is the honest order to fall back to.
    expect(sortEntries(entries, 'saved', null).map((e) => e.session.id)).toEqual(['b', 'a', 'c']);
    expect(sortEntries(entries, 'saved').map((e) => e.session.id)).toEqual(['b', 'a', 'c']);
  });
});

it('discards stale URL filters when their configured facet has been removed', () => {
  const view = readScheduleView(new URLSearchParams('format=panel&track=A'), { formats: [], tracks: [] });
  expect(view.formats).toEqual([]);
  expect(view.tracks).toEqual([]);
});
