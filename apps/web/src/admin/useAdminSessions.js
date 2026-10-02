import { useEffect, useMemo, useState } from 'react';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { subscribeAdminCollection } from './adminSource.js';
import { mergeSessionRevisions } from './sessionDoc.js';

export function useAdminSessions() {
  const { eventConfig } = useEventConfig();
  const [live, setLive] = useState(null);
  const [drafts, setDrafts] = useState(null);
  const [liveError, setLiveError] = useState(null);
  const [draftsError, setDraftsError] = useState(null);

  useEffect(() => {
    const unsubscribers = [
      subscribeAdminCollection('cmsSchedule', (docs) => {
        setLive(docs);
        setLiveError(null);
      }, setLiveError),
      subscribeAdminCollection('cmsSchedule_drafts', (docs) => {
        setDrafts(docs);
        setDraftsError(null);
      }, setDraftsError),
    ];
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe?.();
    };
  }, []);

  const groups = useMemo(
    () => mergeSessionRevisions(live, drafts, eventConfig.days ?? [], eventConfig.timezone),
    [live, drafts, eventConfig.days, eventConfig.timezone],
  );
  const rows = useMemo(() => groups.flatMap((group) => group.rows), [groups]);
  const error = liveError ?? draftsError ?? null;
  const ready = live !== null && drafts !== null;

  return {
    groups,
    rows,
    loading: !ready && !error,
    ready,
    error,
    findRow: (id) => rows.find((row) => row.id === id) ?? null,
  };
}
