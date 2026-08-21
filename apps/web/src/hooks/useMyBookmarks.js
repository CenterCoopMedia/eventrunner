// The signed-in user's bookmarked session ids (issue #16, spec §9). One
// listener per mount, shared by anything that needs to know "is this
// session bookmarked" — SessionCard's bookmark pill and the "my schedule"
// filter both use this instead of each owning a subscription.
import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { subscribeMyBookmarks } from '../lib/bookmarksSource.js';

/**
 * @returns {{ bookmarkedIds: Set<string>, loading: boolean }}
 *   `loading` is true only for the brief window before the first snapshot
 *   (or immediately-resolved empty set for a signed-out user) arrives —
 *   callers that gate a whole view on this should treat `loading` the same
 *   way ContentContext's `loading` is documented: rare, but real for this
 *   listener's first tick.
 */
export function useMyBookmarks() {
  const { user } = useAuth();
  const [bookmarkedIds, setBookmarkedIds] = useState(new Set());
  const [loading, setLoading] = useState(Boolean(user));

  /* eslint-disable react-hooks/exhaustive-deps -- re-subscribe only on a
   * real identity change (uid), not every AuthProvider re-render that hands
   * back a new `user` object reference for the same account. */
  useEffect(() => {
    setLoading(Boolean(user));
    const unsubscribe = subscribeMyBookmarks(
      user?.uid,
      (ids) => {
        setBookmarkedIds(ids);
        setLoading(false);
      },
      // Fail soft (bookmarksSource.js): a listener error leaves
      // bookmarkedIds untouched — only `loading` needs unblocking, so a
      // permanently-denied or brand-new-account listener doesn't leave a
      // caller (MySchedule) spinning forever instead of rendering with
      // (possibly empty) last-known data.
      () => setLoading(false),
    );
    return unsubscribe;
  }, [user?.uid]);
  /* eslint-enable react-hooks/exhaustive-deps */

  return { bookmarkedIds, loading };
}
