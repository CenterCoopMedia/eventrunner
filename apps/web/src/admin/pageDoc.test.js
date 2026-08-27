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
import { PAGE_TEMPLATES, PAGE_TEMPLATE_IDS, templateLayout } from '../lib/pageTemplates.js';
import * as templatesCjs from '../../../../functions/src/cms/pageTemplates.cjs';

const backend = pagesCjs.default ?? pagesCjs;
const templatesBackend = templatesCjs.default ?? templatesCjs;

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

  // A template is a named bundle of layout values, and the two copies of
  // the catalogue must not drift: the server rejects an unknown id by name,
  // and the editor is what applies the bundle. Same contract-by-test rule
  // the block registry and the layout enums follow.
  it('mirrors the page templates the server accepts, ids and bundles alike', () => {
    expect([...PAGE_TEMPLATE_IDS]).toEqual([...templatesBackend.PAGE_TEMPLATE_IDS]);
    expect([...PAGE_TEMPLATE_IDS]).toEqual([...backend.PAGE_TEMPLATE_IDS]);
    for (const id of PAGE_TEMPLATE_IDS) {
      expect(templateLayout(id)).toEqual({ ...templatesBackend.PAGE_TEMPLATE_LAYOUTS[id] });
    }
  });

  it('gives every template an answer for every variant the system has', () => {
    // A template that left one unstated would leave the page half-following
    // the preset, which is the state templates exist to prevent. Navigation
    // is deliberately absent: it is a site setting, not a page one.
    for (const id of PAGE_TEMPLATE_IDS) {
      expect(Object.keys(PAGE_TEMPLATES[id].layout).sort()).toEqual([
        'arrangement',
        'density',
        'header',
      ]);
      for (const [key, value] of Object.entries(PAGE_TEMPLATES[id].layout)) {
        expect(PAGE_LAYOUT_VALUES[key]).toContain(value);
      }
      expect(PAGE_TEMPLATES[id].label).toBeTruthy();
      expect(PAGE_TEMPLATES[id].description).toBeTruthy();
    }
  });

  it('gives the six templates six distinct shapes', () => {
    const shapes = PAGE_TEMPLATE_IDS.map((id) => JSON.stringify(PAGE_TEMPLATES[id].layout));
    expect(new Set(shapes).size).toBe(PAGE_TEMPLATE_IDS.length);
  });

  it('accepts a page that names a template, and rejects one that names a stranger', () => {
    const page = toEditablePage({ ...STORED, template: 'long-read' });
    expect(page.template).toBe('long-read');
    expect(backend.validatePageDoc(toPagePayload(page)).errors).toEqual([]);

    const invented = { ...toPagePayload(page), template: 'poster' };
    expect(backend.validatePageDoc(invented).errors).toEqual([
      `template: must be one of ${PAGE_TEMPLATE_IDS.join(', ')}, got "poster"`,
    ]);
  });

  it('reads no template where none was named, and never infers one', () => {
    // These are "Long read"'s three values exactly. The page still has not
    // chosen Long read; it has three values that coincide.
    const coincidence = { ...STORED, layout: { ...PAGE_TEMPLATES['long-read'].layout } };
    expect(toEditablePage(coincidence).template).toBeNull();
    expect(toPagePayload(toEditablePage(coincidence)).template).toBeNull();
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
  // Absence is a fact about the page, not a gap to fill: a page that never
  // chose a density follows the active preset's, and an open-and-save must
  // not quietly commit it to one.
  it('opens a page with no stored layout stating nothing', () => {
    expect(toEditablePage(STORED).layout).toEqual({});
  });

  it('keeps a stored layout and invents nothing around it', () => {
    const page = toEditablePage({ ...STORED, layout: { arrangement: 'grid' } });
    expect(page.layout).toEqual({ arrangement: 'grid' });
  });

  it('still reads a navPlacement a page stored before the setting moved', () => {
    // The editor stopped offering it; the reader did not stop reading it.
    // A deployment that set it per page keeps rendering what it rendered,
    // and a save of that page does not drop the value on the floor.
    const page = toEditablePage({ ...STORED, layout: { navPlacement: 'side' } });
    expect(page.layout).toEqual({ navPlacement: 'side' });
    expect(toPagePayload(page).layout).toEqual({ navPlacement: 'side' });
    expect(backend.validatePageDoc(toPagePayload(page)).errors).toEqual([]);
  });

  it('drops a stored value the system does not recognize', () => {
    const page = toEditablePage({ ...STORED, layout: { density: 'airy', arrangement: 'grid' } });
    expect(page.layout).toEqual({ arrangement: 'grid' });
  });

  it('round-trips absence: opening and saving states nothing new', () => {
    expect(toPagePayload(toEditablePage(STORED)).layout).toEqual({});
    // …and the key is still sent, so "states nothing" is an answer.
    expect(toPagePayload(toEditablePage(STORED))).toHaveProperty('layout');
  });

  it('sends what the operator changed, and only that', () => {
    const page = toEditablePage(STORED);
    // What the editor's onChange does: set the one key the select moved.
    page.layout = { ...page.layout, arrangement: 'grid' };
    expect(toPagePayload(page).layout).toEqual({ arrangement: 'grid' });
  });

  it('keeps a stated value stated across a round trip', () => {
    const stored = { ...STORED, layout: { density: 'tight' } };
    const payload = toPagePayload(toEditablePage(stored));
    expect(payload.layout).toEqual({ density: 'tight' });
    // A page that states the default value still states it.
    const explicit = { ...STORED, layout: { density: PAGE_LAYOUT_DEFAULTS.density } };
    expect(toPagePayload(toEditablePage(explicit)).layout)
      .toEqual({ density: PAGE_LAYOUT_DEFAULTS.density });
  });

  it('reads a section with no slot as main, and sends it back whole', () => {
    const page = toEditablePage(STORED);
    expect(page.sections[0].slot).toBe('main');
    expect(toPagePayload(page).sections[0].slot).toBe('main');
  });

  it('sends a layout the server accepts, stated or not', () => {
    for (const layout of [undefined, { density: 'tight' }, { header: 'nameplate-compact' }]) {
      const verdict = backend.validatePageDoc(toPagePayload(toEditablePage({ ...STORED, layout })));
      expect(verdict.errors).toEqual([]);
    }
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
