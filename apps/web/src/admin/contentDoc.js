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

/** A blank `values` map for a block type: '' for text-ish fields, false for booleans. */
export function blankContentValues(blockTypeId) {
  const type = blockTypeFor(blockTypeId);
  const values = {};
  for (const field of type?.fields ?? []) {
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
  const type = blockTypeFor(resolvedType);
  const values = {};
  for (const field of type?.fields ?? []) {
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
  const type = blockTypeFor(content.blockType);
  const fields = { blockType: content.blockType };
  if (content.order !== '' && content.order !== null && content.order !== undefined) {
    const order = Number(content.order);
    fields.order = Number.isFinite(order) ? order : content.order;
  }
  for (const field of type?.fields ?? []) {
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
