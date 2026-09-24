// Live cmsUpdates + cmsUpdates_drafts for the admin's updates list and
// editor (issue #190), the same shape useAdminPages gives the page list.
//
// Both revisions are subscribed, so a save shows its state as soon as the
// draft listener reports the write back (save → server → listener → UI;
// nothing optimistic). Listener failures fail soft: `error` is set for a
// notice and the last known rows keep rendering.
import { useEffect, useMemo, useState } from 'react';
import { subscribeAdminCollection } from './adminSource.js';
import { mergeUpdateRevisions } from './updatesDoc.js';

export function useAdminUpdates() {
  const [live, setLive] = useState(null);
  const [drafts, setDrafts] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const unsubscribers = [
      subscribeAdminCollection('cmsUpdates', (docs) => {
        setLive(docs);
        setError(null);
      }, setError),
      subscribeAdminCollection('cmsUpdates_drafts', (docs) => {
        setDrafts(docs);
        setError(null);
      }, setError),
    ];
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe?.();
    };
  }, []);

  const rows = useMemo(() => mergeUpdateRevisions(live, drafts), [live, drafts]);

  return {
    rows,
    // Both listeners must report before the list is trustworthy: with only
    // the live result in, a draft-only update reads as "no such update",
    // and with only the drafts in, a live update reads as a draft. An
    // errored listener ends the wait.
    loading: (live === null || drafts === null) && !error,
    // Both listeners have reported at least once. `loading` ends on an
    // error too, so the list can show the rows it has; the editor fills a
    // form only once this is true, so it never opens on one revision.
    ready: live !== null && drafts !== null,
    error,
    findRow: (id) => rows.find((row) => row.id === id) ?? null,
  };
}
