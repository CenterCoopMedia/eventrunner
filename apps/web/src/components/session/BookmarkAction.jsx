// BookmarkAction — the one save-this-session control (spec §9 "Bookmarks").
//
// Was BookmarkPill, and one behaviour changed with the name: A CONTROL THAT
// CANNOT BE USED IS NOT RENDERED. The old pill drew a dead, greyed-out
// rectangle reading "Bookmark" for a signed-in visitor without attendee
// access — an offer the page had already decided to refuse, repeated under
// every session on the page. A disabled control teaches nothing; it only
// occupies the place a real one would.
//
// So there are three states and no fourth:
//
//   • approved attendee (or speaker, or admin)  → the working toggle;
//   • signed out                                → "Sign in to save
//     sessions", a real link to a real path, because signing in is how this
//     visitor becomes eligible;
//   • signed in, not approved                   → nothing at all. Signing
//     in again is not the missing step, so there is no path to offer and no
//     control to draw.
//
// Feature-gated by config/features.sessionBookmarks upstream in
// SessionActions; the eligibility above is ProfileContext's `attendeeAccess`
// (spec §3.4's hasAttendeeAccess predicate, shared with the server).
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useProfile } from '../../contexts/ProfileContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { setSessionBookmarked } from '../../lib/bookmarksSource.js';
import { rowActionClass } from './sessionActionClass.js';

/**
 * @param {{ session: { id: string }, bookmarked?: boolean }} props
 */
export default function BookmarkAction({ session, bookmarked = false }) {
  const { user } = useAuth();
  const { attendeeAccess } = useProfile();
  const { showToast } = useToast();
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
  const isBookmarked = optimistic ?? bookmarked;

  // Keyed on the session and the signed-in identity too: switching users
  // (or the card being reused for a different session without a fresh
  // mount) must not carry a stale optimistic value across the switch.
  useEffect(() => {
    setOptimistic(null);
  }, [bookmarked, session.id, user?.uid]);

  const onClick = useCallback(async () => {
    if (!user) return; // rendered as a sign-in link instead, see below
    const next = !isBookmarked;
    setOptimistic(next);
    setPending(true);
    try {
      await setSessionBookmarked({ user, sessionId: session.id, bookmarked: next });
    } catch (err) {
      setOptimistic(null);
      showToast(err.message || 'The bookmark could not be saved.', { tone: 'error' });
    } finally {
      setPending(false);
    }
  }, [user, isBookmarked, session.id, showToast]);

  if (!user) {
    return (
      <Link to="/signin" className={rowActionClass}>
        Sign in to save sessions
      </Link>
    );
  }

  // Signed in and not eligible: no control, no explanation under every row.
  // The registration state the visitor needs to change is stated once,
  // where it can be acted on, not repeated as dead furniture down the
  // whole programme.
  if (!attendeeAccess) return null;

  return (
    <button
      type="button"
      className={rowActionClass}
      onClick={onClick}
      disabled={pending}
      aria-pressed={isBookmarked}
    >
      <span aria-hidden="true">{isBookmarked ? '★' : '☆'}</span>
      {isBookmarked ? 'Bookmarked' : 'Bookmark'}
    </button>
  );
}
