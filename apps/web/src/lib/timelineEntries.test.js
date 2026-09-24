// The History section's list (issue #194): the committed snapshot until the
// listener reports, the live set wholesale after, and a drop of anything
// the page cannot draw.
import { describe, expect, it } from 'vitest';
import snapshotTimelineData from '@generated/timelineData.js';
import { prepareTimelineDocs, timelineEntries } from './timelineEntries.js';

const entry = (id, year, title, extra = {}) => ({ id, year, title, description: null, visible: true, ...extra });

describe('timelineEntries', () => {
  it('serves the committed snapshot before the listener reports', () => {
    expect(snapshotTimelineData.length).toBeGreaterThanOrEqual(2);
    for (const before of [null, undefined]) {
      expect(timelineEntries(before).map((doc) => doc.id)).toEqual(
        [...snapshotTimelineData].sort((a, b) => a.year - b.year).map((doc) => doc.id),
      );
    }
  });

  it('replaces the snapshot wholesale with a live set, oldest first', () => {
    const live = [entry('b', 2025, 'Second'), entry('a', 2019, 'First')];
    expect(timelineEntries(live).map((doc) => doc.id)).toEqual(['a', 'b']);
    for (const doc of snapshotTimelineData) {
      expect(timelineEntries(live).some((shown) => shown.id === doc.id)).toBe(false);
    }
  });

  it('empties the list when the live set is empty: the published set is the truth', () => {
    expect(timelineEntries([])).toEqual([]);
  });

  it('orders one year by title, then by id', () => {
    const docs = [entry('z', 2024, 'Beta'), entry('y', 2024, 'Alpha'), entry('x', 2024, 'Alpha'), entry('w', 2020, 'Zeta')];
    expect(prepareTimelineDocs(docs).map((doc) => doc.id)).toEqual(['w', 'x', 'y', 'z']);
  });

  it('drops an entry the page cannot draw, and keeps the rest', () => {
    const docs = [
      entry('ok', 2024, 'Kept'),
      entry('title-object', 2024, { text: 'x' }),
      entry('title-blank', 2024, '   '),
      entry('year-string', '2024', 'Year as text'),
      entry('year-fraction', 2024.5, 'Half a year'),
      entry('description-object', 2024, 'Description object', { description: { html: '<b>x</b>' } }),
      entry('hidden', 2024, 'Hidden', { visible: false }),
      null,
    ];
    expect(prepareTimelineDocs(docs).map((doc) => doc.id)).toEqual(['ok']);
    expect(prepareTimelineDocs(undefined)).toEqual([]);
  });
});
