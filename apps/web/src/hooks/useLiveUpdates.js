// The public live-updates feed (issue #28, spec §9 "Live updates card").
// One listener per mount; `loading` covers only the brief window before the
// first snapshot arrives — a listener error leaves `updates` at its
// last-known value rather than blanking the card (fail soft).
import { useEffect, useState } from 'react';
import { subscribeLiveUpdates } from '../lib/liveUpdatesSource.js';

/**
 * @returns {{ updates: Array<object>, loading: boolean }}
 */
export function useLiveUpdates() {
  const [updates, setUpdates] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = subscribeLiveUpdates((docs) => {
      setUpdates(docs);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  return { updates, loading };
}
