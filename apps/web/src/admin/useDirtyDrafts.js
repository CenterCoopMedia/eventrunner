// Full draft rows load only while the Unpublished changes page is open.
// The page derives its displayed count from these same rows.
import { useEffect, useMemo, useState } from 'react';
import { COLLECTION_CHOICES, pendingSentence } from './collectionWords.js';
import { subscribeDirtyDrafts } from './pendingChangesSource.js';

export function useDirtyDrafts() {
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

  return useMemo(() => {
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
}
