// Live cmsContent + cmsContent_drafts for the admin content-block editor
// (issue #61). Same shape and rationale as useAdminPages.js: both revisions
// are subscribed so publish state shows without a reload, and a listener
// failure fails soft (last-known rows keep rendering, `error` carries a
// non-blocking notice) instead of blanking the screen.
//
// mergePageRevisions/publishStateOf (pageDoc.js) are written generically
// over `{ id, order, status, visible }` — nothing in them is page-specific
// — so they are reused here rather than re-implemented for cmsContent.
import { useEffect, useMemo, useState } from 'react';
import { subscribeAdminCollection } from './adminSource.js';
import { mergePageRevisions } from './pageDoc.js';

export function useAdminContent() {
  const [live, setLive] = useState(null);
  const [drafts, setDrafts] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const unsubscribers = [
      subscribeAdminCollection('cmsContent', (docs) => {
        setLive(docs);
        setError(null);
      }, setError),
      subscribeAdminCollection('cmsContent_drafts', (docs) => {
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
    // BOTH listeners must report before the list is trustworthy — see
    // useAdminPages.js for why (a draft-only doc otherwise reads as absent,
    // and a clean draft otherwise reads as never-published).
    loading: (live === null || drafts === null) && !error,
    error,
    findRow: (id) => rows.find((row) => row.id === id) ?? null,
    forSection: (sectionId) => rows.filter((row) => row.current?.section === sectionId),
  };
}
