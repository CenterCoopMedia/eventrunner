// Admin-side mirror of the backend block-type registry
// (functions/src/cms/blockTypes.cjs, spec §5.2). It drives the CMS editor's
// block palette: which block types a section may allow, and which fields a
// block of each type carries.
//
// The backend registry is CommonJS inside the functions workspace and is not
// importable from the browser bundle, so this is a deliberate mirror —
// blockTypes.test.js imports the backend module and asserts exact parity
// (ids, labels, descriptions, and field lists), the same contract-by-test
// pattern components/blocks/registry.jsx already uses for renderers.
export const BLOCK_TYPES = Object.freeze({
  text: {
    id: 'text',
    label: 'Text',
    description: 'A single plain-text value: headings, labels, short copy.',
    fields: [{ id: 'value', type: 'string', required: true }],
  },
  richtext: {
    id: 'richtext',
    label: 'Rich text',
    description: 'Formatted body copy rendered by the rich-text renderer.',
    fields: [{ id: 'value', type: 'richtext', required: true }],
  },
  image: {
    id: 'image',
    label: 'Image',
    description: 'An image by URL. Alt text is required, not optional.',
    fields: [
      { id: 'url', type: 'url', required: true },
      { id: 'alt', type: 'string', required: true },
      { id: 'caption', type: 'string', required: false },
    ],
  },
  cta: {
    id: 'cta',
    label: 'Call to action',
    description: 'A button or prominent link: label plus destination.',
    fields: [
      { id: 'label', type: 'string', required: true },
      { id: 'url', type: 'url', required: true },
      { id: 'external', type: 'boolean', required: false },
    ],
  },
  stat: {
    id: 'stat',
    label: 'Statistic',
    description:
      'A number that carries evidence: the figure and its caption, plus the four parts ' +
      'every stat must state — the finding in words, what it counts, where it came from, ' +
      'and what a screen reader hears. All six are required to write one.',
    fields: [
      { id: 'value', type: 'string', required: true },
      { id: 'label', type: 'string', required: true },
      { id: 'takeaway', type: 'string', required: true },
      { id: 'description', type: 'string', required: true },
      { id: 'source', type: 'string', required: true },
      { id: 'alt', type: 'string', required: true },
      { id: 'order', type: 'number', required: false },
    ],
  },
  list_item: {
    id: 'list_item',
    label: 'List item',
    description: 'One entry in an ordered content list.',
    fields: [
      { id: 'text', type: 'string', required: true },
      { id: 'order', type: 'number', required: false },
    ],
  },
  faq_item: {
    id: 'faq_item',
    label: 'FAQ item',
    description: 'A question with its rich-text answer.',
    fields: [
      { id: 'question', type: 'string', required: true },
      { id: 'answer', type: 'richtext', required: true },
      { id: 'order', type: 'number', required: false },
    ],
  },
  link_group: {
    id: 'link_group',
    label: 'Link group',
    description: 'A titled link within a named group (footers, resource lists).',
    fields: [
      { id: 'group', type: 'string', required: true },
      { id: 'label', type: 'string', required: true },
      { id: 'url', type: 'url', required: true },
      { id: 'order', type: 'number', required: false },
    ],
  },
});

/**
 * What to write in each part of the stat contract (design brief §2.1.1),
 * shown under that field in the block editor. The server enforces the same
 * parts and rejects a write that misses one (blockTypes.cjs
 * statContractErrors); blockTypes.test.js pins the two field sets together,
 * so the editor can never prompt for a part the server ignores, or stay
 * silent about one it demands.
 */
export const STAT_CONTRACT_HINTS = Object.freeze({
  value: 'The figure itself, as it should read. “420”, “2×”, “68%”.',
  label: 'Caption the figure in a few words. “Attendees expected”.',
  takeaway: 'State the finding in words. “Two thirds of sessions are workshops”, not “Session types”.',
  description: 'Say what the number counts, and over what period.',
  source: 'Name where the number came from, and the date you read it.',
  alt: 'Describe the finding for a screen reader. Do not describe the shape of the chart.',
});

/** Registry order — the palette's display order. */
export const BLOCK_TYPE_IDS = Object.freeze(Object.keys(BLOCK_TYPES));

/** @param {unknown} id @returns {object|null} */
export function blockTypeFor(id) {
  return typeof id === 'string' &&
    Object.prototype.hasOwnProperty.call(BLOCK_TYPES, id)
    ? BLOCK_TYPES[id]
    : null;
}

/** Human label for a block type id; the raw id for unknown ones. */
export function blockTypeLabel(id) {
  return blockTypeFor(id)?.label ?? String(id);
}

/** One-line summary of the fields a block of this type carries. */
export function blockTypeFieldSummary(id) {
  const type = blockTypeFor(id);
  if (!type) return '';
  return type.fields
    .map((f) => `${f.id} (${f.type}${f.required ? '' : ', optional'})`)
    .join(' · ');
}
