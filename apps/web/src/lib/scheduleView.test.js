// lib/scheduleView.js — the schedule's narrowing rules (issues #162, #163).
import { describe, expect, it } from 'vitest';
import {
  buildSearchIndex,
  collectFormats,
  filterEntries,
  matchesFilters,
  matchesQuery,
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
