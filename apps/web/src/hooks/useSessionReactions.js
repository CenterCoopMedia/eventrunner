// One session's reaction counts, plus the signed-in caller's own reaction
// (issue #25, spec §9 "Session reactions"). One listener pair per mounted
// ReactionsPill — a session card only needs its own session's counts, unlike
// useMyBookmarks.js which fans one subscription out to every card via a
// shared "my schedule" set.
import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { subscribeMySessionReaction, subscribeSessionReactions } from '../lib/reactionsSource.js';

/**
 * @param {string} sessionId
 * @returns {{ counts: Record<string, number>, myReaction: string|null, loading: boolean }}
 *   `loading` is true only for the brief window before the first aggregate
 *   snapshot arrives — same rationale as useMyBookmarks.js's `loading`.
 */
export function useSessionReactions(sessionId) {
  const { user } = useAuth();
  const [counts, setCounts] = useState(null);
  const [myReaction, setMyReaction] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const unsubscribeCounts = subscribeSessionReactions(
      sessionId,
      (nextCounts) => {
        setCounts(nextCounts);
        setLoading(false);
      },
      // Fail soft (reactionsSource.js): a listener error only unblocks
      // `loading`, it never fabricates counts.
      () => setLoading(false),
    );
    return unsubscribeCounts;
  }, [sessionId]);

  // Re-subscribes on sessionId OR signed-in identity change (mirrors
  // useMyBookmarks.js).
  useEffect(() => {
    const unsubscribeMine = subscribeMySessionReaction(sessionId, user?.uid, setMyReaction);
    return unsubscribeMine;
  }, [sessionId, user?.uid]);

  return { counts: counts ?? {}, myReaction, loading };
}
