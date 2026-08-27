// Page layout variants and section slots (design brief §6.1, §6.2).
//
// The readers are forgiving on purpose — they meet documents written before
// this schema existed — so most of what is asserted here is what happens to
// data that says nothing, or says something the system does not know.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SECTION_SLOT,
  PAGE_LAYOUT_DEFAULTS,
  PAGE_LAYOUT_KEYS,
  PAGE_LAYOUT_VALUES,
  SECTION_SLOTS,
  resolvePageLayout,
  sectionsBySlot,
  slotOf,
  statedPageLayout,
} from './pageLayout.js';

describe('the layout vocabulary', () => {
  it('offers every variant a value list, and defaults to one of them', () => {
    for (const key of PAGE_LAYOUT_KEYS) {
      expect(PAGE_LAYOUT_VALUES[key].length, key).toBeGreaterThan(1);
      expect(PAGE_LAYOUT_VALUES[key], key).toContain(PAGE_LAYOUT_DEFAULTS[key]);
    }
  });

  it('has no "none" header — every public page keeps a nameplate', () => {
    expect(PAGE_LAYOUT_VALUES.header).toEqual(['nameplate', 'nameplate-compact']);
  });

  it('defaults a section to the main slot', () => {
    expect(SECTION_SLOTS).toEqual(['above', 'main', 'below']);
    expect(DEFAULT_SECTION_SLOT).toBe('main');
  });
});

describe('resolvePageLayout', () => {
  it('gives a page with no layout the defaults', () => {
    expect(resolvePageLayout({ id: 'home' })).toEqual(PAGE_LAYOUT_DEFAULTS);
    expect(resolvePageLayout(null)).toEqual(PAGE_LAYOUT_DEFAULTS);
  });

  it('takes what the page states over the defaults', () => {
    const layout = resolvePageLayout({ layout: { arrangement: 'grid', density: 'tight' } });
    expect(layout.arrangement).toBe('grid');
    expect(layout.density).toBe('tight');
    expect(layout.header).toBe(PAGE_LAYOUT_DEFAULTS.header);
  });

  it('falls back rather than rendering a value the system does not know', () => {
    const layout = resolvePageLayout({ layout: { arrangement: 'masonry', header: 'none' } });
    expect(layout.arrangement).toBe(PAGE_LAYOUT_DEFAULTS.arrangement);
    expect(layout.header).toBe(PAGE_LAYOUT_DEFAULTS.header);
  });

  it('survives a layout that is not an object', () => {
    expect(resolvePageLayout({ layout: 'grid' })).toEqual(PAGE_LAYOUT_DEFAULTS);
    expect(resolvePageLayout({ layout: ['grid'] })).toEqual(PAGE_LAYOUT_DEFAULTS);
  });
});

describe('statedPageLayout', () => {
  it('reports nothing for a page that chose nothing', () => {
    // The distinction the preset depends on: a page that never chose a
    // density must not read as having chosen the default one.
    expect(statedPageLayout({ id: 'home' })).toEqual({});
  });

  it('reports only the variants actually stored with a known value', () => {
    expect(statedPageLayout({ layout: { density: 'loose', arrangement: 'masonry' } })).toEqual({
      density: 'loose',
    });
  });
});

describe('slotOf and sectionsBySlot', () => {
  it('reads a missing or unknown slot as main', () => {
    expect(slotOf({ id: 'intro' })).toBe('main');
    expect(slotOf({ id: 'intro', slot: 'beside' })).toBe('main');
    expect(slotOf(null)).toBe('main');
  });

  it('groups sections by slot, keeping the page’s own order inside each', () => {
    const grouped = sectionsBySlot([
      { id: 'a', slot: 'below' },
      { id: 'b' },
      { id: 'c', slot: 'above' },
      { id: 'd', slot: 'below' },
      { id: 'e', slot: 'main' },
    ]);
    expect(grouped.above.map((s) => s.id)).toEqual(['c']);
    expect(grouped.main.map((s) => s.id)).toEqual(['b', 'e']);
    expect(grouped.below.map((s) => s.id)).toEqual(['a', 'd']);
  });

  it('returns three empty groups for a page with no sections', () => {
    expect(sectionsBySlot(null)).toEqual({ above: [], main: [], below: [] });
  });
});
