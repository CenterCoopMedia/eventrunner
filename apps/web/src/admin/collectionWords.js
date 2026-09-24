// The words for the six publishable collections (issue #196), in the order
// the admin lists them.
//
// Static and import-free on purpose: the pending-changes banner reads these
// words from the admin entry chunk, so nothing here may pull a formatter or
// a page in with it. The ids are the server's PUBLISHABLE_COLLECTIONS
// (functions/src/cms/blockTypes.cjs); a test pins the two sets together.

/**
 * @type {ReadonlyArray<{ id: string, label: string, singular: string, plural: string }>}
 */
export const COLLECTION_CHOICES = Object.freeze([
  { id: 'cmsContent', label: 'Content blocks', singular: 'content block', plural: 'content blocks' },
  { id: 'cmsPages', label: 'Pages', singular: 'page', plural: 'pages' },
  { id: 'cmsSchedule', label: 'Sessions', singular: 'session', plural: 'sessions' },
  { id: 'cmsOrganizations', label: 'Organizations', singular: 'organization', plural: 'organizations' },
  { id: 'cmsUpdates', label: 'Updates', singular: 'update', plural: 'updates' },
  { id: 'cmsTimeline', label: 'Timeline entries', singular: 'timeline entry', plural: 'timeline entries' },
]);

/**
 * "1 content block", "2 pages".
 *
 * @param {{ singular: string, plural: string }} choice
 * @param {number} count
 * @returns {string}
 */
export function countWords(choice, count) {
  return `${count} ${count === 1 ? choice.singular : choice.plural}`;
}

/**
 * The one sentence the banner and the page both print:
 * "5 unpublished changes: 2 content blocks, 1 page, 2 sessions." Only the
 * collections with changes, in choice order. Null when nothing is waiting.
 *
 * @param {Record<string, number>} countsByCollection
 * @returns {string|null}
 */
export function pendingSentence(countsByCollection) {
  const parts = [];
  let total = 0;
  for (const choice of COLLECTION_CHOICES) {
    const count = countsByCollection?.[choice.id] ?? 0;
    if (count > 0) {
      parts.push(countWords(choice, count));
      total += count;
    }
  }
  if (total === 0) return null;
  return `${total} unpublished ${total === 1 ? 'change' : 'changes'}: ${parts.join(', ')}.`;
}
