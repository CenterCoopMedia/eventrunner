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
    // Reset BEFORE attaching the new listener: without this, switching to a
    // different session (a card being reused, not a fresh mount) would keep
    // rendering the PREVIOUS session's counts — indefinitely, if the new
    // listener's first attempt errors, since the fail-soft contract
    // (reactionsSource.js) is "leave last-known values in place" and
    // ReactionsPill does not gate its render on `loading`.
    setCounts(null);
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
  // useMyBookmarks.js). Reset first, same reasoning as the counts effect
  // above — a stale `myReaction` from a different session/user must not
  // leak into the new subscription's target until it reports in.
  useEffect(() => {
    setMyReaction(null);
    const unsubscribeMine = subscribeMySessionReaction(sessionId, user?.uid, setMyReaction);
    return unsubscribeMine;
  }, [sessionId, user?.uid]);

  return { counts: counts ?? {}, myReaction, loading };
}
