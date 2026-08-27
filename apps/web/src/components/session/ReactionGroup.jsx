// ReactionGroup — the emoji reactions on a session (spec §9).
//
// Was ReactionsPill, and it was on every schedule row: five targets per
// session, times thirty sessions, on a page whose job is to tell a reader
// where to be at ten past nine. Reacting is something you do to a session
// you have decided about, not while you are still scanning for one.
//
// So it renders on the session's DETAIL page and nowhere else.
// SessionActions refuses to render it on a row (`surface: 'row'`), which
// makes the placement a property of the component set rather than a habit
// each caller has to remember.
//
// This is the one place a session control is still boxed. A set of small
// pressed/unpressed targets needs a visible edge to read as a set, and on
// the detail page there is exactly one such set — see
// session/sessionActionClass.js.
//
// The aggregate counts are public (rules: public read of
// sessionReactions/{sessionId}) so every visitor — signed out included —
// sees them; only the click itself is gated the same way BookmarkAction's
// is, by ProfileContext's `attendeeAccess`.
//
// One reaction per caller per session (the server's dedup subcollection,
// functions/src/schedule/reactions.cjs): clicking the emoji you already
// left clears it, clicking a different one switches to it.
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useProfile } from '../../contexts/ProfileContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { REACTION_KINDS, setSessionReaction } from '../../lib/reactionsSource.js';
import { useSessionReactions } from '../../hooks/useSessionReactions.js';
import { chipActionClass } from './sessionActionClass.js';

/**
 * @param {{ session: { id: string } }} props
 */
export default function ReactionGroup({ session }) {
  const { user } = useAuth();
  const { attendeeAccess } = useProfile();
  const { showToast } = useToast();
  const { counts, myReaction } = useSessionReactions(session.id);
  const [pending, setPending] = useState(false);
  // Same optimistic-override pattern as BookmarkAction: instant visual
  // feedback on click, cleared on failure AND once the live `myReaction`/
  // `counts` themselves change — whether that change is the subscription
  // confirming OUR write, a different tab's write, or the signed-in
  // identity switching. Without the second clear the optimistic value would
  // keep masking the live one forever after a successful write.
  //
  // `undefined` is a DISTINCT sentinel from `null` here: `undefined` means
  // "no override in flight — trust the live value", while `null` means "the
  // override IS an explicit clear". Collapsing them (e.g. via `?? `) would
  // make "no override" indistinguishable from "optimistically cleared":
  // an already-reacted user with no override would read as cleared (wrongly
  // decrementing their own count and showing unselected), and a real
  // optimistic clear would fall back through to the live reaction and stay
  // wrongly selected.
  const [optimistic, setOptimistic] = useState(undefined);
  const hasOverride = optimistic !== undefined;
  const myActiveReaction = hasOverride ? optimistic : myReaction;

  useEffect(() => {
    setOptimistic(undefined);
  }, [myReaction, session.id, user?.uid]);

  const onPick = useCallback(
    async (emoji) => {
      if (!user) return; // no interactive control rendered for a signed-out visitor
      const next = myActiveReaction === emoji ? null : emoji;
      setOptimistic(next);
      setPending(true);
      try {
        await setSessionReaction({ user, sessionId: session.id, emoji: next });
      } catch (err) {
        setOptimistic(undefined);
        showToast(err.message || 'The reaction could not be saved.', { tone: 'error' });
      } finally {
        setPending(false);
      }
    },
    [user, myActiveReaction, session.id, showToast],
  );

  // Optimistically nudge the displayed counts so a click feels immediate
  // even before the aggregate listener's next snapshot arrives. Only
  // adjusts when an override is actually active — with no override, `counts`
  // already reflects `myReaction` server-side, so nothing should move.
  const displayCounts = { ...counts };
  if (hasOverride) {
    if (myReaction) displayCounts[myReaction] = Math.max(0, (displayCounts[myReaction] || 0) - 1);
    if (optimistic) displayCounts[optimistic] = (displayCounts[optimistic] || 0) + 1;
  }

  const interactive = Boolean(user) && attendeeAccess;
  const hasAnyCount = REACTION_KINDS.some((emoji) => (displayCounts[emoji] || 0) > 0);
  if (!interactive && !hasAnyCount) return null;

  return (
    <span
      className="inline-flex flex-wrap items-center gap-2xs"
      role="group"
      aria-label="Session reactions"
    >
      {REACTION_KINDS.map((emoji) => {
        const count = displayCounts[emoji] || 0;
        const mine = myActiveReaction === emoji;
        if (!interactive) {
          // Signed out, or signed in without attendee access: read-only
          // counts, nothing worth rendering when a reaction has zero.
          if (count === 0) return null;
          return (
            <span key={emoji} className={chipActionClass} aria-hidden="false">
              <span aria-hidden="true">{emoji}</span> {count}
            </span>
          );
        }
        return (
          <button
            key={emoji}
            type="button"
            className={chipActionClass}
            onClick={() => onPick(emoji)}
            disabled={pending}
            aria-pressed={mine}
            aria-label={`React with ${emoji}${count ? `, ${count}` : ''}`}
          >
            <span aria-hidden="true">{emoji}</span>
            {count > 0 ? ` ${count}` : ''}
          </button>
        );
      })}
    </span>
  );
}
