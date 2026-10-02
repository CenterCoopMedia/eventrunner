// The shell reads one server-maintained count document. The Unpublished
// changes page loads its own rows only while it is open.
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useAdminApi } from './adminApi.js';
import { COLLECTION_CHOICES, pendingSentence } from './collectionWords.js';
import { subscribePendingCounts } from './pendingCountsSource.js';

const PendingChangesContext = createContext(null);
const OUTSIDE = { ready: false, total: 0 };

export function PendingChangesProvider({ children }) {
  const call = useAdminApi();
  const [state, setState] = useState({ counts: null, error: null });

  useEffect(() => {
    setState({ counts: null, error: null });
    return subscribePendingCounts(
      () => call('cmsEnsurePendingCounts', {}),
      (counts) => setState({ counts, error: null }),
      (error) => setState((current) => ({ ...current, error })),
    );
  }, [call]);

  const value = useMemo(() => ({
    ready: state.counts !== null,
    error: state.error,
    total: COLLECTION_CHOICES.reduce((total, { id }) => total + (state.counts?.[id] ?? 0), 0),
    sentence: pendingSentence(state.counts),
  }), [state]);

  return <PendingChangesContext.Provider value={value}>{children}</PendingChangesContext.Provider>;
}

/** The banner's count; outside a provider it is never ready. */
export function usePendingChanges() {
  return useContext(PendingChangesContext) ?? OUTSIDE;
}
