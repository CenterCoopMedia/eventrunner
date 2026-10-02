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
  const [liveError, setLiveError] = useState(null);
  const [draftsError, setDraftsError] = useState(null);

  useEffect(() => {
    const unsubscribers = [
      subscribeAdminCollection('cmsPages', (docs) => {
        setLive(docs);
        setLiveError(null);
      }, setLiveError),
      subscribeAdminCollection('cmsPages_drafts', (docs) => {
        setDrafts(docs);
        setDraftsError(null);
      }, setDraftsError),
    ];
    return () => {
      for (const unsubscribe of unsubscribers) {
        if (typeof unsubscribe === 'function') unsubscribe();
      }
    };
  }, []);

  const rows = useMemo(() => mergePageRevisions(live, drafts), [live, drafts]);
  const error = liveError ?? draftsError ?? null;
  const ready = live !== null && drafts !== null;

  return {
    rows,
    // BOTH listeners must report before the list is trustworthy — an empty
    // array is a legitimate answer ("no pages"), but a missing one is not:
    // with only the live result in, a draft-only page reads as "no such
    // page", and with only the drafts result in, a clean draft reads as
    // never published and Publish all would republish it. An errored
    // listener resolves the wait instead of spinning forever (fail soft: the
    // rows we do have keep rendering while the subscription retries).
    loading: !ready && !error,
    ready,
    error,
    findRow: (id) => rows.find((row) => row.id === id) ?? null,
  };
}
