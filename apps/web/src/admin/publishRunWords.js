// Publish-run words and timestamps, with no shell or data-provider imports.
/**
 * Epoch milliseconds from a Firestore Timestamp, a Date, or a number; null
 * for anything else.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
export function toMillis(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  return null;
}

function countIds(map) {
  if (!map || typeof map !== 'object') return 0;
  return Object.values(map).reduce((sum, ids) => sum + (Array.isArray(ids) ? ids.length : 0), 0);
}

function countProgress(progress, key) {
  if (!progress || typeof progress !== 'object') return 0;
  return Object.values(progress).reduce(
    (sum, entry) => sum + (Array.isArray(entry?.[key]) ? entry[key].length : 0),
    0,
  );
}

export function publishRunCounts(row) {
  const replacement = row?.mediaReplacement;
  if (Array.isArray(replacement?.places)) {
    return {
      requested: replacement.places.length,
      published: replacement.places.filter(({ docPath }) => replacement.completed?.[docPath.replace(/_drafts\//, '/')] === true).length,
      skipped: replacement.places.filter(({ docPath }) => typeof replacement.completed?.[docPath.replace(/_drafts\//, '/')] === 'string').length,
      measured: replacement.places.length > 1,
      replacing: true,
    };
  }
  return {
    requested: countIds(row?.request),
    published: countProgress(row?.progress, 'published'),
    skipped: countProgress(row?.progress, 'skipped'),
    measured: row?.plannedChunks > 1,
  };
}

const RUN_WORDS = Object.freeze({
  done: { word: 'Done', tone: 'done' },
  running: { word: 'Running', tone: 'info' },
  failed: { word: 'Failed', tone: 'error' },
});

/**
 * One publish run as a word and a sentence: "12 of 12 published.",
 * "5 of 12 published so far.", "5 of 12 published before it stopped."
 *
 * @param {{ id: string, status?: string, request?: object, progress?: object }} row
 * @returns {{ id: string, word: string, tone: string, sentence: string|null }}
 */
export function runSummary(row) {
  const { requested, published, skipped, replacing } = publishRunCounts(row);
  const known = RUN_WORDS[row?.status];
  if (!known) return { id: row?.id, word: 'Unknown', tone: 'neutral', sentence: null };
  if (row.menuOrder && row.status === 'done') {
    return { id: row.id, word: known.word, tone: known.tone, sentence: 'Menu order published.' };
  }
  let sentence;
  const action = replacing ? 'image placements updated' : 'published';
  if (row.status === 'done') {
    sentence = `${published} of ${requested} ${action}.`;
  } else if (row.status === 'running') {
    sentence = `${published} of ${requested} ${action} so far.`;
  } else {
    sentence = `${published} of ${requested} ${action} before it stopped.`;
  }
  if (skipped > 0) sentence += ` ${skipped} skipped.`;
  return { id: row.id, word: known.word, tone: known.tone, sentence };
}


