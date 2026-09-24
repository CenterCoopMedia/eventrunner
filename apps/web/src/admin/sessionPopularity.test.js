// Session popularity (issue #182): order by count, ties, orphans, and what
// counts as a session nobody saved.
import { describe, expect, it } from 'vitest';
import { rankSessionsBySaves } from './sessionPopularity.js';

const live = (id, title, extra = {}) => ({
  id,
  live: { id, title, visible: true, ...extra },
  draft: null,
  current: { id, title, visible: true, ...extra },
});

const GROUPS = [
  {
    dayId: 'day-1',
    label: 'Day one',
    rows: [live('keynote', 'Keynote'), live('audience', 'Audience research'), live('lunch', 'Lunch')],
  },
  {
    dayId: 'day-2',
    label: 'Thursday, October 15',
    rows: [
      live('data', 'Data desk'),
      // A draft that was never published cannot have been saved.
      { id: 'draft-only', live: null, draft: { title: 'Draft only' }, current: { title: 'Draft only' } },
      // A session taken off the site cannot be saved either.
      live('hidden', 'Hidden session', { visible: false }),
    ],
  },
];

describe('rankSessionsBySaves', () => {
  it('orders by count, most first, whatever the title and schedule order', () => {
    const { ranked } = rankSessionsBySaves(GROUPS, new Map([
      ['keynote', 2],
      ['data', 9],
      ['audience', 5],
    ]));
    expect(ranked).toEqual([
      { id: 'data', title: 'Data desk', dayLabel: 'Thursday, October 15', count: 9 },
      { id: 'audience', title: 'Audience research', dayLabel: 'Day one', count: 5 },
      { id: 'keynote', title: 'Keynote', dayLabel: 'Day one', count: 2 },
    ]);
  });

  it('breaks a tie on the title, then the id', () => {
    const groups = [{ label: 'Day one', rows: [live('b', 'Same'), live('a', 'Same'), live('c', 'Alpha')] }];
    const { ranked } = rankSessionsBySaves(groups, new Map([['a', 3], ['b', 3], ['c', 3]]));
    expect(ranked.map((row) => row.id)).toEqual(['c', 'a', 'b']);
  });

  it('ignores a count that names no session, and a zero or broken count', () => {
    const { ranked, unsaved } = rankSessionsBySaves(GROUPS, new Map([
      ['deleted-session', 40],
      ['keynote', 0],
      ['lunch', Number.NaN],
      ['audience', 1],
    ]));
    expect(ranked.map((row) => row.id)).toEqual(['audience']);
    // keynote, lunch and data are on the site with no saves.
    expect(unsaved).toBe(3);
  });

  // A deleted session's count stays in sessionBookmarks, and a new draft
  // may reuse its id; the count belongs to the old session, never to a
  // draft that was never published (connector review of PR 272).
  it('never gives a count to a draft that was never published, even one that reuses a saved id', () => {
    const { ranked, unsaved } = rankSessionsBySaves(GROUPS, new Map([['draft-only', 12], ['data', 2]]));
    expect(ranked.map((row) => row.id)).toEqual(['data']);
    expect(unsaved).toBe(3);
  });

  it('counts only sessions on the site as unsaved: drafts and hidden sessions are left out', () => {
    const { ranked, unsaved } = rankSessionsBySaves(GROUPS, new Map());
    expect(ranked).toEqual([]);
    expect(unsaved).toBe(4);
  });

  it('answers an empty ranking for no sessions or no counts', () => {
    expect(rankSessionsBySaves([], new Map([['x', 1]]))).toEqual({ ranked: [], unsaved: 0 });
    expect(rankSessionsBySaves(undefined, undefined)).toEqual({ ranked: [], unsaved: 0 });
  });
});
