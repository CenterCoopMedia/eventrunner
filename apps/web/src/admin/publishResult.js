// Reading a cmsPublish response honestly.
//
// cmsPublish answers 200 even when it published NOTHING a caller asked for:
// its per-collection result carries `published` and `skipped`, and a doc is
// skipped when it has no draft ('no-draft') or when an editor saved between
// the read and the commit ('conflict' — the newer draft deliberately stays
// dirty rather than being marked clean under a stale publish). Reporting
// "Published." on those would tell an operator their change is live when it
// is not. See functions/src/cms/store.cjs publishDocs.
//
// A `{ queueId }` resume answers with the queue row's recorded progress in
// the same per-collection shape, so the same reader serves both.

const REASON_TEXT = {
  'no-draft': 'has no draft to publish',
  conflict: 'was edited while publishing, so its newer draft stayed unpublished',
};

/** @param {string} reason */
function describeReason(reason) {
  return REASON_TEXT[reason] ?? `was skipped (${reason})`;
}

/**
 * Compare what was asked for against what a cmsPublish response reports.
 *
 * @param {object} response cmsPublish JSON
 * @param {string} collection e.g. 'cmsPages'
 * @param {string[]} requestedIds ids the caller asked to publish
 * @param {string} [noun] plural noun for the count message, e.g. 'pages'
 *   (default) or 'content blocks'
 * @returns {{ ok: boolean, published: string[],
 *             skipped: Array<{ docId: string, reason: string }>,
 *             message: string }}
 */
export function summarizePublish(response, collection, requestedIds, noun = 'pages') {
  const result = response?.results?.[collection] ?? {};
  const published = Array.isArray(result.published) ? result.published : [];
  const skippedRows = Array.isArray(result.skipped) ? result.skipped : [];
  const requested = [...new Set(requestedIds ?? [])];

  const publishedSet = new Set(published);
  const skipped = [];
  for (const docId of requested) {
    if (publishedSet.has(docId)) continue;
    const row = skippedRows.find((entry) => entry?.docId === docId);
    skipped.push({ docId, reason: row?.reason ?? 'not-published' });
  }

  if (skipped.length === 0) {
    return {
      ok: true,
      published,
      skipped,
      message: 'Published. The public site picks it up live.',
    };
  }
  const detail = skipped
    .map(({ docId, reason }) => `${docId} ${describeReason(reason)}`)
    .join('; ');
  const publishedCount = requested.length - skipped.length;
  return {
    ok: false,
    published,
    skipped,
    message:
      publishedCount > 0
        ? `Published ${publishedCount} of ${requested.length} ${noun}. Not published: ${detail}.`
        : `Nothing was published: ${detail}.`,
  };
}
