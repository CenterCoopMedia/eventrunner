'use strict';

/**
 * Page templates — the server's copy of the operator's vocabulary.
 *
 * A template names a TASK ("Long read", "Directory with introduction") and
 * resolves to a bundle of the layout values that task wants. The layout
 * object is still the storage format; a template is a named, validated set
 * of the same values, plus a record of which task the operator meant.
 *
 * WHAT THIS FILE IS FOR. `validatePageDoc` rejects an unknown `template` BY
 * NAME, so a typo fails at the save rather than degrading into a page with
 * a template nothing can resolve.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not require `layout` to equal
 * the template's bundle. A bundle is authored design data and may be
 * revised; a validator that insisted every stored page still matched the
 * CURRENT bundle would make yesterday's pages unsaveable the day a bundle
 * changes, for a mismatch the operator did not create and cannot see. The
 * bundle is applied where the operator picks the template (the admin page
 * editor) and it is pinned to this file by pageDoc.test.js, which is what
 * keeps the two copies honest.
 *
 * Mirrored in apps/web/src/lib/pageTemplates.js. Same contract-by-test
 * pattern as blockTypes.cjs and the page layout enums above it.
 */

/** The six tasks, in the order the editor offers them. */
const PAGE_TEMPLATE_IDS = Object.freeze([
  'standard',
  'feature-first',
  'directory-intro',
  'long-read',
  'schedule',
  'landing',
]);

/**
 * What each template says, in the layout system's own values. Every
 * template states all three variants: a template's whole job is to answer
 * the questions so the operator does not have to.
 */
const PAGE_TEMPLATE_LAYOUTS = Object.freeze({
  standard: Object.freeze({
    header: 'nameplate-compact',
    arrangement: 'list',
    density: 'comfortable',
  }),
  'feature-first': Object.freeze({
    header: 'nameplate',
    arrangement: 'list',
    density: 'comfortable',
  }),
  'directory-intro': Object.freeze({
    header: 'nameplate-compact',
    arrangement: 'grid',
    density: 'comfortable',
  }),
  'long-read': Object.freeze({
    header: 'nameplate-compact',
    arrangement: 'list',
    density: 'loose',
  }),
  schedule: Object.freeze({
    header: 'nameplate-compact',
    arrangement: 'list',
    density: 'tight',
  }),
  landing: Object.freeze({
    header: 'nameplate',
    arrangement: 'grid',
    density: 'comfortable',
  }),
});

/**
 * Whether `id` names a template this system has.
 *
 * The type check is the point: `validatePageDoc` meets whatever arrives in
 * a request body, and `PAGE_TEMPLATE_IDS.includes(id)` on its own answers
 * "no" for a number and for an object without saying why it is safe to.
 *
 * @param {unknown} id
 * @returns {boolean}
 */
function isKnownPageTemplate(id) {
  return typeof id === 'string' && PAGE_TEMPLATE_IDS.includes(id);
}

module.exports = { PAGE_TEMPLATE_IDS, PAGE_TEMPLATE_LAYOUTS, isKnownPageTemplate };
