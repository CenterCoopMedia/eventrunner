// SessionCard — the convergence point for every schedule feature (spec §9):
// materials/reactions/bookmarks pills are feature-flag conditional, so a
// deployment with those features off renders a plain session card and
// nothing here assumes they exist.
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useProfile } from '../contexts/ProfileContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { formatSessionTimeRange } from '../lib/eventTime.js';
import { setSessionBookmarked } from '../lib/bookmarksSource.js';
import {
  buildGoogleCalendarUrl,
  buildIcsCalendar,
  buildOutlookCalendarUrl,
  downloadIcs,
  icsFileName,
} from '../utils/calendar.js';

// TODO(m3-speakers): resolve speakerIds to speaker names (and links to the
// speakers page) once the speaker directory tranche lands in M3. Kept as a
// hook called from SessionCard's top level so the card markup gains speaker
// rows without restructuring; useContent().speakers already carries the
// snapshot shape this will read from.
export function useSessionSpeakerNames() {
  return null;
}

// TODO(materials tranche): resolve `session_materials_public` once
// functions/src/materials/ lands (spec §4.4, not built as of issue #16).
// Stubbed the same way useSessionSpeakerNames is above, so MaterialsPill's
// markup does not need to change when it does.
function useSessionMaterialsCount() {
  return null;
}

// TODO(reactions tranche): resolve `sessionReactions/{sessionId}` once
// functions/src/schedule/reactions.cjs lands (spec §9 "Session reactions",
// not built as of issue #16). Same stub pattern as the two above.
function useSessionReactionsSummary() {
  return null;
}

export function TypeBadge({ type }) {
  if (typeof type !== 'string' || !type) return null;
  // Session types are CMS vocabulary — presented, never interpreted, except
  // the platform-level keynote emphasis token from config/theme (spec §7.2).
  const isKeynote = type === 'keynote';
  return (
    <span
      className={[
        'inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize text-brand-ink',
        isKeynote ? 'border-keynote/40 bg-keynote/15' : 'border-brand-ink/15 bg-brand-ink/5',
      ].join(' ')}
    >
      {type}
    </span>
  );
}

const pillClass =
  'touch-target inline-flex items-center gap-1 rounded-full border border-brand-ink/15 px-3 py-1 text-sm text-brand-ink transition-colors hover:bg-brand-surface-alt disabled:cursor-not-allowed disabled:opacity-50';

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
      <Link to="/signin" className={pillClass}>
        <span aria-hidden="true">☆</span> Sign in to bookmark
      </Link>
    );
  }

  if (!attendeeAccess) {
    return (
      <span
        className={pillClass}
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
      className={pillClass}
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
      <button type="button" className={pillClass} onClick={onDownload}>
        .ics
      </button>
      {googleUrl ? (
        <a href={googleUrl} target="_blank" rel="noreferrer" className={pillClass}>
          Google
        </a>
      ) : null}
      {outlookUrl ? (
        <a href={outlookUrl} target="_blank" rel="noreferrer" className={pillClass}>
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
    <span className={pillClass}>
      <span aria-hidden="true">📎</span> {count} {count === 1 ? 'material' : 'materials'}
    </span>
  );
}

function ReactionsPill({ session }) {
  const summary = useSessionReactionsSummary(session);
  if (!summary) return null;
  return <span className={pillClass}>{summary}</span>;
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
    <li>
      <article
        className={[
          'grid gap-2 rounded-brand border border-brand-ink/10 bg-brand-surface-alt p-4 sm:grid-cols-[9.5rem,1fr] sm:gap-4',
          session.type === 'keynote' ? 'border-s-4 border-s-keynote' : '',
        ].join(' ')}
      >
        <p className="text-sm text-brand-ink-muted">
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
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-brand-ink">
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
            <p className="mt-1 text-sm text-brand-ink-muted">{session.location}</p>
          ) : null}
          {session.description ? (
            <p className="mt-2 max-w-prose text-brand-ink-muted" style={{ textWrap: 'pretty' }}>
              {session.description}
            </p>
          ) : null}
          {speakerNames ? (
            <p className="mt-2 text-sm text-brand-ink-muted">{speakerNames}</p>
          ) : null}
          <div className="mt-3">
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
