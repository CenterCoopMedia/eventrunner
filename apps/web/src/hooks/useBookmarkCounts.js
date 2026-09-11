// Every session's aggregate bookmark count, shared (issue #165). One
// listener per mount, ref-counted underneath by lib/bookmarkCountsSource.js
// — the schedule page, the most-saved sort, and the counts figure all read
// this instead of each owning a subscription.
import { useEffect, useState } from 'react';
import { subscribeBookmarkCounts } from '../lib/bookmarkCountsSource.js';

/**
 * @returns {{ countsById: Map<string, number> }}
 *   Empty until the first snapshot arrives; a failed listener leaves the
 *   last-known map in place (the fail-soft rule bookmarkCountsSource owns).
 */
export function useBookmarkCounts() {
  const [countsById, setCountsById] = useState(() => new Map());
  useEffect(() => subscribeBookmarkCounts(setCountsById), []);
  return { countsById };
}
