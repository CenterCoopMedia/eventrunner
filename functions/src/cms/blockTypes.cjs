'use strict';

const { hasRichTextContent } = require('shared/richText');
const { googleMapsEmbedUrl } = require('shared/urlSafety');
const { isMediaLibraryPath, storageObjectPath } = require('shared/venue');

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
 * 'number' | 'boolean' | 'images'. Content validators key off it, so a new field
 * type is a registry change plus a validator change, never a data-only
 * addition.
 *
 * PUBLISHABLE_COLLECTIONS is the closed set of collections under the
 * two-revision publish model (§8.4): each live collection `C` has a draft
 * sibling `C_drafts` that only admins can read. Publish/unpublish/delete
 * code must derive draft names via draftCollectionFor so a typo is a
 * thrown error, not a silent write to a brand-new collection.
 */

const FIELD_TYPES = Object.freeze(['string', 'richtext', 'url', 'number', 'boolean', 'images']);

/** @param {string} id @param {'string'|'richtext'|'url'|'number'|'boolean'|'images'} type @param {boolean} required @param {string[]} [choices] */
function field(id, type, required, choices) {
  return Object.freeze(choices ? { id, type, required, choices: Object.freeze(choices) } : { id, type, required });
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
    label: 'Short text',
    description: 'A single plain-text value: Headings, labels, short copy.',
    fields: [field('value', 'string', true)],
  }),
  richtext: blockType({
    id: 'richtext',
    label: 'Paragraphs',
    description: 'Formatted body copy rendered by the rich-text renderer.',
    fields: [field('value', 'richtext', true)],
  }),
  image: blockType({
    id: 'image',
    label: 'Image',
    description:
      'An image by URL. Alt text is required, not optional. focalX and focalY name ' +
      'the part of the picture a fixed crop must keep, as percentages from the top ' +
      'left; both default to the centre.',
    fields: [
      field('url', 'url', true),
      field('alt', 'string', true),
      field('caption', 'string', false),
      field('focalX', 'number', false),
      field('focalY', 'number', false),
      field('size', 'string', false, ['full', 'small', 'medium', 'large']),
      field('alignment', 'string', false, ['left', 'center', 'right']),
    ],
  }),
  map: blockType({
    id: 'map',
    label: 'Map',
    description: 'An interactive Google map with an optional street address.',
    fields: [
      field('useEventVenue', 'boolean', false),
      field('embedUrl', 'url', true),
      field('label', 'string', true),
      field('address', 'string', false),
    ],
  }),
  cta: blockType({
    id: 'cta',
    label: 'Button',
    description: 'A button or prominent link: Label plus destination.',
    fields: [
      field('label', 'string', true),
      field('url', 'url', true),
      field('external', 'boolean', false),
    ],
  }),
  stat: blockType({
    id: 'stat',
    label: 'Number',
    description:
      'A number that carries evidence: The figure and its caption, plus the four parts ' +
      'every stat must state — the finding in words, what it counts, where it came from, ' +
      'and what a screen reader hears. All six are required to write one.',
    fields: [
      field('value', 'string', true),
      field('label', 'string', true),
      field('takeaway', 'string', true),
      field('description', 'string', true),
      field('source', 'string', true),
      field('alt', 'string', true),
      field('order', 'number', false),
    ],
  }),
  fact: blockType({
    id: 'fact',
    label: 'Fact',
    description:
      'A fact that is not a number: The term, its description, and one optional line ' +
      'under it. Where, who, format, room. A fact names no source and counts nothing, ' +
      'so it carries none of the evidence parts a statistic must.',
    fields: [
      field('label', 'string', true),
      field('value', 'string', true),
      field('note', 'string', false),
      field('order', 'number', false),
    ],
  }),
  quote: blockType({
    id: 'quote',
    label: 'Quote',
    description:
      'A quoted sentence from a speaker or a session, with who said it. The first on a page ' +
      'is set as the pull quote; any other is set as a plain quotation.',
    fields: [
      field('text', 'string', true),
      field('attribution', 'string', false),
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
    label: 'Question and answer',
    description: 'A question with its rich-text answer.',
    fields: [
      field('question', 'string', true),
      field('answer', 'richtext', true),
      field('order', 'number', false),
    ],
  }),
  link_group: blockType({
    id: 'link_group',
    label: 'Link',
    description: 'A titled link within a named group (footers, resource lists).',
    fields: [
      field('group', 'string', true),
      field('label', 'string', true),
      field('url', 'url', true),
      field('order', 'number', false),
    ],
  }),
  gallery: blockType({
    id: 'gallery',
    label: 'Gallery',
    description:
      'Several pictures from the media library, shown as a grid, a carousel or a slideshow. ' +
      'Every picture needs alt text. label names the gallery for screen readers.',
    fields: [
      field('images', 'images', true),
      field('layout', 'string', true),
      field('label', 'string', false),
    ],
  }),
  sponsor_package: blockType({
    id: 'sponsor_package',
    label: 'Sponsor package',
    description:
      'One sponsorship package for the sponsors page: Its name, its price, how many sponsors ' +
      'can take it, and what it includes.',
    fields: [
      field('name', 'string', true),
      field('price', 'string', false),
      field('limit', 'number', false),
      field('benefits', 'richtext', true),
      field('order', 'number', false),
    ],
  }),
});

/**
 * The stat write contract (design brief §2.1.1), field by field, with the
 * sentence that says what each part is for.
 *
 * SIX PARTS, NOT FOUR. The four evidence parts are what make a number a
 * stat rather than a decoration, and they were enforced from PR3 on — but
 * the figure and its caption were left out of the check even though the
 * registry marks both required, so a block could be written with a
 * takeaway, a description, a source and alt text and NO NUMBER: a stat
 * block with nothing to show. StatBlock renders whatever it is given, so
 * that document reaches a reader as a caption with a hole where the figure
 * should be. All six are the contract for a block being created or edited.
 *
 * The words are the operator's, not the schema's: a rejection has to tell
 * whoever is writing the block what to write.
 */
const STAT_CONTRACT = Object.freeze({
  value: 'carry the figure itself',
  label: 'caption the figure in a few words',
  takeaway: 'state the finding in words, not the category',
  description: 'say what the number counts and over what period',
  source: 'name where the number came from and the date you read it',
  alt: 'describe the finding for a screen reader',
});

/** The gallery layouts a reader can be shown. Stored as one of these ids. */
const GALLERY_LAYOUTS = Object.freeze(['grid', 'carousel', 'slideshow']);
const GALLERY_MAX_IMAGES = 24;
/** Mirrors functions/src/media/upload.cjs MAX_ALT_LENGTH. */
const GALLERY_MAX_ALT_LENGTH = 500;
const GALLERY_IMAGE_KEYS = Object.freeze(['url', 'alt']);

/**
 * The gallery contract: a layout from the fixed set, and 1 to 24 pictures,
 * each a media library path with its own alt text and nothing else. The
 * renderer draws only this shape, so a stored gallery cannot carry a link,
 * a script or a layout the page does not have.
 *
 * Pure, and a no-op for every other block type.
 *
 * @param {object} fields the block's fields as they will be stored
 * @returns {string[]}
 */
function galleryErrors(fields) {
  if (!fields || fields.blockType !== 'gallery') return [];
  const errors = [];
  if (fields.layout !== undefined && !GALLERY_LAYOUTS.includes(fields.layout)) {
    errors.push(`layout: must be one of ${GALLERY_LAYOUTS.join(', ')}.`);
  }
  const { images } = fields;
  if (images === undefined) return errors;
  if (!Array.isArray(images)) return [...errors, 'images: must be a list of pictures.'];
  if (images.length > GALLERY_MAX_IMAGES) {
    errors.push(`images: a gallery holds at most ${GALLERY_MAX_IMAGES} pictures.`);
  }
  images.forEach((image, index) => {
    const at = `images.${index + 1}`;
    if (!image || typeof image !== 'object' || Array.isArray(image)) {
      errors.push(`${at}: must be a picture.`);
      return;
    }
    const extra = Object.keys(image).filter((key) => !GALLERY_IMAGE_KEYS.includes(key));
    if (extra.length) errors.push(`${at}: unknown ${extra.join(', ')}.`);
    const path = storageObjectPath(image.url);
    if (!path || path !== image.url || !isMediaLibraryPath(path) || path.split('/').length < 3) {
      errors.push(`${at}.url: choose the picture from the media library.`);
    }
    if (typeof image.alt !== 'string' || !image.alt.trim()) {
      errors.push(`${at}.alt: every picture needs alt text.`);
    } else if (image.alt.length > GALLERY_MAX_ALT_LENGTH) {
      errors.push(`${at}.alt: keep alt text under ${GALLERY_MAX_ALT_LENGTH} characters.`);
    }
  });
  return errors;
}

/**
 * Every missing part of the stat contract, each naming its field.
 *
 * ENFORCED AT THE WRITE, NOT AT THE READ. A stat block already stored in
 * the legacy `{ value, label }` shape stays valid, keeps publishing, and
 * keeps rendering (StatBlock renders both shapes) — nothing sweeps the
 * corpus and nothing drops content. What this stops is a stat block being
 * WRITTEN without its parts, from PR3 on.
 *
 * Pure, and a no-op for every other block type.
 *
 * @param {object} fields the block's fields as they will be stored
 * @returns {string[]}
 */
function statContractErrors(fields) {
  if (!fields || fields.blockType !== 'stat') return [];
  return Object.entries(STAT_CONTRACT)
    .filter(([id]) => typeof fields[id] !== 'string' || fields[id].trim().length === 0)
    .map(([id, why]) => `${id}: a stat block must ${why}`);
}

/**
 * Required fields and allowed choices, derived from the same registry the
 * page and editor use. This runs at the server write boundary so an editor,
 * a restore, and a direct endpoint call all meet the same rule.
 *
 * The stat contract keeps its more useful field-specific wording. Every
 * other block type uses the registry's `required` flags directly.
 *
 * @param {object} fields the block's fields as they will be stored
 * @returns {string[]}
 */
function requiredBlockErrors(fields) {
  const blockType = fields?.blockType;
  if (!isKnownBlockType(blockType)) {
    return ['blockType: must name a known block type.'];
  }
  if (blockType === 'stat') return statContractErrors(fields);
  if (blockType === 'map') {
    const errors = [];
    const { useEventVenue, embedUrl, label, address } = fields;
    if (useEventVenue !== undefined && typeof useEventVenue !== 'boolean') {
      errors.push('useEventVenue: must be a boolean.');
    }
    if (useEventVenue === true && embedUrl !== undefined) {
      errors.push('embedUrl: remove the copied link when using the event venue.');
    }
    if (useEventVenue !== true && (!embedUrl || googleMapsEmbedUrl(embedUrl) !== embedUrl)) {
      errors.push('embedUrl: paste an embed link from Google Maps.');
    }
    if (typeof label !== 'string' || !label.trim()) {
      errors.push('label: describe what the map shows.');
    }
    if (address !== undefined && typeof address !== 'string') {
      errors.push('address: enter the address as text or leave it empty.');
    }
    return errors;
  }
  const blockFields = BLOCK_TYPES[blockType].fields;
  const choiceErrors = blockFields
    .filter(({ id, choices }) => choices && fields[id] != null && !choices.includes(fields[id]))
    .map(({ id, choices }) => `${id}: choose ${choices.join(', ')}.`);
  const missingErrors = blockFields
    .filter((entry) => entry.required && entry.type !== 'boolean')
    .filter((entry) => {
      if (entry.type === 'richtext') return !hasRichTextContent(fields[entry.id]);
      if (entry.type === 'images') return !Array.isArray(fields[entry.id]) || fields[entry.id].length === 0;
      return fields[entry.id] === undefined
        || fields[entry.id] === null
        || String(fields[entry.id]).trim().length === 0;
    })
    .map((entry) => `${entry.id}: is required for block type "${blockType}".`);
  return [...missingErrors, ...choiceErrors, ...galleryErrors(fields)];
}

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
  requiredBlockErrors,
  statContractErrors,
  galleryErrors,
  GALLERY_LAYOUTS,
  PUBLISHABLE_COLLECTIONS,
  draftCollectionFor,
  internals: { FIELD_TYPES, STAT_CONTRACT, GALLERY_MAX_IMAGES },
};
