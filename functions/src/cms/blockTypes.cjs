'use strict';

/**
 * Code-resident CMS registries (spec §5.2, §8.4).
 *
 * BLOCK_TYPES stays in code — not Firestore — because each block type is a
 * contract with a React renderer: a block type with no renderer is a
 * broken page, and Firestore cannot supply a component. `cmsSavePage`
 * validates `allowedBlocks` and `defaultBlocks[].blockType` against this
 * registry and rejects unknown ids, so adding a type here is the whole
 * server-side story; the matching renderer lands in apps/web.
 *
 * Field `type` vocabulary is closed: 'string' | 'richtext' | 'url' |
 * 'number' | 'boolean'. Content validators key off it, so a new field
 * type is a registry change plus a validator change, never a data-only
 * addition.
 *
 * PUBLISHABLE_COLLECTIONS is the closed set of collections under the
 * two-revision publish model (§8.4): each live collection `C` has a draft
 * sibling `C_drafts` that only admins can read. Publish/unpublish/delete
 * code must derive draft names via draftCollectionFor so a typo is a
 * thrown error, not a silent write to a brand-new collection.
 */

const FIELD_TYPES = Object.freeze(['string', 'richtext', 'url', 'number', 'boolean']);

/** @param {string} id @param {'string'|'richtext'|'url'|'number'|'boolean'} type @param {boolean} required */
function field(id, type, required) {
  return Object.freeze({ id, type, required });
}

function blockType(def) {
  return Object.freeze({ ...def, fields: Object.freeze(def.fields) });
}

/**
 * v1 block-type registry. Keys are the canonical block type ids stored in
 * cmsContent docs and cmsPages section definitions.
 */
const BLOCK_TYPES = Object.freeze({
  text: blockType({
    id: 'text',
    label: 'Text',
    description: 'A single plain-text value: headings, labels, short copy.',
    fields: [field('value', 'string', true)],
  }),
  richtext: blockType({
    id: 'richtext',
    label: 'Rich text',
    description: 'Formatted body copy rendered by the rich-text renderer.',
    fields: [field('value', 'richtext', true)],
  }),
  image: blockType({
    id: 'image',
    label: 'Image',
    description: 'An image by URL. Alt text is required, not optional.',
    fields: [
      field('url', 'url', true),
      field('alt', 'string', true),
      field('caption', 'string', false),
    ],
  }),
  cta: blockType({
    id: 'cta',
    label: 'Call to action',
    description: 'A button or prominent link: label plus destination.',
    fields: [
      field('label', 'string', true),
      field('url', 'url', true),
      field('external', 'boolean', false),
    ],
  }),
  stat: blockType({
    id: 'stat',
    label: 'Statistic',
    description: 'A headline number with its caption, e.g. "450 / attendees".',
    fields: [
      field('value', 'string', true),
      field('label', 'string', true),
      field('order', 'number', false),
    ],
  }),
  list_item: blockType({
    id: 'list_item',
    label: 'List item',
    description: 'One entry in an ordered content list.',
    fields: [
      field('text', 'string', true),
      field('order', 'number', false),
    ],
  }),
  faq_item: blockType({
    id: 'faq_item',
    label: 'FAQ item',
    description: 'A question with its rich-text answer.',
    fields: [
      field('question', 'string', true),
      field('answer', 'richtext', true),
      field('order', 'number', false),
    ],
  }),
  link_group: blockType({
    id: 'link_group',
    label: 'Link group',
    description: 'A titled link within a named group (footers, resource lists).',
    fields: [
      field('group', 'string', true),
      field('label', 'string', true),
      field('url', 'url', true),
      field('order', 'number', false),
    ],
  }),
});

/**
 * True only for ids defined in BLOCK_TYPES. Own-property check, so
 * prototype names ('toString') and non-strings are never "known".
 *
 * @param {unknown} id
 * @returns {boolean}
 */
function isKnownBlockType(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(BLOCK_TYPES, id);
}

/** The closed set of collections under the two-revision publish model (§8.4). */
const PUBLISHABLE_COLLECTIONS = Object.freeze([
  'cmsContent',
  'cmsSchedule',
  'cmsOrganizations',
  'cmsTimeline',
  'cmsUpdates',
  'cmsPages',
]);

/**
 * Draft sibling name for a publishable collection. Throws on anything
 * outside PUBLISHABLE_COLLECTIONS — publish paths must fail loudly rather
 * than write drafts for a collection the rules do not protect.
 *
 * @param {string} name
 * @returns {string} `<name>_drafts`
 */
function draftCollectionFor(name) {
  if (!PUBLISHABLE_COLLECTIONS.includes(name)) {
    throw new Error(`Not a publishable collection: ${String(name)}`);
  }
  return `${name}_drafts`;
}

module.exports = {
  BLOCK_TYPES,
  isKnownBlockType,
  PUBLISHABLE_COLLECTIONS,
  draftCollectionFor,
  internals: { FIELD_TYPES },
};
