// Live cmsPages + cmsPages_drafts for the admin CMS.
//
// Both revisions are subscribed, so the list shows publish state without a
// reload and a save is reflected as soon as the draft listener reports the
// write back (save → server → listener → UI; nothing optimistic). Listener
// failures fail soft: `error` is set for a non-blocking notice and the last
// known rows keep rendering.
import { useEffect, useMemo, useState } from 'react';
import { subscribeAdminCollection } from './adminSource.js';
import { mergePageRevisions } from './pageDoc.js';

export function useAdminPages() {
  const [live, setLive] = useState(null);
  const [drafts, setDrafts] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const unsubscribers = [
      subscribeAdminCollection('cmsPages', (docs) => {
        setLive(docs);
        setError(null);
      }, setError),
      subscribeAdminCollection('cmsPages_drafts', (docs) => {
        setDrafts(docs);
        setError(null);
      }, setError),
    ];
    return () => {
      for (const unsubscribe of unsubscribers) {
        if (typeof unsubscribe === 'function') unsubscribe();
      }
    };
  }, []);

  const rows = useMemo(() => mergePageRevisions(live, drafts), [live, drafts]);

  return {
    rows,
    // BOTH listeners must report before the list is trustworthy — an empty
    // array is a legitimate answer ("no pages"), but a missing one is not:
    // with only the live result in, a draft-only page reads as "no such
    // page", and with only the drafts result in, a clean draft reads as
    // never published and Publish all would republish it. An errored
    // listener resolves the wait instead of spinning forever (fail soft: the
    // rows we do have keep rendering while the subscription retries).
    loading: (live === null || drafts === null) && !error,
    error,
    findRow: (id) => rows.find((row) => row.id === id) ?? null,
  };
}
