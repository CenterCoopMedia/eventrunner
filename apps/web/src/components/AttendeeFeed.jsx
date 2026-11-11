// The private attendee feed on the directory page (issue #788, the
// attendee half of #507; backend #506).
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
// The Firestore rules are the boundary. This gate only decides whether to
// ask, so a closed or unknown state costs nothing and leaks nothing.
//
// WHOSE DATA. Posts, author names, how far back the feed is loaded, and
// report state are stored WITH the key they were read for: the reader's
// uid and an access session number while the feed is open, null otherwise.
// The session number moves on each time access closes, so state left by a
// closed session (a report still in flight, say) never returns when the
// same reader's access opens again. A render shows only state whose key
// matches its own, so an account switch, a sign-out, a revoked grant, or a
// flag turned off hides the previous reader's feed in that same render, before any
// cleanup effect runs. The verdicts the key is built from are bound to
// their account at the source (AuthContext, ProfileContext), so a stale
// verdict for account A cannot open the feed for account B. A listener
// callback or a report that completes after its key is gone is dropped.
//
// AUTHORS. A name comes only from the author's users_public projection,
// read from the server one author at a time (lib/socialFeedSource.js
// fetchAuthorName), never from the cache. A
// private, missing, or unreadable profile resolves null and shows a
// neutral, unlinked "An attendee"; it never fails the feed and never reads
// `users`.
//
// REPORTS. Each post has a Report action with a confirmation step. It sends
// only the post id. A failed request offers a retry; the server's
// idempotency makes a retry after a lost response safe. One request per
// post is in flight at a time. Report counts, rows, and reporters are never
// shown here.
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { useProfile } from '../contexts/ProfileContext.jsx';
import { IS_DEMO } from '../lib/demoMode.js';
import {
  FEED_PAGE_SIZE,
  fetchAuthorName,
  fetchOlderPage,
  reportSocialPost,
  subscribeRootFeed,
} from '../lib/socialFeedSource.js';
import EmptyState from './EmptyState.jsx';
import LoadingState from './LoadingState.jsx';
import SectionHead from './editorial/SectionHead.jsx';
import {
  primaryActionClass,
  quietActionClass,
  secondaryActionClass,
  textControlStateClass,
} from './controlClasses.js';

const AUTHOR_FALLBACK = 'An attendee';
const NO_OLDER = Object.freeze({ through: null, more: false, loading: false, failed: false });
const NO_FEED = Object.freeze({ posts: null, last: null, size: 0, range: null, failed: false, denied: false });

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
  const accountGrant = profileConfirmed === true && profile != null
    && (profile.registrationStatus === 'approved'
      || (profile.speakerId !== undefined && profile.speakerId !== null));
  const staffGrant = adminStatus === 'admin' && adminConfirmed === true;
  if (accountGrant || staffGrant) return 'open';
  if (profileStatus !== 'ready' || profileConfirmed !== true || adminStatus !== 'denied') return 'checking';
  return 'denied';
}

/** Firestore Timestamp, Date, or epoch millis; anything else is null. */
function toDate(value) {
  if (!value) return null;
  const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
  return date instanceof Date && Number.isFinite(date.getTime()) ? date : null;
}

/** The display name a projection carries, or ''. */
function projectionName(projection) {
  const name = projection?.displayName;
  return typeof name === 'string' ? name.trim() : '';
}

/** Keyed state: the value for `key`, or `fallback` when it belongs to another key. */
function own(state, key, fallback) {
  return key !== null && state.key === key ? state.value : fallback;
}

function FeedPost({ post, author, report, onReport, onConfirm, onCancel }) {
  const headId = useId();
  const confirmRef = useRef(null);
  const doneRef = useRef(null);
  const triggerRef = useRef(null);
  const asked = useRef(false);
  const phase = report?.phase ?? 'idle';
  const name = projectionName(author);
  const posted = toDate(post.createdAt);

  useEffect(() => {
    // Keep focus in the post: on the send button when the question opens,
    // and on the confirmation once the buttons are gone.
    // A cancel returns focus to the Report button it came from.
    if (phase === 'confirm') confirmRef.current?.focus();
    if (phase === 'done') doneRef.current?.focus();
    if (phase === 'idle' && asked.current) triggerRef.current?.focus();
    asked.current = phase === 'confirm' || phase === 'failed';
  }, [phase]);

  return (
    <li className="border-t-hairline border-t-rule-hairline py-sm">
      <div id={headId} className="flex flex-wrap items-baseline gap-x-sm gap-y-2xs">
        {name && post.authorUid ? (
          <Link
            to={`/attendees/${post.authorUid}`}
            className="font-heading text-body font-semibold text-text-primary hover:underline"
          >
            {name}
          </Link>
        ) : (
          <span className="font-heading text-body font-semibold text-text-primary">{AUTHOR_FALLBACK}</span>
        )}
        {posted ? (
          <time dateTime={posted.toISOString()} className="font-mono text-caption text-text-secondary">
            {posted.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
          </time>
        ) : null}
      </div>
      {/* A text child: React escapes it, so a post can never become markup. */}
      <p className="mt-2xs max-w-prose whitespace-pre-wrap text-body [overflow-wrap:anywhere] text-text-primary">
        {post.text}
      </p>
      <div className="mt-2xs">
        {phase === 'idle' ? (
          <button
            ref={triggerRef}
            type="button"
            className={`${textControlStateClass} touch-target inline-flex items-center font-data text-caption font-medium text-text-secondary underline underline-offset-4`}
            aria-describedby={headId}
            onClick={onReport}
          >
            Report post
          </button>
        ) : null}
        {phase === 'confirm' || phase === 'sending' || phase === 'failed' ? (
          <div role="group" aria-labelledby={`${headId}-ask`} className="flex flex-col gap-xs">
            <p id={`${headId}-ask`} className="text-caption text-text-secondary">
              Report this post to the event staff? Staff review every report. Other attendees do not see
              who reported it.
            </p>
            {phase === 'failed' ? (
              <p role="alert" className="text-caption text-danger">
                {report.error}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-xs">
              <button
                ref={confirmRef}
                type="button"
                className={primaryActionClass}
                disabled={phase === 'sending'}
                aria-busy={phase === 'sending' || undefined}
                onClick={onConfirm}
              >
                {phase === 'sending' ? 'Sending report…' : phase === 'failed' ? 'Try again' : 'Send report'}
              </button>
              <button
                type="button"
                className={secondaryActionClass}
                disabled={phase === 'sending'}
                onClick={onCancel}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
        {phase === 'done' ? (
          <p ref={doneRef} tabIndex={-1} role="status" className="text-caption text-text-secondary">
            Reported. Staff will review this post.
          </p>
        ) : null}
      </div>
    </li>
  );
}

export default function AttendeeFeed() {
  const { features, sources, available } = useEventConfig();
  const { user, adminStatus, adminConfirmed } = useAuth();
  const { uid, profile, status: profileStatus, profileConfirmed } = useProfile();

  const access = feedAccess({
    sources, available, features, uid, profile, profileStatus, profileConfirmed, adminStatus, adminConfirmed,
  });
  const open = access === 'open';
  // Moves on after every closed spell; see "WHOSE DATA" above.
  const [session, setSession] = useState(0);
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) setSession((n) => n + 1);
    wasOpen.current = open;
  }, [open]);
  const feedKey = open ? `${uid}\u0000${session}` : null;

  // How far back the feed is loaded: `through` is the oldest loaded document
  // (null = the newest page only), `more` whether the last older fetch was
  // a full page, `loading` and `failed` the state of "Show older posts".
  const [older, setOlder] = useState({ key: null, value: NO_OLDER });
  const [snapshot, setSnapshot] = useState({ key: null, value: NO_FEED });
  const [authors, setAuthors] = useState({ key: null, value: {} });
  const [reports, setReports] = useState({ key: null, value: {} });

  const loaded = own(older, feedKey, NO_OLDER);
  const through = loaded.through;
  const feed = own(snapshot, feedKey, NO_FEED);
  const authorMap = own(authors, feedKey, {});
  const reportMap = own(reports, feedKey, {});

  // The key the async work below may still write for. Async completions
  // compare against it; the render-time key match above is what hides.
  const activeKey = useRef(feedKey);
  const requestedAuthors = useRef({ key: null, uids: new Set() });
  const inFlight = useRef(new Set());
  useEffect(() => {
    activeKey.current = feedKey;
  }, [feedKey]);

  useEffect(() => {
    if (feedKey === null) return undefined;
    let current = true;
    const unsubscribe = subscribeRootFeed(
      { through },
      (posts, page) => {
        if (current) {
          setSnapshot({ key: feedKey, value: { posts, last: page.last, size: page.size, range: through, failed: false, denied: false } });
        }
      },
      (error) => {
        if (!current) return;
        setSnapshot({
          key: feedKey,
          value: { ...NO_FEED, failed: true, denied: error?.code === 'permission-denied' },
        });
      },
    );
    return () => {
      current = false;
      unsubscribe();
    };
  }, [feedKey, through]);

  // Author names: one best-effort read per author, once per reader.
  const posts = feed.posts;
  useEffect(() => {
    if (feedKey === null || !posts) return;
    if (requestedAuthors.current.key !== feedKey) {
      requestedAuthors.current = { key: feedKey, uids: new Set() };
    }
    const asked = requestedAuthors.current.uids;
    for (const post of posts) {
      const authorUid = post.authorUid;
      if (!authorUid || asked.has(authorUid)) continue;
      asked.add(authorUid);
      fetchAuthorName(authorUid).then((name) => {
        if (activeKey.current !== feedKey) return;
        const entry = name ? { displayName: name } : null;
        setAuthors((prev) => ({
          key: feedKey,
          value: { ...(prev.key === feedKey ? prev.value : {}), [authorUid]: entry },
        }));
      });
    }
  }, [feedKey, posts]);

  function setReport(key, postId, next) {
    setReports((prev) => {
      if (activeKey.current !== key && prev.key !== key) return prev;
      const base = prev.key === key ? prev.value : {};
      return { key, value: { ...base, [postId]: next } };
    });
  }

  // One bounded fetch past the oldest loaded post; the listener then
  // re-attaches through the new oldest post, so every loaded post stays live.
  async function loadOlder() {
    const key = feedKey;
    // An empty loaded range (every post in it removed) pages on from the
    // retained cursor.
    // The listener's own oldest document only once it reports the current
    // range: right after a fetch the old range's snapshot is still shown,
    // and paging from it would fetch the same page again.
    const after = (feed.range === through ? feed.last : null) ?? through;
    if (key === null || !after || loaded.loading) return;
    const base = { ...loaded, loading: false, failed: false };
    setOlder({ key, value: { ...base, loading: true } });
    const result = await fetchOlderPage(after);
    if (activeKey.current !== key) return;
    if (!result.ok) {
      setOlder({ key, value: { ...base, failed: true } });
    } else if (!result.last) {
      setOlder({ key, value: { ...base, through: through ?? after, more: false } });
    } else {
      setOlder({ key, value: { through: result.last, more: result.size >= FEED_PAGE_SIZE, loading: false, failed: false } });
    }
  }

  async function sendReport(postId) {
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

  if (access === 'closed') return null;

  let body;
  if (access === 'checking') {
    body = <LoadingState shape="rows" label="Loading the attendee feed…" />;
  } else if (access === 'denied' || feed.denied) {
    body = (
      <p className="max-w-prose text-body text-text-secondary">
        The attendee feed is open to approved attendees and speakers. It opens for you once your
        registration is approved.
      </p>
    );
  } else if (feed.failed) {
    body = (
      <EmptyState
        title="The feed is unavailable right now"
        description="This is usually temporary. The page keeps trying in the background."
      />
    );
  } else if (posts === null) {
    body = <LoadingState shape="rows" label="Loading the attendee feed…" />;
  } else if (posts.length === 0 && !(through !== null && loaded.more)) {
    body = <EmptyState title="No posts yet" description="Posts from attendees appear here." />;
  } else {
    const more = through === null ? feed.size >= FEED_PAGE_SIZE : loaded.more;
    body = (
      <>
        <ul>
          {posts.map((post) => (
            <FeedPost
              key={post.id}
              post={post}
              author={post.authorUid ? authorMap[post.authorUid] : null}
              report={reportMap[post.id]}
              onReport={() => setReport(feedKey, post.id, { phase: 'confirm' })}
              onConfirm={() => sendReport(post.id)}
              onCancel={() => setReport(feedKey, post.id, undefined)}
            />
          ))}
        </ul>
        {loaded.failed ? (
          <p role="alert" className="mt-sm text-caption text-danger">
            Older posts could not be loaded. Try again.
          </p>
        ) : null}
        {more ? (
          <button
            type="button"
            className={`${quietActionClass} mt-sm`}
            disabled={loaded.loading}
            aria-busy={loaded.loading || undefined}
            onClick={loadOlder}
          >
            {loaded.loading ? 'Loading older posts…' : 'Show older posts'}
          </button>
        ) : null}
      </>
    );
  }

  return (
    <section aria-labelledby="attendee-feed-title" className="mt-lg">
      <SectionHead id="attendee-feed-title" title="Attendee feed" level={2} rule="hairline" />
      <div className="mt-sm">{body}</div>
    </section>
  );
}
