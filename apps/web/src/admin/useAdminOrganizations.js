import { useEffect, useMemo, useState } from 'react';
import { subscribeAdminCollection } from './adminSource.js';
import { mergeOrganizationRevisions } from './organizationDoc.js';

/** The organizations, live and draft, in the order the sponsors page draws them (issue #192). */
export function useAdminOrganizations() {
  const [live, setLive] = useState(null);
  const [drafts, setDrafts] = useState(null);
  const [liveError, setLiveError] = useState(null);
  const [draftsError, setDraftsError] = useState(null);

  useEffect(() => {
    const unsubscribers = [
      subscribeAdminCollection('cmsOrganizations', (docs) => {
        setLive(docs);
        setLiveError(null);
      }, setLiveError),
      subscribeAdminCollection('cmsOrganizations_drafts', (docs) => {
        setDrafts(docs);
        setDraftsError(null);
      }, setDraftsError),
    ];
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe?.();
    };
  }, []);

  const rows = useMemo(() => mergeOrganizationRevisions(live, drafts), [live, drafts]);
  const error = liveError ?? draftsError ?? null;
  const ready = live !== null && drafts !== null;

  return {
    rows,
    // Both listeners have reported. They report in no fixed order, and a row
    // built before the drafts arrive is the live doc alone.
    ready,
    loading: !ready && !error,
    error,
    findRow: (id) => rows.find((row) => row.id === id) ?? null,
  };
}
