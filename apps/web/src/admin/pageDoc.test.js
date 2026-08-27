// cmsPages document helpers: what the editor loads, what it sends back, and
// how the two revisions read as one list.
import { describe, expect, it } from 'vitest';
import * as pagesCjs from '../../../../functions/src/cms/pages.cjs';
import {
  PAGE_KEYS,
  SECTION_KEYS,
  DEFAULT_BLOCK_KEYS,
  mergePageRevisions,
  publishStateOf,
  toEditablePage,
  toPagePayload,
} from './pageDoc.js';
import {
  PAGE_LAYOUT_DEFAULTS,
  PAGE_LAYOUT_VALUES,
  SECTION_SLOTS,
} from '../lib/pageLayout.js';

const backend = pagesCjs.default ?? pagesCjs;

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

// The two key lists must stay in step (brief §6.2): validatePageDoc rejects
// an unknown top-level or section key BY NAME, so a one-sided addition here
// breaks every save of a seeded page. Imported from the functions source the
// same way the block-registry parity test does it.
describe('cmsPages key parity with the server', () => {
  it('mirrors PAGE_KEYS, SECTION_KEYS, and DEFAULT_BLOCK_KEYS exactly', () => {
    expect([...PAGE_KEYS]).toEqual([...backend.internals.PAGE_KEYS]);
    expect([...SECTION_KEYS]).toEqual([...backend.internals.SECTION_KEYS]);
    expect([...DEFAULT_BLOCK_KEYS]).toEqual([...backend.internals.DEFAULT_BLOCK_KEYS]);
  });

  it('mirrors the layout variants and the section slots the server accepts', () => {
    expect(PAGE_LAYOUT_VALUES).toEqual(backend.PAGE_LAYOUT_VALUES);
    expect([...SECTION_SLOTS]).toEqual([...backend.SECTION_SLOTS]);
  });

  it('sends a payload the server accepts, layout and slots included', () => {
    const page = toEditablePage(STORED);
    page.layout.arrangement = 'grid';
    page.sections[0].slot = 'below';
    const verdict = backend.validatePageDoc(toPagePayload(page));
    expect(verdict.errors).toEqual([]);
    expect(verdict.ok).toBe(true);
  });
});

describe('layout and slot', () => {
  it('opens a page with no stored layout on the defaults', () => {
    expect(toEditablePage(STORED).layout).toEqual(PAGE_LAYOUT_DEFAULTS);
  });

  it('keeps a stored layout and fills in what it leaves out', () => {
    const page = toEditablePage({ ...STORED, layout: { navPlacement: 'side' } });
    expect(page.layout.navPlacement).toBe('side');
    expect(page.layout.density).toBe(PAGE_LAYOUT_DEFAULTS.density);
  });

  it('reads a section with no slot as main, and sends it back whole', () => {
    const page = toEditablePage(STORED);
    expect(page.sections[0].slot).toBe('main');
    expect(toPagePayload(page).sections[0].slot).toBe('main');
    expect(toPagePayload(page).layout).toEqual(PAGE_LAYOUT_DEFAULTS);
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

// The admin says a record's state in exactly three words (admin story part
// 2, brief §5.2). The words live in admin/recordState.js so pages, content,
// speakers, badges, and branding cannot drift apart; these cases pin the
// mapping from the two-revision model onto them.
describe('publish state', () => {
  it('reads a draft with no live revision as Draft', () => {
    const state = publishStateOf({ live: null, draft: STORED });
    expect(state.id).toBe('draft');
    expect(state.label).toBe('Draft');
  });

  it('reads a dirty draft over a live revision as Live with unpublished changes', () => {
    const state = publishStateOf({ live: { id: 'x' }, draft: STORED });
    expect(state.id).toBe('dirty');
    expect(state.label).toBe('Live with unpublished changes');
  });

  it('reads a clean draft, or no draft at all, as Live', () => {
    expect(publishStateOf({ live: { id: 'x' }, draft: { status: 'clean' } }).label).toBe('Live');
    expect(publishStateOf({ live: { id: 'x' }, draft: null }).id).toBe('live');
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
