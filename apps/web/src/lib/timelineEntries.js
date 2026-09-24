// The past editions the home page's History section lists (issue #194).
//
// ContentProvider subscribes to cmsTimeline and hands the raw result on as
// `timelineDocs`: null until the listener reports, then the published set.
// This module turns that into the list, with the same overlay rules as
// every other collection: the committed snapshot stands until a live result
// arrives, and a live result, an empty one included, replaces it wholesale.
// It sits beside the renderer, which loads on demand, so the snapshot and
// the drop stay out of the chunk every visitor downloads.
import snapshotTimelineData from '@generated/timelineData.js';

/**
 * The entries a reader may see, oldest first, then by title and id.
 *
 * The content save checks each field (functions/src/cms/timeline.cjs). This
 * drop guards what reaches the collection another way, so a script-written
 * entry never blanks the home page. A hidden entry is dropped too, because
 * the draft preview reads the unfiltered drafts.
 *
 * @param {Array<object>} docs
 * @returns {Array<object>}
 */
export function prepareTimelineDocs(docs) {
  return (Array.isArray(docs) ? docs : [])
    .filter(
      (doc) =>
        Number.isInteger(doc?.year) &&
        doc.visible !== false &&
        typeof doc.title === 'string' &&
        doc.title.trim() !== '' &&
        (doc.description == null || typeof doc.description === 'string'),
    )
    .sort(
      (a, b) =>
        a.year - b.year ||
        a.title.localeCompare(b.title) ||
        String(a.id).localeCompare(String(b.id)),
    );
}

/**
 * The list to draw: the live set once the listener has reported, else the
 * committed snapshot.
 *
 * @param {Array<object>|null|undefined} liveDocs ContentContext `timelineDocs`
 * @returns {Array<object>}
 */
export function timelineEntries(liveDocs) {
  return prepareTimelineDocs(liveDocs != null ? liveDocs : snapshotTimelineData);
}
