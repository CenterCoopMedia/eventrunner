// Live + draft rows for any one publishable collection (issue #195, the
// version history record list). Same two listeners and the same loading
// rule as useAdminContent.js, over a collection the caller picks.
//
// The listeners' answers are kept with the collection they answer for. A
// change of collection resubscribes, and until both new listeners report,
// the rows read as not loaded rather than as the previous collection's:
// an answer that arrives for a collection the page has left is dropped,
// so no row of Pages can show under the Sessions label.
import { useEffect, useMemo, useState } from 'react';
import { subscribeAdminCollection } from './adminSource.js';
import { mergePageRevisions } from './pageDoc.js';

const NOTHING = Object.freeze({ collection: null, live: null, drafts: null, error: null });

/**
 * @param {string|null} collection a publishable collection, or null to read nothing
 * @returns {{ rows: Array<object>, loading: boolean, ready: boolean,
 *             error: unknown, findRow: (id: string) => object|null }}
 *   `ready` is true once both listeners have reported for this collection.
 */
export function useAdminRecords(collection) {
  const [snapshot, setSnapshot] = useState(NOTHING);

  useEffect(() => {
    if (!collection) return undefined;
    setSnapshot({ collection, live: null, drafts: null, error: null });
    const forThis = (update) => (current) => (current.collection === collection ? update(current) : current);
    const unsubscribers = [
      subscribeAdminCollection(
        collection,
        (docs) => setSnapshot(forThis((current) => ({ ...current, live: docs, error: null }))),
        (error) => setSnapshot(forThis((current) => ({ ...current, error }))),
      ),
      subscribeAdminCollection(
        `${collection}_drafts`,
        (docs) => setSnapshot(forThis((current) => ({ ...current, drafts: docs, error: null }))),
        (error) => setSnapshot(forThis((current) => ({ ...current, error }))),
      ),
    ];
    return () => {
      for (const unsubscribe of unsubscribers) {
        if (typeof unsubscribe === 'function') unsubscribe();
      }
    };
  }, [collection]);

  const own = snapshot.collection === collection ? snapshot : NOTHING;
  const { live, drafts, error } = own;
  const rows = useMemo(() => mergePageRevisions(live, drafts), [live, drafts]);
  const ready = live !== null && drafts !== null;

  return {
    rows,
    // BOTH listeners must report before the list is trustworthy: a
    // draft-only record otherwise reads as absent, and a clean draft as
    // never published (useAdminPages.js).
    loading: Boolean(collection) && !ready && !error,
    ready,
    error,
    findRow: (id) => rows.find((row) => row.id === id) ?? null,
  };
}
