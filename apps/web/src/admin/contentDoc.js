// cmsContent document helpers for the content-block editor (issue #61).
//
// A cmsContent doc is keyed `<section>__<field>` (functions/src/cms/
// content.cjs) and carries `section`, `field`, and `blockType` as ordinary
// content fields plus whatever value fields that block type's registry
// entry (blockTypes.js) declares. Unlike cmsPages, the generic content
// endpoints do not validate those value fields by name or type — they only
// guard reserved keys — so this module's job is purely to give the editor a
// stable, typed form shape; the server's own rejections (reserved keys,
// bad section/field shape, 404/409) still travel back verbatim.
import { blockTypeFor } from './blockTypes.js';

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
      if (raw === '' || raw === null || raw === undefined) continue;
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
 * fields. The generic content endpoints validate only reserved keys, not
 * block shape (functions/src/cms/content.cjs has no BLOCK_TYPES-aware
 * validator the way cmsSavePage does for cmsPages), so without this an
 * operator can publish e.g. an image block with no alt text. Booleans are
 * skipped: a checkbox always holds a definite true/false, so "required"
 * has no empty state to catch.
 *
 * @param {{ blockType: string, values: object }} content
 * @returns {Array<{ field: string, message: string }>}
 */
export function validateRequiredContent(content) {
  if (!content.blockType) {
    return [{ field: 'blockType', message: 'blockType: choose a block type before saving.' }];
  }
  const errors = [];
  for (const field of valueFieldsOf(content.blockType)) {
    if (!field.required || field.type === 'boolean') continue;
    const raw = content.values?.[field.id];
    const isEmpty = raw === undefined || raw === null || String(raw).trim() === '';
    if (isEmpty) errors.push({ field: field.id, message: `${field.id}: is required.` });
  }
  return errors;
}
