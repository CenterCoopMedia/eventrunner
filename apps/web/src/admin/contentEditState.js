// Local editor dirtiness (issue #446). This is the form in the browser, not
// the stored Draft / Live / Live with unpublished changes vocabulary in
// recordState.js. A save of the draft moves the baseline. A failed save does
// not. Putting every field back makes the two snapshots match.
import { blankContent } from './contentDoc.js';

/**
 * A stable comparison snapshot of one content-block form. It is a new
 * object, so later edits cannot mutate it.
 *
 * @param {string} fieldId
 * @param {{ blockType?: string, order?: number|string, visible?: boolean, values?: object }} content
 */
export function contentEditSnapshot(fieldId, content) {
  const values = {};
  const source = content?.values ?? {};
  for (const key of Object.keys(source).sort()) {
    const value = source[key];
    values[key] = typeof value === 'boolean' || typeof value === 'number' ? value : (value ?? '');
  }
  return {
    fieldId: fieldId ?? '',
    blockType: content?.blockType ?? '',
    order: content?.order ?? '',
    visible: content?.visible !== false,
    values,
  };
}

/** @returns {boolean} true when the form differs from the last saved snapshot */
export function contentEditIsDirty(saved, fieldId, content) {
  if (saved == null) return false;
  return JSON.stringify(saved) !== JSON.stringify(contentEditSnapshot(fieldId, content));
}

/**
 * Baseline for a new block once the section's allowed types are known.
 * The snapshot is the empty default, never text the operator already typed
 * while that list was still loading.
 *
 * @param {{ fieldId: string, content: object, fallbackType: string }} input
 * @returns {{ snapshot: object, nextContent: object|null }}
 */
export function createFormBaseline({ fieldId, content, fallbackType }) {
  const pristine = blankContent(fallbackType);
  const untouched = !contentEditIsDirty(contentEditSnapshot('', blankContent()), fieldId, content);
  if (content?.blockType) {
    return { snapshot: contentEditSnapshot('', pristine), nextContent: null };
  }
  const nextContent = {
    ...pristine,
    order: content?.order ?? '',
    visible: content?.visible !== false,
    values: { ...pristine.values, ...(content?.values ?? {}) },
  };
  return {
    snapshot: contentEditSnapshot('', pristine),
    nextContent: untouched ? pristine : nextContent,
  };
}
