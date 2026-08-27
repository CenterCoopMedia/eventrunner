// SessionCard — the convergence point for every schedule feature (spec §9):
// materials/reactions/bookmarks pills are feature-flag conditional, so a
// deployment with those features off renders a plain session card and
// nothing here assumes they exist.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useContent } from '../contexts/ContentContext.jsx';
import { useProfile } from '../contexts/ProfileContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { formatSessionTimeRange } from '../lib/eventTime.js';
import { setSessionBookmarked } from '../lib/bookmarksSource.js';
import { useSessionMaterialsCount } from '../hooks/useSessionMaterials.js';
import { REACTION_KINDS, setSessionReaction } from '../lib/reactionsSource.js';
import { useSessionReactions } from '../hooks/useSessionReactions.js';
import {
  buildGoogleCalendarUrl,
  buildIcsCalendar,
  buildOutlookCalendarUrl,
  downloadIcs,
  icsFileName,
} from '../utils/calendar.js';

/**
 * Resolve a session's `speakerIds` against the live `speakers_public`
 * projection `useContent().speakers` carries (spec §4.3, issue #22).
 * Returns the ordered list of `{ id, displayName, slug }` the caller
 * renders as links to `/speakers/:slug` — an id with no matching document
 * (not yet approved, or removed since the session was saved) is silently
 * dropped rather than rendered as a broken link, the same "no document,
 * nothing shown" rule the public speaker page itself follows.
 *
 * A hook (not a plain function) because it reads ContentContext; kept
 * separate from SessionCard's body so SessionDetail can call it too
 * without re-deriving the same list a different way.
 *
 * @param {string[] | undefined} speakerIds
 * @returns {Array<{ id: string, displayName: string, slug: string }>}
 */
export function useSessionSpeakerNames(speakerIds) {
  const { speakers } = useContent();
  return useMemo(() => {
    if (!Array.isArray(speakerIds) || speakerIds.length === 0) return [];
    const byId = new Map(speakers.map((speaker) => [speaker.id, speaker]));
    return speakerIds
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((speaker) => ({
        id: speaker.id,
        displayName: speaker.displayName,
        slug: typeof speaker.slug === 'string' && speaker.slug ? speaker.slug : speaker.id,
      }));
  }, [speakerIds, speakers]);
}

/**
 * The comma-joined speaker row SessionCard and SessionDetail share.
 *
 * Links only when `features.speakers` is on (issue #22 review finding
 * P2-7): the public speaker directory route itself gates on that flag
 * (Speakers.jsx, SpeakerDetail.jsx) and shows "this event doesn't have a
 * public speaker directory" for it, so a deployment with the feature off
 * must not send a schedule-card click into that dead end — plain,
 * unlinked names still tell the reader who is speaking.
 *
 * Carries the current query string into the link (issue #22 review finding
 * P2-8), the same fix SessionCard's title link already has for
 * `?preview=1`: without it, an admin previewing drafts who clicks a
 * speaker's name loses the preview the moment they land on the speaker
 * page.
 */
export function SpeakerNames({
  speakers,
  features = {},
  className = 'mt-2xs font-data text-caption text-text-secondary',
}) {
  const { search } = useLocation();
  if (!speakers || speakers.length === 0) return null;
  return (
    <p className={className}>
      {speakers.map((speaker, index) => (
        <span key={speaker.id}>
          {index > 0 ? ', ' : ''}
          {features.speakers ? (
            <Link to={{ pathname: `/speakers/${speaker.slug}`, search }} className="hover:underline">
              {speaker.displayName}
            </Link>
          ) : (
            speaker.displayName
          )}
        </span>
      ))}
    </p>
  );
}

/**
 * The session type as a small ruled rectangle beside the title (issue #113).
 *
 * It is not a pill: the fully rounded shape is a rejected pattern (design
 * brief §2.4), and the radius is now `--radius-base`, which the concentric
 * radius rule keeps in step with everything else the theme draws (interface
 * guidelines, User interface). Keynote emphasis is a flat tint plus the word
 * itself — never a colored edge, and never color alone (§8.1).
 */
export function TypeBadge({ type }) {
  if (typeof type !== 'string' || !type) return null;
  // Session types are CMS vocabulary — presented, never interpreted, except
  // the platform-level keynote emphasis token from config/theme (spec §7.2).
  const isKeynote = type === 'keynote';
  return (
    <span
      className={[
        'inline-flex items-center whitespace-nowrap rounded-brand border-hairline px-2xs py-3xs font-data text-folio font-medium uppercase text-text-primary',
        isKeynote ? 'border-keynote/40 bg-keynote/10' : 'border-rule-hairline bg-surface-alt',
      ].join(' ')}
      style={{ letterSpacing: 'var(--text-folio-tracking)' }}
    >
      {type}
    </span>
  );
}

// The feature-flag controls under a session. Rectangles on the theme radius,
// not pills (brief §2.4): the same shape rule TypeBadge now follows.
const actionClass =
  'touch-target inline-flex items-center gap-1 rounded-brand border-hairline border-rule-hairline px-sm py-2xs font-data text-caption text-text-primary transition-colors duration-fast ease-motion hover:bg-brand-surface-alt disabled:cursor-not-allowed disabled:opacity-50';

/**
 * Bookmark toggle pill (spec §9 "Bookmarks"). Feature-gated by
 * config/features.sessionBookmarks; the click itself is gated by
 * ProfileContext's `attendeeAccess` (spec §3.4's hasAttendeeAccess predicate,
 * shared with the server) — signed-out visitors see a "sign in" prompt,
 * signed-in non-attendees see a disabled pill naming the requirement, and
 * approved attendees (or speakers, or admins) get a working toggle.
 */
function BookmarkPill({ session, bookmarked }) {
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
      <Link to="/signin" className={actionClass}>
        <span aria-hidden="true">☆</span> Sign in to bookmark
      </Link>
    );
  }

  if (!attendeeAccess) {
    return (
      <span
        className={actionClass}
        aria-disabled="true"
        title="Bookmarking is available to approved attendees."
      >
        <span aria-hidden="true">☆</span> Bookmark
      </span>
    );
  }

  return (
    <button
      type="button"
      className={actionClass}
      onClick={onClick}
      disabled={pending}
      aria-pressed={isBookmarked}
    >
      <span aria-hidden="true">{isBookmarked ? '★' : '☆'}</span>
      {isBookmarked ? 'Bookmarked' : 'Bookmark'}
    </button>
  );
}

/** Add-to-calendar pill: ICS download plus Google/Outlook deep links (spec
 * §9 — the replacement for the removed direct Google Calendar OAuth sync). */
function CalendarPill({ eventConfig, session }) {
  const googleUrl = buildGoogleCalendarUrl(eventConfig, session);
  const outlookUrl = buildOutlookCalendarUrl(eventConfig, session);
  // The session's time could not be resolved (spec: fail soft) — nothing to
  // add to a calendar.
  if (!googleUrl && !outlookUrl) return null;

  const onDownload = () => {
    const ics = buildIcsCalendar(eventConfig, [session]);
    downloadIcs(icsFileName(session.title), ics);
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-sm text-brand-ink-muted">
      <span aria-hidden="true">Add to calendar:</span>
      <button type="button" className={actionClass} onClick={onDownload}>
        .ics
      </button>
      {googleUrl ? (
        <a href={googleUrl} target="_blank" rel="noreferrer" className={actionClass}>
          Google
        </a>
      ) : null}
      {outlookUrl ? (
        <a href={outlookUrl} target="_blank" rel="noreferrer" className={actionClass}>
          Outlook
        </a>
      ) : null}
    </span>
  );
}

function MaterialsPill({ session }) {
  const count = useSessionMaterialsCount(session);
  if (!count) return null;
  return (
    <span className={actionClass}>
      <span aria-hidden="true">📎</span> {count} {count === 1 ? 'material' : 'materials'}
    </span>
  );
}

/**
 * Emoji reaction bar (spec §9 "Session reactions"). Feature-gated by
 * config/features.sessionReactions. The aggregate counts are public (rules:
 * public read of sessionReactions/{sessionId}) so every visitor — signed
 * out included — sees them; only the click itself is gated the same way
 * BookmarkPill's is, by ProfileContext's `attendeeAccess`.
 *
 * One reaction per caller per session (the server's dedup subcollection,
 * functions/src/schedule/reactions.cjs): clicking the emoji you already
 * left clears it, clicking a different one switches to it.
 */
function ReactionsPill({ session }) {
  const { user } = useAuth();
  const { attendeeAccess } = useProfile();
  const { showToast } = useToast();
  const { counts, myReaction } = useSessionReactions(session.id);
  const [pending, setPending] = useState(false);
  // Same optimistic-override pattern as BookmarkPill above: instant visual
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
    <span className="inline-flex flex-wrap items-center gap-1" role="group" aria-label="Session reactions">
      {REACTION_KINDS.map((emoji) => {
        const count = displayCounts[emoji] || 0;
        const mine = myActiveReaction === emoji;
        if (!interactive) {
          // Signed out, or signed in without attendee access: read-only
          // counts, nothing worth rendering when a reaction has zero.
          if (count === 0) return null;
          return (
            <span key={emoji} className={actionClass} aria-hidden="false">
              <span aria-hidden="true">{emoji}</span> {count}
            </span>
          );
        }
        return (
          <button
            key={emoji}
            type="button"
            className={actionClass}
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

/**
 * The feature-flag-conditional pill row on its own — SessionCard renders it
 * inline; SessionDetail.jsx renders it standalone so a session's detail
 * page doesn't have to re-render the whole card (title/time/description
 * again) just to get the bookmark/materials/reactions/calendar controls.
 *
 * @param {{ session: object, eventConfig: object, features?: object,
 *           bookmarked?: boolean }} props
 */
export function SessionPills({ session, eventConfig, features = {}, bookmarked = false }) {
  const hasPills =
    features.sessionBookmarks || features.sessionMaterials || features.sessionReactions || features.icsExport;
  if (!hasPills) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {features.sessionBookmarks ? <BookmarkPill session={session} bookmarked={bookmarked} /> : null}
      {features.sessionMaterials ? <MaterialsPill session={session} /> : null}
      {features.sessionReactions ? <ReactionsPill session={session} /> : null}
      {features.icsExport ? <CalendarPill eventConfig={eventConfig} session={session} /> : null}
    </div>
  );
}

/**
 * @param {{ session: object, eventConfig: object, features?: object,
 *           bookmarked?: boolean, linkToDetail?: boolean }} props
 */
export default function SessionCard({
  session,
  eventConfig,
  features = {},
  bookmarked = false,
  linkToDetail = true,
}) {
  const speakerNames = useSessionSpeakerNames(session.speakerIds);
  const range = formatSessionTimeRange(eventConfig, session);
  // Carries the current query string (notably ?preview=1) into the detail
  // link — react-router resets the URL's search to nothing on a bare
  // pathname `to`, so without this an admin previewing drafts would flip
  // back to published content just by clicking a session title.
  const { search } = useLocation();

  return (
    // A ruled entry in a printed programme, not a card (design brief §2.1):
    // a hairline opens the row, the time sits in the mono face as a true
    // left-hand column with tabular figures, and the type is a word beside
    // the title. Issue #113: the colored left edge is gone, and nothing
    // replaces it — a rule does the dividing a card border used to.
    <li className="border-t-hairline border-t-rule-hairline">
      <article className="grid gap-2xs py-md sm:grid-cols-[9.5rem,1fr] sm:gap-md">
        <p className="font-mono text-caption text-text-secondary">
          {range ? (
            <>
              <time dateTime={range.startIso}>{range.startLabel}</time>
              {range.endLabel ? (
                <>
                  –<time dateTime={range.endIso}>{range.endLabel}</time>
                </>
              ) : null}
              {range.zone ? <span className="ms-1">{range.zone}</span> : null}
            </>
          ) : (
            <span>Time to be announced</span>
          )}
        </p>
        <div>
          <div className="flex flex-wrap items-baseline gap-x-sm gap-y-2xs">
            <h3 className="font-heading text-h3 font-semibold text-text-primary">
              {linkToDetail ? (
                <Link to={{ pathname: `/schedule/${session.id}`, search }} className="hover:underline">
                  {session.title}
                </Link>
              ) : (
                session.title
              )}
            </h3>
            <TypeBadge type={session.type} />
          </div>
          {session.location ? (
            <p className="mt-2xs font-data text-caption text-text-secondary">{session.location}</p>
          ) : null}
          {session.description ? (
            <p
              className="mt-xs max-w-prose text-body text-text-secondary"
              style={{ textWrap: 'pretty' }}
            >
              {session.description}
            </p>
          ) : null}
          <SpeakerNames speakers={speakerNames} features={features} />
          <div className="mt-sm">
            <SessionPills
              session={session}
              eventConfig={eventConfig}
              features={features}
              bookmarked={bookmarked}
            />
          </div>
        </div>
      </article>
    </li>
  );
}
