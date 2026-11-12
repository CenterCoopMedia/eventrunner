// Eligible readers save to their account; other readers save in this
// browser. SessionActions owns the feature flag. Storage refusal preserves
// the signed-out reader's sign-in path.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useProfile } from '../../contexts/ProfileContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { setSessionBookmarked } from '../../lib/bookmarksSource.js';
import { setDeviceBookmarked } from '../../lib/deviceBookmarks.js';
import { useDeviceBookmarks } from '../../hooks/useDeviceBookmarks.js';
import { rowActionClass } from './sessionActionClass.js';

/**
 * @param {{ session: { id: string }, bookmarked?: boolean }} props
 */
export default function BookmarkAction({ session, bookmarked = false }) {
  const { user } = useAuth();
  const { attendeeAccess, profileConfirmed, status } = useProfile();
  const { showToast } = useToast();
  const device = useDeviceBookmarks();
  const deviceOnly = !user || !attendeeAccess;
  const profileLoading = Boolean(user && (!profileConfirmed || status === 'pending-account'));
  const deviceSaved = device.ids.includes(session.id);
  const importing = device.merging.includes(session.id);
  const [pending, setPending] = useState(false);
  // Optimistic local override so a click feels instant; cleared on a
  // failed request (see onClick's catch) AND, below, once `bookmarked`
  // itself changes — the owning subscription's next snapshot confirming
  // OUR write, but just as importantly a DIFFERENT change arriving (a
  // toggle from another tab, an admin action, or the signed-in identity
  // switching). Without that second clear, `optimistic` would keep
  // masking `bookmarked` forever after a successful write: the next click
  // would compute `next = !isBookmarked` off the stale optimistic value
  // instead of the server's real state, sending the inverse of what the
  // user actually sees on screen.
  const [optimistic, setOptimistic] = useState(null);
  const isBookmarked = optimistic && optimistic.uid === user?.uid && optimistic.deviceSaved === deviceSaved
    ? optimistic.value : deviceOnly ? deviceSaved : bookmarked || deviceSaved;

  // Keyed on the session and the signed-in identity too: switching users
  // (or the card being reused for a different session without a fresh
  // mount) must not carry a stale optimistic value across the switch.
  useEffect(() => {
    setOptimistic(null);
  }, [bookmarked, session.id, user?.uid, attendeeAccess]);
  useEffect(() => {
    setOptimistic((previous) => previous && previous.deviceSaved !== deviceSaved ? null : previous);
  }, [deviceSaved]);

  const onClick = useCallback(async () => {
    if (pending || importing || profileLoading) return;
    const next = !isBookmarked;
    if (deviceOnly) {
      if (!setDeviceBookmarked(session.id, next)) {
        showToast('This browser could not save the session. Check your browser storage settings.', { tone: 'error' });
      }
      return;
    }
    setOptimistic({ value: next, deviceSaved: deviceSaved && next, uid: user.uid });
    setPending(true);
    // Removing a browser save also withdraws it from an import that has
    // not started. In-flight imports hold this control busy instead.
    if (deviceSaved && !next && !setDeviceBookmarked(session.id, false)) {
      setOptimistic(null);
      setPending(false);
      showToast('This browser could not remove the saved session. Check your browser storage settings and try again.', { tone: 'error' });
      return;
    }
    try {
      await setSessionBookmarked({ user, sessionId: session.id, bookmarked: next });
    } catch (err) {
      if (deviceSaved && !next) setDeviceBookmarked(session.id, true);
      setOptimistic(null);
      showToast(err.message || 'The bookmark could not be saved. Try again.', { tone: 'error' });
    } finally {
      setPending(false);
    }
  }, [user, isBookmarked, session.id, showToast, pending, importing, profileLoading, deviceOnly, deviceSaved]);

  if (!profileLoading && deviceOnly && !device.available && !user) {
    return (
      <Link to="/signin" className={rowActionClass}>
        Sign in to save sessions
      </Link>
    );
  }

  if (!profileLoading && deviceOnly && !device.available) return null;

  // Keep focus while an account write or browser import is in flight.
  // The click guard prevents another request, and aria-busy states the wait.
  return (
    <button
      type="button"
      className={rowActionClass}
      onClick={onClick}
      aria-disabled={pending || importing || profileLoading || undefined}
      aria-busy={pending || importing || profileLoading || undefined}
      aria-pressed={profileLoading ? undefined : isBookmarked}
    >
      {!profileLoading ? <span aria-hidden="true">{isBookmarked ? '★' : '☆'}</span> : null}
      {profileLoading ? 'Checking your saved sessions…' : isBookmarked ? 'Bookmarked' : 'Bookmark'}
    </button>
  );
}
