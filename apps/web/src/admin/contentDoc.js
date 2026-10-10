// cmsContent document helpers for the content-block editor (issue #61).
//
// A cmsContent doc is keyed `<section>__<field>` (functions/src/cms/
// content.cjs) and carries `section`, `field`, and `blockType` as ordinary
// content fields plus whatever value fields that block type's registry
// entry (blockTypes.js) declares. This module gives the editor a stable,
// typed form shape and immediate field feedback. The server repeats the
// required-field contract at the write boundary.
import { blockTypeFor } from './blockTypes.js';
import { hasRichTextContent } from 'shared/richText';

/**
 * Mirrors functions/src/cms/content.cjs's DELETE_FIELD_SENTINEL exactly (a
 * parity test in contentDoc.test.js pins the two literals together, the
 * same way blockTypes.js mirrors the backend's BLOCK_TYPES registry). A
 * cmsContent doc's fields are addressed generically — cmsUpdateContent
 * merges whatever `fields` a caller sends onto the prior draft/live doc's
 * fields, so a partial edit never has to resend everything — but that
 * means switching a block's type here would otherwise leave the OLD type's
 * value fields (an faq_item's `answer`, a cta's `url`, …) stranded on the
 * doc forever. Setting one of those stale keys to this sentinel tells the
 * server to drop it instead of carrying it forward.
 */
export const DELETE_FIELD_SENTINEL = '__cms_delete_field__';

/**
 * A block type's EDITABLE value fields — everything the registry declares
 * except `order`. `order` is real registry data for stat/list_item/
 * link_group, but the editor exposes exactly one Order control shared by
 * every block type (it is also how blocks without a registry `order` field
 * get sorted — see SectionBlocks/getSectionBlocks), so folding it into the
 * generic per-type loop would render two divergent "Order" inputs bound to
 * two different pieces of state.
 *
 * @param {string} blockTypeId
 */
export function valueFieldsOf(blockTypeId) {
  const type = blockTypeFor(blockTypeId);
  return (type?.fields ?? []).filter((field) => field.id !== 'order');
}

/** A blank `values` map for a block type: '' for text-ish fields, false for booleans. */
export function blankContentValues(blockTypeId) {
  const values = {};
  for (const field of valueFieldsOf(blockTypeId)) {
    values[field.id] = field.type === 'boolean' ? false : '';
  }
  return values;
}

/**
 * Editable form state for a stored (live or draft) cmsContent doc, or a
 * fresh one when `doc` is nullish. Reads the block type's fields off the
 * doc directly rather than assuming any particular set, so switching block
 * types never carries stale values from the previous type along.
 *
 * @param {object|null} doc
 * @param {string} [blockTypeId] overrides `doc.blockType` (e.g. when a
 *   block type is chosen before any doc exists)
 */
export function toEditableContent(doc, blockTypeId) {
  const resolvedType = blockTypeId ?? doc?.blockType ?? '';
  const values = {};
  for (const field of valueFieldsOf(resolvedType)) {
    const raw = doc?.[field.id];
    if (field.type === 'boolean') values[field.id] = raw === true;
    else if (field.type === 'number') values[field.id] = typeof raw === 'number' ? raw : '';
    else values[field.id] = typeof raw === 'string' ? raw : '';
  }
  return {
    blockType: resolvedType,
    order: typeof doc?.order === 'number' ? doc.order : '',
    visible: doc?.visible !== false,
    values,
  };
}

/** A blank editable state for the create form, optionally pre-selecting a block type. */
export function blankContent(blockTypeId = '') {
  return {
    blockType: blockTypeId,
    order: '',
    visible: true,
    values: blankContentValues(blockTypeId),
  };
}

/**
 * The `fields` object cmsCreateContent/cmsUpdateContent expect: blockType,
 * an optional numeric order, and each of the block type's own value fields
 * coerced from the form's string/boolean state. `visible` travels as a
 * separate top-level request field (spec §8.4), not inside `fields`.
 *
 * @param {{ blockType: string, order: number|string, values: object }} content
 * @returns {object}
 */
export function toContentFields(content) {
  const fields = { blockType: content.blockType };
  if (content.order !== '' && content.order !== null && content.order !== undefined) {
    const order = Number(content.order);
    fields.order = Number.isFinite(order) ? order : content.order;
  }
  for (const field of valueFieldsOf(content.blockType)) {
    const raw = content.values?.[field.id];
    if (field.type === 'boolean') {
      fields[field.id] = Boolean(raw);
    } else if (field.type === 'number') {
      // A blank number is a deletion, not an omission. cmsUpdateContent
      // merges the payload onto the stored draft, so a key left out keeps
      // its old value: a cleared sponsor package limit went on printing
      // "Open to 3 sponsors", and a cleared focal point kept its crop. A
      // create drops the sentinel (omitDeletedFields), so a new block
      // simply has no value for the field.
      if (raw === '' || raw === null || raw === undefined) {
        fields[field.id] = DELETE_FIELD_SENTINEL;
        continue;
      }
      const n = Number(raw);
      fields[field.id] = Number.isFinite(n) ? n : raw;
    } else {
      fields[field.id] = raw ?? '';
    }
  }
  return fields;
}

/**
 * DELETE_FIELD_SENTINEL entries for a PRIOR block type's value fields that
 * the NEW block type does not also declare — the payload addition that
 * makes switching a block's type actually drop the old type's now-stale
 * fields (an faq_item's `answer`, a cta's `url`, …) instead of leaving them
 * merged onto the draft by cmsUpdateContent forever. Nothing to clear when
 * there is no prior type, or it didn't change.
 *
 * @param {string|null} priorBlockTypeId the type last persisted for this doc
 * @param {string} nextBlockTypeId the type about to be saved
 * @returns {object} `{ [staleFieldId]: DELETE_FIELD_SENTINEL, ... }`
 */
export function staleFieldDeletions(priorBlockTypeId, nextBlockTypeId) {
  if (!priorBlockTypeId || priorBlockTypeId === nextBlockTypeId) return {};
  const keep = new Set(valueFieldsOf(nextBlockTypeId).map((field) => field.id));
  const deletions = {};
  for (const field of valueFieldsOf(priorBlockTypeId)) {
    if (!keep.has(field.id)) deletions[field.id] = DELETE_FIELD_SENTINEL;
  }
  return deletions;
}

/**
 * Client-side required-field check for the chosen block type's value
 * fields. The server applies the same registry contract, but this check
 * keeps an operator on the field instead of waiting for a request to fail.
 * Booleans are skipped: a checkbox always holds a definite true/false, so
 * "required" has no empty state to catch.
 *
 * @param {{ blockType: string, values: object }} content
 * @returns {Array<{ field: string, message: string }>}
 */
/** Names an organizer sees. The stored field id stays the registry id. */
const EDITORIAL_FIELD_LABELS = Object.freeze({
  text: { value: 'Text' },
  richtext: { value: 'Text' },
  image: {
    url: 'Image',
    alt: 'Alt text',
    caption: 'Caption',
    focalX: 'Horizontal focus',
    focalY: 'Vertical focus',
  },
  cta: { label: 'Button text', url: 'Destination', external: 'Open in a new tab' },
  stat: {
    value: 'Figure',
    label: 'Caption',
    takeaway: 'Finding',
    description: 'What it counts',
    source: 'Source',
    alt: 'Screen reader text',
  },
  fact: { label: 'Term', value: 'Fact', note: 'Note' },
  quote: { text: 'Quote', attribution: 'Attribution' },
  list_item: { text: 'Text' },
  faq_item: { question: 'Question', answer: 'Answer' },
  link_group: { group: 'Group', label: 'Link text', url: 'Destination' },
  sponsor_package: { name: 'Name', price: 'Price', limit: 'Limit', benefits: 'Benefits' },
});

const TITLE_KEYS = ['label', 'name', 'question', 'alt', 'text', 'attribution', 'caption', 'value'];

function plainContentText(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The control's accessible name. Storage keys such as `value` and `url` stay put. */
export function editorialFieldLabel(blockTypeId, fieldId) {
  return EDITORIAL_FIELD_LABELS[blockTypeId]?.[fieldId] ?? fieldId;
}

function titleValues(doc) {
  if (!doc) return {};
  return doc.values && typeof doc.values === 'object' ? doc.values : doc;
}

/** Public text that can name a new block, or the block type when the text is empty. */
export function contentIdSource(content) {
  const values = titleValues(content);
  for (const key of TITLE_KEYS) {
    const text = plainContentText(values[key]);
    if (text) return text;
  }
  return content?.blockType || 'block';
}

function humanizeId(id) {
  const words = String(id ?? '').replace(/[_-]+/g, ' ').trim();
  if (!words) return 'Content block';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** What the organizer reads in a list or heading. Not the stored field id. */
export function contentBlockTitle(doc) {
  const values = titleValues(doc);
  for (const key of TITLE_KEYS) {
    const text = plainContentText(values[key]);
    if (text) return text.length > 80 ? text.slice(0, 80) : text;
  }
  if (doc?.field) return humanizeId(doc.field);
  return 'Content block';
}

export function validateRequiredContent(content) {
  if (!content.blockType) {
    return [{ field: 'blockType', message: 'blockType: choose a block type before saving.' }];
  }
  const errors = [];
  for (const field of valueFieldsOf(content.blockType)) {
    if (!field.required || field.type === 'boolean') continue;
    const raw = content.values?.[field.id];
    const isEmpty = field.type === 'richtext'
      ? !hasRichTextContent(raw)
      : raw === undefined || raw === null || String(raw).trim() === '';
    if (isEmpty) {
      const name = editorialFieldLabel(content.blockType, field.id);
      errors.push({ field: field.id, message: `${name}: is required.` });
    }
  }
  // The page draws a sponsor package's limit only when it is a whole number
  // of 1 or more (functions/src/cms/content.cjs sponsorPackageErrors), so the
  // editor refuses any other value before the save.
  if (content.blockType === 'sponsor_package') {
    const raw = content.values?.limit;
    const text = raw === undefined || raw === null ? '' : String(raw).trim();
    const limit = Number(text);
    if (text !== '' && !(Number.isSafeInteger(limit) && limit >= 1)) {
      errors.push({ field: 'limit', message: 'limit: must be a whole number of 1 or more. Leave it empty for no limit.' });
    }
  }
  return errors;
}
