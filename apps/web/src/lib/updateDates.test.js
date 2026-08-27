// The feed's runs (lib/updateDates.js groupUpdates).
//
// `sortUpdates` puts pinned posts first and then everything newest-first —
// the right order, and the wrong single run: a pinned August post at the top
// of the page would drag August's month head above October's. Pinned is not
// a date, so it is its own named run. These pin that.
import { describe, expect, it } from 'vitest';
import { groupUpdates, publishMonthLabel, sortUpdates } from './updateDates.js';

const post = (id, publishAt, extra = {}) => ({ id, title: id, publishAt, ...extra });

describe('publishMonthLabel', () => {
  it('names the month a post belongs to', () => {
    expect(publishMonthLabel('2026-10-03T12:00:00Z')).toBe('October 2026');
  });

  it('answers null for a date that never resolved', () => {
    for (const bad of [null, undefined, 'not a date', {}]) {
      expect(publishMonthLabel(bad)).toBeNull();
    }
  });
});

describe('groupUpdates', () => {
  it('runs Pinned first, then one head per month, newest first', () => {
    const sorted = sortUpdates([
      post('oct', '2026-10-03T12:00:00Z'),
      post('sep', '2026-09-04T12:00:00Z'),
      post('pinned-august', '2026-08-02T12:00:00Z', { pinned: true }),
    ]);
    expect(groupUpdates(sorted).map((run) => [run.kind, run.label])).toEqual([
      ['pinned', 'Pinned'],
      ['month', 'October 2026'],
      ['month', 'September 2026'],
    ]);
  });

  it('keeps two posts from the same month in one run', () => {
    const sorted = sortUpdates([
      post('early-oct', '2026-10-01T12:00:00Z'),
      post('late-oct', '2026-10-28T12:00:00Z'),
    ]);
    const runs = groupUpdates(sorted);
    expect(runs).toHaveLength(1);
    expect(runs[0].members.map((m) => m.id)).toEqual(['late-oct', 'early-oct']);
  });

  it('gives an undated post its own run rather than a month it never had', () => {
    const sorted = sortUpdates([post('dated', '2026-10-03T12:00:00Z'), post('undated', null)]);
    expect(groupUpdates(sorted).map((run) => run.label)).toEqual(['October 2026', 'Undated']);
  });

  it('never re-sorts what it was handed', () => {
    // One ordering rule for the page. A second one here could put a post in
    // a run the sort would have placed somewhere else.
    const sorted = sortUpdates([
      post('a', '2026-10-01T12:00:00Z'),
      post('b', '2026-10-28T12:00:00Z'),
      post('c', '2026-09-15T12:00:00Z'),
    ]);
    const flattened = groupUpdates(sorted).flatMap((run) => run.members.map((m) => m.id));
    expect(flattened).toEqual(sorted.map((m) => m.id));
  });

  it('makes no runs at all from an empty feed', () => {
    expect(groupUpdates([])).toEqual([]);
  });
});
