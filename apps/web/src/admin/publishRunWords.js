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
  const requested = countIds(row?.request);
  const published = countProgress(row?.progress, 'published');
  const skipped = countProgress(row?.progress, 'skipped');
  const known = RUN_WORDS[row?.status];
  if (!known) return { id: row?.id, word: 'Unknown', tone: 'neutral', sentence: null };
  let sentence;
  if (row.status === 'done') {
    sentence = `${published} of ${requested} published.`;
    if (skipped > 0) sentence += ` ${skipped} skipped.`;
  } else if (row.status === 'running') {
    sentence = `${published} of ${requested} published so far.`;
  } else {
    sentence = `${published} of ${requested} published before it stopped.`;
  }
  return { id: row.id, word: known.word, tone: known.tone, sentence };
}


