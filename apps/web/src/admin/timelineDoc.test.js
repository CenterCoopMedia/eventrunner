// The timeline form helpers (issue #194). The editor-level flows live in
// pages/AdminTimeline.test.jsx; this file pins the pieces they rest on: the
// merge and its order, the state words, the payload, the editor's own
// checks, and the limits the editor shares with the server.
import { describe, expect, it } from 'vitest';
import * as timelineCjs from '../../../../functions/src/cms/timeline.cjs';
import {
  TIMELINE_LIMITS,
  mergeTimelineRevisions,
  timelineFields,
  validateTimelineForm,
} from './timelineDoc.js';

const { TIMELINE_LIMITS: SERVER_LIMITS } = timelineCjs.default ?? timelineCjs;

const FORM = Object.freeze({ year: '2024', title: 'The first meeting', description: 'Teams met.', visible: true });

describe('TIMELINE_LIMITS', () => {
  it('matches the server’s limits', () => {
    expect(TIMELINE_LIMITS).toEqual(SERVER_LIMITS);
  });
});

describe('mergeTimelineRevisions', () => {
  it('gives one row per entry, oldest first, with each state in words', () => {
    const rows = mergeTimelineRevisions(
      [
        { id: 'b', year: 2025, title: 'Two tracks', visible: true },
        { id: 'a', year: 2024, title: 'First', visible: true },
      ],
      [
        { id: 'b', year: 2025, title: 'Two tracks, edited', visible: true, status: 'dirty' },
        { id: 'a', year: 2024, title: 'First', visible: true, status: 'clean' },
        { id: 'c', year: 2019, title: 'Earliest', visible: true, status: 'dirty' },
      ],
    );
    expect(rows.map((row) => row.id)).toEqual(['c', 'a', 'b']);
    expect(rows.map((row) => row.state.label)).toEqual(['Draft', 'Live', 'Live with unpublished changes']);
    // The draft is what the editor shows, where there is one.
    expect(rows[2].current.title).toBe('Two tracks, edited');
    expect(rows[1].live.title).toBe('First');
  });

  it('orders one year by title, then id, and puts an entry with no usable year last', () => {
    const rows = mergeTimelineRevisions(
      [
        { id: 'y', year: 2024, title: 'Beta' },
        { id: 'x', year: 2024, title: 'Alpha' },
        { id: 'w', year: '2020', title: 'Year as text' },
      ],
      [],
    );
    expect(rows.map((row) => row.id)).toEqual(['x', 'y', 'w']);
  });

  it('is empty before either revision has arrived', () => {
    expect(mergeTimelineRevisions(null, null)).toEqual([]);
  });
});

describe('timelineFields', () => {
  it('sends the three fields, the year as a number, the text trimmed, and a blank description as null', () => {
    expect(timelineFields({ ...FORM, title: '  The first meeting ', description: '   ' })).toEqual({
      year: 2024,
      title: 'The first meeting',
      description: null,
    });
    expect(timelineFields(FORM)).toEqual({ year: 2024, title: 'The first meeting', description: 'Teams met.' });
  });

  it('sends a year that is not four digits as typed, so the server names it', () => {
    expect(timelineFields({ ...FORM, year: '20245' }).year).toBe('20245');
    expect(timelineFields({ ...FORM, year: 'twenty' }).year).toBe('twenty');
  });
});

describe('validateTimelineForm', () => {
  it('passes a complete entry', () => {
    expect(validateTimelineForm(FORM).size).toBe(0);
    expect(validateTimelineForm({ ...FORM, description: '' }).size).toBe(0);
  });

  it('asks for a year as four digits, in range', () => {
    expect(validateTimelineForm({ ...FORM, year: '' }).get('year')).toBe('Enter a year as four digits.');
    expect(validateTimelineForm({ ...FORM, year: '20245' }).get('year')).toBe('Enter a year as four digits.');
    expect(validateTimelineForm({ ...FORM, year: '1899' }).get('year')).toBe('Enter a year from 1900 to 2100.');
    expect(validateTimelineForm({ ...FORM, year: '2100' }).size).toBe(0);
  });

  it('asks for a title on one line, at most 120 characters', () => {
    expect(validateTimelineForm({ ...FORM, title: '  ' }).get('title')).toBe('Enter a title.');
    expect(validateTimelineForm({ ...FORM, title: 't'.repeat(121) }).get('title')).toBe('Use 120 characters or fewer.');
    expect(validateTimelineForm({ ...FORM, title: 't'.repeat(120) }).size).toBe(0);
    expect(validateTimelineForm({ ...FORM, title: 'a\tb' }).get('title')).toBe('Keep the title on one line, without tabs.');
  });

  it('keeps a description to 600 characters of plain text, line breaks allowed', () => {
    expect(validateTimelineForm({ ...FORM, description: 'd'.repeat(601) }).get('description')).toBe(
      'Use 600 characters or fewer.',
    );
    expect(validateTimelineForm({ ...FORM, description: 'One.\nTwo.' }).size).toBe(0);
    expect(validateTimelineForm({ ...FORM, description: 'One.\tTwo.' }).get('description')).toBe(
      'Use plain text. A line break is the only control character allowed.',
    );
  });
});
