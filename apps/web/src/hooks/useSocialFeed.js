// Access, identity keys, author names and reports for the private attendee
// feed (issue #788) and its threads (issue #511). The feed and the thread
// page share this module, so both open, close and forget data in the same
// way.
//
// WHO SEES IT. Nothing is requested until all of these hold for the
// current render:
//
//   - config/features itself is live (`sources.features === 'live'`) and
//     still present and listening (`available.features`): the generated
//     snapshot, a sibling config document that arrived first, or the last
//     values of a deleted or failing document never open the feed;
//   - `socialFeed === true` and `attendeeDirectory === true` (a missing,
//     malformed, or false flag is off);
//   - the signed-in account holds a current grant, confirmed by the server
//     (never a local cache answer): its own account document says approved
//     or speaker (the rules' requesterIsApprovedAttendee), or the admin
//     probe answered "admin" for this same user (an independent current
//     staff or operator grant in config/bootstrap). A public profile or a
//     stored `role` grants nothing.
//
// WHO WRITES. Posting and replying need the account grant itself. A staff
// grant alone opens reading and moderation, never the composer; the server
// (createSocialPost) refuses it too.
//
// The Firestore rules and the endpoints are the boundary. This gate only
// decides whether to ask, so a closed or unknown state costs nothing and
// leaks nothing.
//
// WHOSE DATA. Every piece of feed state is stored WITH the key it was read
// for: the reader's uid and an access session number while the feed is
// open, null otherwise. The session number moves on each time access
// closes, so state left by a closed session (a report still in flight,
// say) never returns when the same reader's access opens again. A render
// shows only state whose key matches its own, so an account switch, a
// sign-out, a revoked grant, or a flag turned off hides the previous
// reader's data in that same render, before any cleanup effect runs. The
// verdicts the key is built from are bound to their account at the source
// (AuthContext, ProfileContext), so a stale verdict for account A cannot
// open the feed for account B. Async work that completes after its key is
// gone is dropped.
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { useProfile } from '../contexts/ProfileContext.jsx';
import { IS_DEMO } from '../lib/demoMode.js';
import { fetchAuthorName, reportSocialPost } from '../lib/socialFeedSource.js';

/** The account's own grant, from a server-confirmed account document only. */
function accountGrant(profile, profileConfirmed) {
  return profileConfirmed === true && profile != null
    && (profile.registrationStatus === 'approved'
      || (profile.speakerId !== undefined && profile.speakerId !== null));
}

/**
 * Whether this reader may ask for the feed now.
 *
 * @returns {'closed'|'checking'|'denied'|'open'}
 *   closed: the feature is off or unresolved, or nobody is signed in;
 *   checking: the reader's grants are not known yet;
 *   denied: signed in, the feature is on, and there is no grant;
 *   open: ask for the feed.
 */
export function feedAccess({
  demo = IS_DEMO, sources, available, features, uid,
  profile, profileStatus, profileConfirmed, adminStatus, adminConfirmed,
}) {
  if (demo || !uid) return 'closed';
  if (sources?.features !== 'live' || available?.features !== true) return 'closed';
  if (features?.socialFeed !== true || features?.attendeeDirectory !== true) return 'closed';
  // A grant counts only once the server confirmed it: a cached account
  // document or admin probe can predate a revocation.
  const staffGrant = adminStatus === 'admin' && adminConfirmed === true;
  if (accountGrant(profile, profileConfirmed) || staffGrant) return 'open';
  if (profileStatus !== 'ready' || profileConfirmed !== true || adminStatus !== 'denied') return 'checking';
  return 'denied';
}

/** Whether this reader may post and reply: the feed is open AND the account holds its own grant. */
export function composeAccess(input) {
  return feedAccess(input) === 'open' && accountGrant(input.profile, input.profileConfirmed);
}

/** Keyed state: the value for `key`, or `fallback` when it belongs to another key. */
export function own(state, key, fallback) {
  return key !== null && state.key === key ? state.value : fallback;
}

/**
 * The current reader's access and the key its data is stored under.
 *
 * @returns {{ access: string, resolving: boolean, compose: boolean, feedKey: string|null, uid: string|null,
 *             user: object|null, activeKey: { current: string|null } }}
 *   `activeKey` is the key async work may still write for.
 */
export function useSocialAccess() {
  const { features, sources, available, featuresStatus } = useEventConfig();
  const { user, adminStatus, adminConfirmed, loading } = useAuth();
  const { uid, profile, status: profileStatus, profileConfirmed } = useProfile();
  const input = {
    sources, available, features, uid, profile, profileStatus, profileConfirmed, adminStatus, adminConfirmed,
  };
  const access = feedAccess(input);
  const featuresClosed = featuresStatus === 'gone'
    || (featuresStatus === 'confirmed' && (features?.socialFeed !== true || features?.attendeeDirectory !== true));
  const resolving = !IS_DEMO && !featuresClosed
    && (loading || (Boolean(uid) && featuresStatus !== 'confirmed'));
  const open = access === 'open';
  // Moves on after every closed spell; see "WHOSE DATA" above.
  const [session, setSession] = useState(0);
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) setSession((n) => n + 1);
    wasOpen.current = open;
  }, [open]);
  const feedKey = open ? `${uid}\u0000${session}` : null;
  // Async completions compare against this; the render-time key match is
  // what hides.
  const activeKey = useRef(feedKey);
  useEffect(() => {
    activeKey.current = feedKey;
  }, [feedKey]);
  return { access, resolving, compose: open && composeAccess(input), feedKey, uid, user, activeKey };
}

/**
 * Author names for `entries`: one best-effort users_public read per author,
 * once per reader (lib/socialFeedSource.js fetchAuthorName). A private,
 * missing, or unreadable profile resolves null; it never reads `users`.
 *
 * @returns {Record<string, { displayName: string }|null>}
 */
export function useAuthorNames(feedKey, activeKey, entries) {
  const [authors, setAuthors] = useState({ key: null, value: {} });
  const requested = useRef({ key: null, uids: new Set() });
  useEffect(() => {
    if (feedKey === null || !entries) return;
    if (requested.current.key !== feedKey) {
      requested.current = { key: feedKey, uids: new Set() };
    }
    const asked = requested.current.uids;
    for (const entry of entries) {
      const authorUid = entry?.authorUid;
      if (!authorUid || asked.has(authorUid)) continue;
      asked.add(authorUid);
      fetchAuthorName(authorUid).then((name) => {
        if (activeKey.current !== feedKey) return;
        const value = name ? { displayName: name } : null;
        setAuthors((prev) => ({
          key: feedKey,
          value: { ...(prev.key === feedKey ? prev.value : {}), [authorUid]: value },
        }));
      });
    }
  }, [feedKey, activeKey, entries]);
  return own(authors, feedKey, {});
}

/**
 * Report state per post. Each report sends only the post id; a failed
 * request offers a retry, and the server's idempotency makes a retry after
 * a lost response safe. One request per post is in flight at a time.
 *
 * @returns {{ reports: Record<string, object>, ask: (id: string) => void,
 *             send: (id: string) => Promise<void>, cancel: (id: string) => void }}
 */
export function useSocialReports(feedKey, activeKey, user) {
  const [reports, setReports] = useState({ key: null, value: {} });
  const inFlight = useRef(new Set());

  function setReport(key, postId, next) {
    setReports((prev) => {
      if (activeKey.current !== key && prev.key !== key) return prev;
      const base = prev.key === key ? prev.value : {};
      return { key, value: { ...base, [postId]: next } };
    });
  }

  async function send(postId) {
    const key = feedKey;
    const flight = `${key}\u0000${postId}`;
    if (key === null || inFlight.current.has(flight)) return;
    inFlight.current.add(flight);
    setReport(key, postId, { phase: 'sending' });
    try {
      const result = await reportSocialPost({ user, postId });
      if (activeKey.current !== key) return;
      setReport(key, postId, result.ok ? { phase: 'done' } : { phase: 'failed', error: result.error });
    } finally {
      inFlight.current.delete(flight);
    }
  }

  return {
    reports: own(reports, feedKey, {}),
    ask: (postId) => setReport(feedKey, postId, { phase: 'confirm' }),
    send,
    cancel: (postId) => setReport(feedKey, postId, undefined),
  };
}
