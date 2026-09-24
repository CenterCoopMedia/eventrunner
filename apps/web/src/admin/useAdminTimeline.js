import { useEffect, useMemo, useState } from 'react';
import { subscribeAdminCollection } from './adminSource.js';
import { mergeTimelineRevisions } from './timelineDoc.js';

/** The timeline entries, live and draft, in the order the History section lists them (issue #194). */
export function useAdminTimeline() {
  const [live, setLive] = useState(null);
  const [drafts, setDrafts] = useState(null);
  // One error per listener: a delivery from one clears only its own, so a
  // failure the other still has stays stated.
  const [liveError, setLiveError] = useState(null);
  const [draftsError, setDraftsError] = useState(null);

  useEffect(() => {
    const unsubscribers = [
      subscribeAdminCollection('cmsTimeline', (docs) => {
        setLive(docs);
        setLiveError(null);
      }, setLiveError),
      subscribeAdminCollection('cmsTimeline_drafts', (docs) => {
        setDrafts(docs);
        setDraftsError(null);
      }, setDraftsError),
    ];
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe?.();
    };
  }, []);

  const rows = useMemo(() => mergeTimelineRevisions(live, drafts), [live, drafts]);

  const error = liveError ?? draftsError ?? null;
  // Both listeners have reported at least once. The editor fills its form
  // only then, so it never opens on one revision and saves it over the other.
  const ready = live !== null && drafts !== null;

  return {
    rows,
    loading: !ready && !error,
    ready,
    error,
    findRow: (id) => rows.find((row) => row.id === id) ?? null,
  };
}
