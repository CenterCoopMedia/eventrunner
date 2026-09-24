// Every session's aggregate bookmark count, shared (issue #165). One
// listener per mount, ref-counted underneath by lib/bookmarkCountsSource.js
// — the schedule page, the most-saved sort, the counts figure, and the
// admin's Most saved panel (issue #182) all read this instead of each owning
// a subscription.
import { useEffect, useState } from 'react';
import { subscribeBookmarkCounts } from '../lib/bookmarkCountsSource.js';

/**
 * @returns {{ countsById: Map<string, number>, ready: boolean, error: unknown }}
 *   `countsById` is empty until the first snapshot arrives; a failed
 *   listener leaves the last-known map in place (the fail-soft rule
 *   bookmarkCountsSource owns). `ready` turns true with the first map and
 *   stays true. `error` is the listener's last failure, cleared by the next
 *   map, so a reader can tell "none saved" from "not heard yet" and from
 *   "could not hear".
 */
export function useBookmarkCounts() {
  const [state, setState] = useState(() => ({ countsById: new Map(), ready: false, error: null }));
  useEffect(
    () => subscribeBookmarkCounts(
      (countsById) => setState({ countsById, ready: true, error: null }),
      (error) => setState((current) => ({ ...current, error: error ?? new Error('unknown') })),
    ),
    [],
  );
  return state;
}
