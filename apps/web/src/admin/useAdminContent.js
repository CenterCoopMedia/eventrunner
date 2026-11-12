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
  const [liveError, setLiveError] = useState(null);
  const [draftsError, setDraftsError] = useState(null);

  useEffect(() => {
    const unsubscribers = [
      subscribeAdminCollection('cmsContent', (docs, metadata) => {
        if (metadata?.fromCache) return;
        setLive(docs);
        setLiveError(null);
      }, setLiveError),
      subscribeAdminCollection('cmsContent_drafts', (docs, metadata) => {
        if (metadata?.fromCache) return;
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
    // Both server snapshots must arrive before an editor adopts a revision.
    // A cached empty drafts query can otherwise make it adopt the published
    // value once and miss the real draft when the server answers.
    loading: !ready && !error,
    ready,
    error,
    findRow: (id) => rows.find((row) => row.id === id) ?? null,
    forSection: (sectionId) => rows.filter((row) => row.current?.section === sectionId),
  };
}
