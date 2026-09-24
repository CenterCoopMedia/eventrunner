// The feed's runs (lib/updateDates.js groupUpdates).
//
// `sortUpdates` puts pinned posts first and then everything newest-first —
// the right order, and the wrong single run: a pinned August post at the top
// of the page would drag August's month head above October's. Pinned is not
// a date, so it is its own named run. These pin that.
import { describe, expect, it } from 'vitest';
import { compareUpdates, groupUpdates, publishDateLabel, publishMonthLabel, sortUpdates } from './updateDates.js';

const post = (id, publishAt, extra = {}) => ({ id, title: id, publishAt, ...extra });

describe('publishDateLabel', () => {
  // A dateline carries the event's clock (design record §3.1). Half past two
  // in the morning UTC is still the evening before on the west coast, so a
  // post published then is dated the evening before, whatever zone the
  // reader's browser runs in.
  it('dates a post on the event’s clock when the event’s zone is given', () => {
    const instant = '2026-10-01T02:30:00Z';
    expect(publishDateLabel(instant, 'America/Los_Angeles')).toBe('September 30, 2026');
    expect(publishDateLabel(instant, 'Pacific/Auckland')).toBe('October 1, 2026');
    expect(publishMonthLabel('2026-11-01T02:30:00Z', 'America/Los_Angeles')).toBe('October 2026');
  });

  it('falls back to the reader’s clock for no zone or a zone it does not know', () => {
    const instant = '2026-10-01T12:00:00Z';
    expect(publishDateLabel(instant)).toBe(publishDateLabel(instant, undefined));
    expect(publishDateLabel(instant, 'Not/AZone')).toBe(publishDateLabel(instant));
    expect(publishDateLabel(null, 'America/Los_Angeles')).toBeNull();
  });
});

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

// The one order the feed and the admin's updates list share (issue #190).
describe('compareUpdates', () => {
  it('puts pinned first, then newest first, then the undated', () => {
    const shuffled = [
      post('undated', null),
      post('old', '2026-09-01T12:00:00Z'),
      post('pinned-old', '2026-08-01T12:00:00Z', { pinned: true }),
      post('new', '2026-10-01T12:00:00Z'),
    ];
    expect(shuffled.slice().sort(compareUpdates).map((u) => u.id)).toEqual(['pinned-old', 'new', 'old', 'undated']);
  });

  it('is the order sortUpdates uses, and a date a year ahead is simply the newest', () => {
    const list = [post('now', '2026-10-01T12:00:00Z'), post('next-year', '2027-10-01T12:00:00Z')];
    expect(sortUpdates(list).map((u) => u.id)).toEqual(list.slice().sort(compareUpdates).map((u) => u.id));
    expect(sortUpdates(list)[0].id).toBe('next-year');
  });

  it('reads a pin only when it is true, and ties two undated posts', () => {
    expect(compareUpdates(post('a', null, { pinned: 'yes' }), post('b', null))).toBe(0);
  });
});

// The lead (issue #191): the first featured post in the feed's order, alone
// under "Featured", ahead of every other run.
describe('groupUpdates: the featured lead', () => {
  it('leads with the first featured post in sorted order, and does not list it again', () => {
    const sorted = sortUpdates([
      post('newer', '2026-10-20T12:00:00Z'),
      post('featured', '2026-10-03T12:00:00Z', { featured: true }),
      post('pinned', '2026-08-02T12:00:00Z', { pinned: true }),
    ]);
    const runs = groupUpdates(sorted);
    expect(runs.map((run) => [run.kind, run.label, run.members.map((m) => m.id)])).toEqual([
      ['lead', 'Featured', ['featured']],
      ['pinned', 'Pinned', ['pinned']],
      ['month', 'October 2026', ['newer']],
    ]);
    const ids = runs.flatMap((run) => run.members.map((m) => m.id));
    expect(ids.filter((id) => id === 'featured')).toHaveLength(1);
  });

  it('lets a pinned featured post beat a newer featured one, and leaves the second in its place', () => {
    const sorted = sortUpdates([
      post('featured-newer', '2026-10-20T12:00:00Z', { featured: true }),
      post('featured-pinned', '2026-08-02T12:00:00Z', { featured: true, pinned: true }),
    ]);
    expect(groupUpdates(sorted).map((run) => [run.kind, run.members.map((m) => m.id)])).toEqual([
      ['lead', ['featured-pinned']],
      ['month', ['featured-newer']],
    ]);
  });

  it('features a post only for a real true', () => {
    const sorted = sortUpdates([post('a', '2026-10-20T12:00:00Z', { featured: 'yes' }), post('b', '2026-10-19T12:00:00Z', { featured: 1 })]);
    expect(groupUpdates(sorted).map((run) => run.kind)).toEqual(['month']);
  });

  it('still heads the months on the event’s clock after the lead', () => {
    const sorted = sortUpdates([
      post('featured', '2026-10-03T12:00:00Z', { featured: true }),
      post('late', '2026-11-01T02:30:00Z'),
    ]);
    expect(groupUpdates(sorted, 'America/Los_Angeles').map((run) => run.label)).toEqual(['Featured', 'October 2026']);
    expect(groupUpdates(sorted, 'Pacific/Auckland').map((run) => run.label)).toEqual(['Featured', 'November 2026']);
  });
});
