// cmsPages document helpers shared by the page list and the page editor.
//
// The server (functions/src/cms/pages.cjs validatePageDoc) rejects unknown
// top-level keys BY NAME, and a stored doc carries keys it will not accept
// back: publish-model bookkeeping (status/revision/updatedAt/…) and seed
// bookkeeping (`seeded`, `seededAt`). So a doc loaded for editing is filtered
// down to the accepted key set before it goes back over the wire — otherwise
// every edit of a seeded page would fail with "seeded: unknown field".
import { recordStateOf } from './recordState.js';
import { DEFAULT_SECTION_SLOT, slotOf, statedPageLayout } from '../lib/pageLayout.js';

/** Keys a cmsPages doc may carry (mirrors PAGE_KEYS on the server). */
export const PAGE_KEYS = Object.freeze([
  'id',
  'label',
  'path',
  'icon',
  'order',
  'visible',
  'systemPage',
  'sections',
  'layout',
]);

export const SECTION_KEYS = Object.freeze([
  'id',
  'label',
  'description',
  'allowedBlocks',
  'maxBlocks',
  'reorderable',
  'defaultBlocks',
  'slot',
]);

export const DEFAULT_BLOCK_KEYS = Object.freeze(['field', 'blockType', 'description']);

function pick(source, keys) {
  const out = {};
  for (const key of keys) {
    if (source && Object.prototype.hasOwnProperty.call(source, key)) out[key] = source[key];
  }
  return out;
}

/**
 * Editable form state from a stored (live or draft) cmsPages doc: only the
 * accepted keys, with the shape normalized so the editor's controlled inputs
 * never receive undefined.
 *
 * THE LAYOUT IS THE ONE PLACE ABSENCE IS LOAD-BEARING, so it is carried
 * here as what the document actually states and nothing more. A page that
 * never chose a density is following the active preset's (shared/theme
 * resolveShape, read by SystemPage through statedPageLayout); opening that
 * page filled in with `comfortable` and saving it back would silently
 * commit the page to a density the operator never picked, and it would stop
 * following the preset from then on — a theme change that used to move the
 * page would no longer reach it. One open-and-save of an untouched page did
 * that to all four variants.
 *
 * A missing key is therefore not filled in. The editor's selects show
 * PAGE_LAYOUT_DEFAULTS for whatever the page leaves unstated (the layout a
 * page with no stored value renders at, so the control still shows what the
 * reader sees), and setting one is what makes it stated: presence in this
 * map IS the record of the operator having chosen.
 *
 * @param {object|null} doc
 * @returns {object}
 */
export function toEditablePage(doc) {
  const base = pick(doc ?? {}, PAGE_KEYS);
  return {
    id: base.id ?? '',
    label: base.label ?? '',
    path: base.path ?? '',
    icon: typeof base.icon === 'string' ? base.icon : null,
    order: typeof base.order === 'number' ? base.order : 0,
    visible: base.visible !== false,
    systemPage: base.systemPage === true,
    // What the document states, and only that — see above.
    layout: statedPageLayout(base),
    sections: Array.isArray(base.sections)
      ? base.sections.map((section) => {
          const s = pick(section ?? {}, SECTION_KEYS);
          return {
            id: s.id ?? '',
            label: s.label ?? '',
            description: typeof s.description === 'string' ? s.description : '',
            allowedBlocks: Array.isArray(s.allowedBlocks) ? [...s.allowedBlocks] : [],
            maxBlocks: Number.isInteger(s.maxBlocks) ? s.maxBlocks : 1,
            reorderable: s.reorderable !== false,
            slot: slotOf(s),
            defaultBlocks: Array.isArray(s.defaultBlocks)
              ? s.defaultBlocks.map((block) => {
                  const b = pick(block ?? {}, DEFAULT_BLOCK_KEYS);
                  return {
                    field: b.field ?? '',
                    blockType: b.blockType ?? '',
                    description: typeof b.description === 'string' ? b.description : '',
                  };
                })
              : [],
          };
        })
      : [],
  };
}

/** A blank page for the create form. */
export function blankPage() {
  return toEditablePage({ id: '', label: '', path: '', order: 0, visible: true });
}

/** A blank section, pre-allowing the plainest two block types. */
export function blankSection() {
  return {
    id: '',
    label: '',
    description: '',
    allowedBlocks: ['text', 'richtext'],
    maxBlocks: 6,
    reorderable: true,
    slot: DEFAULT_SECTION_SLOT,
    defaultBlocks: [],
  };
}

/**
 * The wire payload for cmsSavePage. Types are coerced where a form control
 * can only produce strings (order, maxBlocks); `description` is sent as null
 * when blank because the server accepts `string | null` and an empty string
 * is not a meaningful description. Client-side coercion only — validation
 * itself stays on the server, whose messages are surfaced verbatim.
 *
 * @param {object} page editable form state
 * @returns {object} cmsPages doc
 */
export function toPagePayload(page) {
  const order = Number(page.order);
  return {
    id: String(page.id ?? '').trim(),
    label: page.label ?? '',
    path: page.path ?? '',
    icon: page.icon ? String(page.icon) : null,
    order: Number.isFinite(order) ? order : page.order,
    visible: Boolean(page.visible),
    systemPage: Boolean(page.systemPage),
    // Only the variants the page states. A key the document never carried
    // stays absent unless the operator moved that control — saving a page
    // must not decide, on its behalf, four things it never said. `layout`
    // itself is always sent, empty map and all: the server accepts a page
    // that states nothing, and sending the key makes "states nothing" an
    // answer rather than an omission.
    layout: statedPageLayout(page),
    sections: (page.sections ?? []).map((section) => {
      const maxBlocks = Number(section.maxBlocks);
      return {
        id: section.id ?? '',
        label: section.label ?? '',
        description: section.description ? section.description : null,
        allowedBlocks: [...(section.allowedBlocks ?? [])],
        maxBlocks: Number.isInteger(maxBlocks) ? maxBlocks : section.maxBlocks,
        reorderable: Boolean(section.reorderable),
        slot: slotOf(section),
        defaultBlocks: (section.defaultBlocks ?? []).map((block) => ({
          field: block.field ?? '',
          blockType: block.blockType ?? '',
          description: block.description ?? '',
        })),
      };
    }),
  };
}

/**
 * Publish state of one page, from its live doc and its draft sibling.
 * `dirty` is the draft's own status field (store.cjs writes 'dirty' on every
 * draft write and flips it to 'clean' at publish).
 *
 * The WORDS are the admin's three, and they live in one place
 * (admin/recordState.js) so pages, content, speakers, badges, and branding
 * cannot drift into four spellings of the same fact.
 *
 * @param {{ live: object|null, draft: object|null }} revisions
 */
export function publishStateOf({ live, draft }) {
  return recordStateOf({ live, draft });
}

/**
 * Merge live + draft cmsPages rows into one list, newest-editable-first
 * fields taken from the draft (what an editor would open).
 *
 * @param {Array<object>|null} live
 * @param {Array<object>|null} drafts
 */
export function mergePageRevisions(live, drafts) {
  const rows = new Map();
  for (const doc of live ?? []) {
    rows.set(doc.id, { id: doc.id, live: doc, draft: null });
  }
  for (const doc of drafts ?? []) {
    const existing = rows.get(doc.id) ?? { id: doc.id, live: null, draft: null };
    rows.set(doc.id, { ...existing, draft: doc });
  }
  return [...rows.values()]
    .map((row) => ({
      ...row,
      current: row.draft ?? row.live,
      state: publishStateOf(row),
    }))
    .sort((a, b) => {
      const orderA = a.current?.order ?? 0;
      const orderB = b.current?.order ?? 0;
      if (orderA !== orderB) return orderA - orderB;
      return String(a.id).localeCompare(String(b.id));
    });
}
