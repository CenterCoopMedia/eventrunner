// One count of unpublished changes for the whole admin (issue #196).
//
// The shell mounts this provider once, and the banner and the Unpublished
// changes page only READ it: one listener per publishable collection's
// dirty drafts, one value, so the banner's figure, the page's figure and the
// page's rows cannot disagree. Neither reader counts anything of its own.
//
// It holds the documents and the counts. Grouping and formatting happen in
// the page, which is a lazy chunk; this file stays small because it rides in
// the admin entry chunk.
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { COLLECTION_CHOICES, pendingSentence } from './collectionWords.js';
import { subscribeDirtyDrafts } from './pendingChangesSource.js';

const PendingChangesContext = createContext(null);

const OUTSIDE = Object.freeze({
  ready: false,
  error: null,
  docsByCollection: Object.freeze({}),
  total: 0,
  sentence: null,
});

export function PendingChangesProvider({ children }) {
  // collection id → its dirty drafts; a collection is absent until its
  // listener has delivered once.
  const [docsByCollection, setDocsByCollection] = useState(() => ({}));
  // collection id → the listener's last error, cleared by its next delivery.
  const [errors, setErrors] = useState(() => ({}));

  useEffect(() => {
    const unsubscribers = COLLECTION_CHOICES.map(({ id }) =>
      subscribeDirtyDrafts(
        id,
        (docs) => {
          setDocsByCollection((current) => ({ ...current, [id]: docs }));
          setErrors((current) => (current[id] ? { ...current, [id]: null } : current));
        },
        (error) => setErrors((current) => ({ ...current, [id]: error ?? true })),
      ),
    );
    return () => {
      for (const unsubscribe of unsubscribers) {
        if (typeof unsubscribe === 'function') unsubscribe();
      }
    };
  }, []);

  const value = useMemo(() => {
    const counts = {};
    let total = 0;
    // Every listener has answered once. Before that a count is a guess.
    let ready = true;
    let error = null;
    for (const { id } of COLLECTION_CHOICES) {
      const docs = docsByCollection[id];
      if (!Array.isArray(docs)) ready = false;
      counts[id] = docs?.length ?? 0;
      total += counts[id];
      error = error || errors[id] || null;
    }
    return { ready, error, docsByCollection, total, sentence: pendingSentence(counts) };
  }, [docsByCollection, errors]);

  return <PendingChangesContext.Provider value={value}>{children}</PendingChangesContext.Provider>;
}

/**
 * The shared count: `{ ready, error, docsByCollection, total, sentence }`.
 * Outside a provider it is never ready and counts nothing.
 */
export function usePendingChanges() {
  return useContext(PendingChangesContext) ?? OUTSIDE;
}
