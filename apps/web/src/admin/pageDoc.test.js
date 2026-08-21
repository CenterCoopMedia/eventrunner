// cmsPages document helpers: what the editor loads, what it sends back, and
// how the two revisions read as one list.
import { describe, expect, it } from 'vitest';
import {
  PAGE_KEYS,
  mergePageRevisions,
  publishStateOf,
  toEditablePage,
  toPagePayload,
} from './pageDoc.js';

const STORED = {
  id: 'scholarships',
  label: 'Scholarships',
  path: '/scholarships',
  icon: null,
  order: 7,
  visible: true,
  systemPage: false,
  sections: [
    {
      id: 'intro',
      label: 'Intro',
      description: null,
      allowedBlocks: ['richtext'],
      maxBlocks: 3,
      reorderable: true,
      defaultBlocks: [{ field: 'body', blockType: 'richtext', description: 'Body copy.' }],
    },
  ],
  // Bookkeeping the server would reject on the way back.
  status: 'dirty',
  revision: 4,
  basedOnRevision: 3,
  updatedAt: 'whenever',
  updatedBy: 'admin@example.org',
  seeded: true,
  seededAt: 'whenever',
};

describe('toEditablePage', () => {
  it('keeps only the keys cmsSavePage accepts', () => {
    expect(Object.keys(toEditablePage(STORED)).sort()).toEqual([...PAGE_KEYS].sort());
  });

  it('strips unknown keys from sections and blocks too', () => {
    const page = toEditablePage({
      ...STORED,
      sections: [{ ...STORED.sections[0], seeded: true, defaultBlocks: [{ field: 'a', blockType: 'text', description: '', seeded: true }] }],
    });
    expect(Object.keys(page.sections[0])).not.toContain('seeded');
    expect(Object.keys(page.sections[0].defaultBlocks[0])).toEqual([
      'field',
      'blockType',
      'description',
    ]);
  });

  it('normalizes missing values so controlled inputs never see undefined', () => {
    const page = toEditablePage({});
    expect(page).toMatchObject({ id: '', label: '', path: '', order: 0, visible: true });
    expect(page.sections).toEqual([]);
  });
});

describe('toPagePayload', () => {
  it('coerces numeric form values and sends a blank description as null', () => {
    const page = toEditablePage(STORED);
    page.order = '12';
    page.sections[0].maxBlocks = '5';
    page.sections[0].description = '';
    const payload = toPagePayload(page);
    expect(payload.order).toBe(12);
    expect(payload.sections[0].maxBlocks).toBe(5);
    expect(payload.sections[0].description).toBeNull();
  });

  it('leaves an unparseable number alone so the server names the field', () => {
    const page = toEditablePage(STORED);
    page.order = 'not a number';
    expect(toPagePayload(page).order).toBe('not a number');
  });
});

describe('publish state', () => {
  it('reads a draft with no live revision as never published', () => {
    expect(publishStateOf({ live: null, draft: STORED }).id).toBe('unpublished');
  });

  it('reads a dirty draft over a live revision as unpublished changes', () => {
    expect(publishStateOf({ live: { id: 'x' }, draft: STORED }).id).toBe('dirty');
  });

  it('reads a clean draft, or no draft at all, as published', () => {
    expect(publishStateOf({ live: { id: 'x' }, draft: { status: 'clean' } }).id).toBe('published');
    expect(publishStateOf({ live: { id: 'x' }, draft: null }).id).toBe('published');
  });
});

describe('mergePageRevisions', () => {
  it('joins both revisions per id and prefers the draft for display', () => {
    const rows = mergePageRevisions(
      [{ id: 'a', label: 'Live A', order: 1 }],
      [{ id: 'a', label: 'Draft A', order: 1, status: 'dirty' }],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].current.label).toBe('Draft A');
    expect(rows[0].state.id).toBe('dirty');
  });

  it('sorts by order, then id', () => {
    const rows = mergePageRevisions(
      [
        { id: 'zebra', order: 0 },
        { id: 'apple', order: 0 },
        { id: 'later', order: 5 },
      ],
      null,
    );
    expect(rows.map((row) => row.id)).toEqual(['apple', 'zebra', 'later']);
  });

  it('treats no result yet as an empty list rather than throwing', () => {
    expect(mergePageRevisions(null, null)).toEqual([]);
  });
});
