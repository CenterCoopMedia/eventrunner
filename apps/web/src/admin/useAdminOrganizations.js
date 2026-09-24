import { useEffect, useMemo, useState } from 'react';
import { subscribeAdminCollection } from './adminSource.js';
import { mergeOrganizationRevisions } from './organizationDoc.js';

/** The organizations, live and draft, in the order the sponsors page draws them (issue #192). */
export function useAdminOrganizations() {
  const [live, setLive] = useState(null);
  const [drafts, setDrafts] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const unsubscribers = [
      subscribeAdminCollection('cmsOrganizations', (docs) => {
        setLive(docs);
        setError(null);
      }, setError),
      subscribeAdminCollection('cmsOrganizations_drafts', (docs) => {
        setDrafts(docs);
        setError(null);
      }, setError),
    ];
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe?.();
    };
  }, []);

  const rows = useMemo(() => mergeOrganizationRevisions(live, drafts), [live, drafts]);

  return {
    rows,
    loading: (live === null || drafts === null) && !error,
    error,
    findRow: (id) => rows.find((row) => row.id === id) ?? null,
  };
}
