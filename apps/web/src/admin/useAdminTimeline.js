import { useEffect, useMemo, useState } from 'react';
import { subscribeAdminCollection } from './adminSource.js';
import { mergeTimelineRevisions } from './timelineDoc.js';

/** The timeline entries, live and draft, in the order the History section lists them (issue #194). */
export function useAdminTimeline() {
  const [live, setLive] = useState(null);
  const [drafts, setDrafts] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const unsubscribers = [
      subscribeAdminCollection('cmsTimeline', (docs) => {
        setLive(docs);
        setError(null);
      }, setError),
      subscribeAdminCollection('cmsTimeline_drafts', (docs) => {
        setDrafts(docs);
        setError(null);
      }, setError),
    ];
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe?.();
    };
  }, []);

  const rows = useMemo(() => mergeTimelineRevisions(live, drafts), [live, drafts]);

  return {
    rows,
    loading: (live === null || drafts === null) && !error,
    error,
    findRow: (id) => rows.find((row) => row.id === id) ?? null,
  };
}
