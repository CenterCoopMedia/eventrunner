import { useEffect, useMemo, useState } from 'react';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { subscribeAdminCollection } from './adminSource.js';
import { mergeSessionRevisions } from './sessionDoc.js';

export function useAdminSessions() {
  const { eventConfig } = useEventConfig();
  const [live, setLive] = useState(null);
  const [drafts, setDrafts] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const unsubscribers = [
      subscribeAdminCollection('cmsSchedule', (docs) => {
        setLive(docs);
        setError(null);
      }, setError),
      subscribeAdminCollection('cmsSchedule_drafts', (docs) => {
        setDrafts(docs);
        setError(null);
      }, setError),
    ];
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe?.();
    };
  }, []);

  const groups = useMemo(
    () => mergeSessionRevisions(live, drafts, eventConfig.days ?? []),
    [live, drafts, eventConfig.days],
  );
  const rows = useMemo(() => groups.flatMap((group) => group.rows), [groups]);

  return {
    groups,
    rows,
    loading: (live === null || drafts === null) && !error,
    error,
    findRow: (id) => rows.find((row) => row.id === id) ?? null,
  };
}
