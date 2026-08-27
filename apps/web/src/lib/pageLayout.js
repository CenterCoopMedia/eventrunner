// Page layout variants and section slots (design brief §6.1, §6.2).
//
// A system page keeps its core feature component and gains two things: a
// page-level `layout` object that changes its shape from data, and a `slot`
// on each section that says where that section renders relative to the core.
//
// This module is the browser-side vocabulary: the enum values, the defaults,
// and the readers a renderer uses. The server's copy lives in
// functions/src/cms/pages.cjs (validatePageDoc), which rejects an unknown
// value BY NAME on write; pageDoc.test.js pins the two lists together, the
// same contract-by-test pattern blockTypes.js uses for the block registry.
//
// The readers here are deliberately forgiving where the validator is strict.
// A validator guards what gets written; a renderer meets what is already
// stored — including documents written before this schema existed. So a
// missing `layout` reads as the defaults, a missing `slot` reads as `main`,
// and an unrecognized value falls back rather than throwing. That is what
// "existing documents keep working with no migration" means in the reader.

/** The four layout variants a page may set, in editor order. */
export const PAGE_LAYOUT_KEYS = Object.freeze(['header', 'arrangement', 'density', 'navPlacement']);

/**
 * What each variant may say.
 *
 * `header` has no `none` on purpose (brief §6.2): every public page carries a
 * nameplate, so `nameplate-compact` is the minimum. A page that renders no
 * header at all is not a layout variant — it is a page that lost its
 * identity, and the write is rejected.
 */
export const PAGE_LAYOUT_VALUES = Object.freeze({
  header: Object.freeze(['nameplate', 'nameplate-compact']),
  arrangement: Object.freeze(['grid', 'list']),
  density: Object.freeze(['tight', 'comfortable', 'loose']),
  navPlacement: Object.freeze(['top', 'side']),
});

/**
 * The layout a page with no stored `layout` renders at: the shape every page
 * had before this schema landed. Nothing migrates, and no seeded page
 * changes shape on upgrade.
 */
export const PAGE_LAYOUT_DEFAULTS = Object.freeze({
  header: 'nameplate',
  arrangement: 'list',
  density: 'comfortable',
  navPlacement: 'top',
});

/** Where a section renders relative to the core feature component. */
export const SECTION_SLOTS = Object.freeze(['above', 'main', 'below']);

/**
 * `main` is the default, and it has stated semantics (brief §6.2): on a
 * system page, `main` sections render immediately after the core component
 * and before every `below` section. The order down the page is nameplate,
 * `above`, core, `main`, `below`. A section stored before this schema landed
 * carries no slot, reads as `main`, and renders where it always did.
 */
export const DEFAULT_SECTION_SLOT = 'main';

/** @param {unknown} doc @returns {object} the doc's `layout` map, or {} */
function layoutMapOf(doc) {
  const layout = doc?.layout;
  return layout && typeof layout === 'object' && !Array.isArray(layout) ? layout : {};
}

/**
 * Only the variants this document actually states with a value the system
 * recognizes. Use it where "the page said nothing" and "the page said the
 * default" are different facts — `density`, most of all: the active preset
 * states its own density (shared/theme resolveShape), so a page that never
 * chose one must not be read as having chosen `comfortable`.
 *
 * @param {object|null} doc a cmsPages document
 * @returns {Partial<typeof PAGE_LAYOUT_DEFAULTS>}
 */
export function statedPageLayout(doc) {
  const stored = layoutMapOf(doc);
  const stated = {};
  for (const key of PAGE_LAYOUT_KEYS) {
    if (PAGE_LAYOUT_VALUES[key].includes(stored[key])) stated[key] = stored[key];
  }
  return stated;
}

/**
 * The complete layout to render this page at: what it states, over the
 * defaults for everything it does not.
 *
 * @param {object|null} doc a cmsPages document
 * @returns {{ header: string, arrangement: string, density: string, navPlacement: string }}
 */
export function resolvePageLayout(doc) {
  return { ...PAGE_LAYOUT_DEFAULTS, ...statedPageLayout(doc) };
}

/**
 * The slot one section renders in. Anything unrecognized reads as `main`,
 * which is also what an absent slot means.
 *
 * @param {object|null} section
 * @returns {'above'|'main'|'below'}
 */
export function slotOf(section) {
  return SECTION_SLOTS.includes(section?.slot) ? section.slot : DEFAULT_SECTION_SLOT;
}

/**
 * A page's sections grouped by slot, each group in the page's own section
 * order. Render them nameplate → above → core → main → below (brief §6.2).
 *
 * @param {Array<object>|null} sections
 * @returns {{ above: object[], main: object[], below: object[] }}
 */
export function sectionsBySlot(sections) {
  const grouped = { above: [], main: [], below: [] };
  for (const section of sections ?? []) grouped[slotOf(section)].push(section);
  return grouped;
}
