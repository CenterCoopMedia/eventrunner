// The grid's data shape (design brief §2.1 "Grid schedule", §4.6).
//
// The renderer decides how a cell looks; this decides what is in it. Every
// case below is a stored shape the public site can actually meet, including
// the ones the write path now refuses — a renderer meets what is already
// stored, not what the validator would accept today.
import { describe, expect, it } from 'vitest';
import { buildGridRows, resolveTracks, withCallingPoints } from './scheduleGrid.js';

const session = (id, fields = {}) => ({
  id,
  title: `[Fixture] ${id}`,
  startTime: '09:00',
  dayId: 'day-1',
  visible: true,
  ...fields,
});

describe('resolveTracks', () => {
  it('keeps the client’s order, because that is the column order', () => {
    expect(
      resolveTracks({ tracks: [{ letter: 'B', name: 'Sustainability' }, { letter: 'A', name: 'Practice' }] }),
    ).toEqual([
      { letter: 'B', name: 'Sustainability' },
      { letter: 'A', name: 'Practice' },
    ]);
  });

  it('names an unnamed line, because a mark with no word is a puzzle', () => {
    expect(resolveTracks({ tracks: [{ letter: 'c' }] })).toEqual([
      { letter: 'C', name: 'Line C' },
    ]);
  });

  it('drops what a live config write could deliver malformed', () => {
    expect(
      resolveTracks({
        tracks: [null, { letter: '' }, { letter: 'A', name: 'One' }, { letter: 'a', name: 'Again' }, 'A'],
      }),
    ).toEqual([{ letter: 'A', name: 'One' }]);
    expect(resolveTracks({})).toEqual([]);
    expect(resolveTracks(null)).toEqual([]);
  });
});

describe('withCallingPoints', () => {
  it('puts a child under its parent and takes its row away', () => {
    const parent = session('parent');
    const child = session('child', { parentId: 'parent', startTime: '09:30' });
    expect(withCallingPoints([parent, child])).toEqual([
      { session: parent, children: [child] },
    ]);
  });

  it('keeps the order it was given, on both levels', () => {
    const first = session('first');
    const second = session('second');
    const a = session('a', { parentId: 'first' });
    const b = session('b', { parentId: 'first' });
    const entries = withCallingPoints([first, a, b, second]);
    expect(entries.map((entry) => entry.session.id)).toEqual(['first', 'second']);
    expect(entries[0].children.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('renders an orphan on its own rather than dropping it', () => {
    // The parent is not in this day — a cross-day parentId, or a session
    // that has since been deleted. The reader still sees the session.
    const orphan = session('orphan', { parentId: 'not-here' });
    expect(withCallingPoints([orphan])).toEqual([{ session: orphan, children: [] }]);
  });

  it('refuses a second level, so the grid stays one level deep', () => {
    const parent = session('parent');
    const child = session('child', { parentId: 'parent' });
    const grandchild = session('grandchild', { parentId: 'child' });
    const entries = withCallingPoints([parent, child, grandchild]);
    expect(entries.map((entry) => entry.session.id)).toEqual(['parent', 'grandchild']);
    expect(entries[0].children.map((c) => c.id)).toEqual(['child']);
  });

  it('refuses a session that names itself', () => {
    const loop = session('loop', { parentId: 'loop' });
    expect(withCallingPoints([loop])).toEqual([{ session: loop, children: [] }]);
  });
});

describe('buildGridRows', () => {
  const columns = [
    { letter: 'A', name: 'Practice' },
    { letter: 'B', name: 'Sustainability' },
  ];
  const entry = (s, children = []) => ({ session: s, children });

  it('puts a session in its own line’s column, and leaves the rest empty', () => {
    const a = session('a', { track: 'A' });
    const rows = buildGridRows([entry(a)], columns);
    expect(rows).toHaveLength(1);
    expect(rows[0].cells.map((cell) => cell.track)).toEqual(['A', 'B']);
    expect(rows[0].cells[0].entries.map((e) => e.session.id)).toEqual(['a']);
    expect(rows[0].cells[1].entries).toEqual([]);
  });

  it('spans the width for a session on no line: a plenary', () => {
    const plenary = session('plenary');
    const rows = buildGridRows([entry(plenary)], columns);
    expect(rows[0].span.map((e) => e.session.id)).toEqual(['plenary']);
    expect(rows[0].cells).toBeUndefined();
  });

  it('spans the width for a letter no track defines', () => {
    // Stored before the write path checked the letter. It cannot be placed
    // in a column, so it runs across, which is the honest reading.
    const rows = buildGridRows([entry(session('stray', { track: 'Z' }))], columns);
    expect(rows[0].span.map((e) => e.session.id)).toEqual(['stray']);
  });

  it('puts the plenary first when a time holds both', () => {
    const plenary = session('plenary');
    const tracked = session('tracked', { track: 'B' });
    const rows = buildGridRows([entry(plenary), entry(tracked)], columns);
    expect(rows.map((row) => row.key)).toEqual(['09:00-span', '09:00-tracks']);
    expect(rows[0].time).toBe('09:00');
    expect(rows[1].time).toBe('09:00');
  });

  it('makes one row per start time, in the order it was given', () => {
    const rows = buildGridRows(
      [
        entry(session('first', { track: 'A', startTime: '09:00' })),
        entry(session('second', { track: 'B', startTime: '11:00' })),
        entry(session('third', { track: 'A', startTime: '11:00' })),
      ],
      columns,
    );
    expect(rows.map((row) => row.time)).toEqual(['09:00', '11:00']);
    expect(rows[1].cells[0].entries.map((e) => e.session.id)).toEqual(['third']);
    expect(rows[1].cells[1].entries.map((e) => e.session.id)).toEqual(['second']);
  });

  it('carries a parent’s calling points into its cell', () => {
    const parent = session('parent', { track: 'A' });
    const child = session('child', { track: 'A', parentId: 'parent' });
    const rows = buildGridRows([entry(parent, [child])], columns);
    expect(rows[0].cells[0].entries[0].children.map((c) => c.id)).toEqual(['child']);
    // The child is not a row of its own: it has no row to be in.
    expect(rows).toHaveLength(1);
  });
});
