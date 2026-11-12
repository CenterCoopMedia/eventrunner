// MySchedule renders account saves and any browser saves still awaiting
// import. Signed-out and ineligible readers use only the device list.
//
// Editorial base restyle (design brief §2.1, §5.1): the day head is the same
// folio-on-a-rule SectionHead device Schedule.jsx uses, and the page actions
// are ruled rectangles rather than filled pill buttons.
import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useAuth, functionsOrigin } from '../contexts/AuthContext.jsx';
import { useContent } from '../contexts/ContentContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { useProfile } from '../contexts/ProfileContext.jsx';
import { useEventClock } from '../hooks/useEventClock.js';
import { useMyBookmarks } from '../hooks/useMyBookmarks.js';
import { useDeviceBookmarks } from '../hooks/useDeviceBookmarks.js';
import EmptyState from '../components/EmptyState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import SessionCard from '../components/SessionCard.jsx';
import SessionNote from '../components/session/SessionNote.jsx';
import ShareSchedule from '../components/schedule/ShareSchedule.jsx';
import CalendarSyncCard from '../components/schedule/CalendarSyncCard.jsx';
import SectionHead from '../components/editorial/SectionHead.jsx';
import TransferLine from '../components/TransferLine.jsx';
import { isBackIssue } from '../lib/backIssue.js';
import { formatDayDate } from '../lib/eventTime.js';
import { sortSessions } from '../lib/scheduleView.js';
import { buildIcsCalendar, downloadIcs, icsFileName } from '../utils/calendar.js';
import { downloadMySchedulePdf } from '../lib/schedulePdf.js';
import { sessionMovement } from 'shared/venue';
import { primaryActionClass, quietActionClass } from '../components/controlClasses.js';

// THIS IS THE ONE LIST A TRANSFER BELONGS IN (design brief §4.6;
// shared/venue.cjs).
//
// A recorded movement says what it costs to go from one place to another.
// It does not say that this reader is going. On the full schedule nobody
// is: a reader scanning the programme skipped that session, or is
// following one track out of five, and a transfer line between two
// consecutive rows would be the old inference wearing better data.
//
// Here the reader has said it themselves. These are the sessions THEY
// bookmarked, grouped by day and in programme order, so consecutive
// entries are an itinerary they wrote. Between two of them the site may
// state the walk — if, and only if, somebody recorded that exact move.
// Where nothing was recorded the gap says nothing, which is what an
// unrecorded route honestly looks like.

export default function MySchedule() {
  const { eventConfig, features } = useEventConfig();
  const { scheduleData, loading } = useContent();
  const { user, loading: authLoading } = useAuth();
  const { attendeeAccess, profileConfirmed, status } = useProfile();
  const profileLoading = Boolean(user && (!profileConfirmed || status === 'pending-account'));
  const { bookmarkedIds: accountBookmarkedIds, loading: bookmarksLoading } = useMyBookmarks();
  const device = useDeviceBookmarks();
  const deviceOnly = !user || !attendeeAccess;
  const bookmarkedIds = useMemo(() => new Set([
    ...(deviceOnly ? [] : accountBookmarkedIds), ...device.ids,
  ]), [deviceOnly, accountBookmarkedIds, device.ids]);
  // Same clock as the schedule list, so a page left open past the day end
  // drops bookmark and calendar controls without a reload.
  const now = useEventClock();
  // The personal PDF request's state (issue #171): the only local state on
  // the page.
  const [pdfState, setPdfState] = useState({ status: 'idle', message: '' });

  /** Ask the server for this caller's own bookmarked programme. */
  async function onDownloadPdf() {
    setPdfState({ status: 'loading', message: '' });
    try {
      await downloadMySchedulePdf({ origin: functionsOrigin(), user });
      setPdfState({ status: 'idle', message: '' });
    } catch (err) {
      setPdfState({
        status: 'error',
        message: err.message || 'Your schedule PDF could not be generated.',
      });
    }
  }

  const days = useMemo(
    () =>
      Array.isArray(eventConfig.days)
        ? eventConfig.days.filter((d) => d && typeof d.id === 'string')
        : [],
    [eventConfig.days],
  );
  const dayIds = useMemo(() => new Set(days.map((d) => d.id)), [days]);

  const myByDay = useMemo(() => {
    const grouped = new Map();
    for (const session of scheduleData) {
      if (!session.visible || !bookmarkedIds.has(session.id)) continue;
      // A bookmarked session whose configured day was since removed from
      // config/event.days (an admin edit, independent of the session's own
      // dayId) is orphaned: grouping it under a day id nothing in `days`
      // matches would make it count toward `mySessions.length` — skipping
      // the "no bookmarks" empty state — while never being rendered under
      // any <section>, since the render below iterates `days`, not this
      // map's keys. That combination is a blank page under the header, not
      // a soft failure. Drop it here instead, so "has bookmarks" and
      // "renders bookmarks" stay the same fact.
      if (!dayIds.has(session.dayId)) continue;
      const list = grouped.get(session.dayId) ?? [];
      list.push(session);
      grouped.set(session.dayId, list);
    }
    for (const [dayId, list] of grouped) grouped.set(dayId, sortSessions(list));
    return grouped;
  }, [scheduleData, bookmarkedIds, dayIds]);

  // Flattened for bulk ICS export — day order doesn't matter there, so this
  // reads straight off myByDay's values rather than depending on `days`
  // (recomputed each render; keeping it out of this memo's deps avoids that
  // churn without needing its own memo).
  const mySessions = useMemo(() => Array.from(myByDay.values()).flat(), [myByDay]);
  const accountSessions = useMemo(() => mySessions.filter((session) => accountBookmarkedIds.has(session.id)), [mySessions, accountBookmarkedIds]);

  if (!features.schedule || !features.sessionBookmarks) {
    return (
      <EmptyState
        title="This event doesn’t have a personal schedule"
        description="Everything else about the event is on the schedule page."
        action={
          <Link to="/schedule" className={primaryActionClass}>
            Go to the schedule
          </Link>
        }
      />
    );
  }

  if (authLoading || profileLoading) {
    return (
      <div className="mt-lg">
        <LoadingState shape="schedule" label="Loading your schedule…" />
      </div>
    );
  }

  if (!user && !device.available) {
    return (
      <EmptyState
        title="Sign in to see your schedule"
        description="Bookmark sessions from the schedule page and they’ll show up here."
        action={
          <Link to="/signin" className={primaryActionClass}>
            Sign in
          </Link>
        }
      />
    );
  }

  return (
    <article>
      <header className="flex flex-wrap items-baseline justify-between gap-md">
        <div>
          <h1 className="font-heading text-h1 font-semibold text-text-primary">My schedule</h1>
          <p className="mt-2xs font-data text-caption text-text-secondary">
            {deviceOnly ? 'These sessions are saved only in this browser. Browser settings may clear them.'
              : 'Sessions you’ve bookmarked, across every day.'}
          </p>
          {user && !attendeeAccess ? (
            <p className="mt-2xs max-w-prose text-body text-text-secondary">
              This account does not have attendee access. Your browser saves stay on this device.
            </p>
          ) : null}
          {!deviceOnly && device.ids.length > 0 ? (
            <p className="mt-2xs max-w-prose text-body text-text-secondary">
              {device.ids.length} browser {device.ids.length === 1 ? 'save has' : 'saves have'} not been added to your account.
              The PDF, sharing and calendar sync use sessions already saved to your account.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-xs">
          <Link to="/schedule" className={quietActionClass}>
            Full schedule
          </Link>
          {features.icsExport && mySessions.length > 0 ? (
            <button
              type="button"
              onClick={() => downloadIcs(icsFileName('my-schedule'), buildIcsCalendar(eventConfig, mySessions))}
              className={quietActionClass}
            >
              Download my schedule (.ics)
            </button>
          ) : null}
          {/* The personal PDF (issue #171): the server reads the caller's
              own bookmarks behind the verified token, so the button carries
              nothing but the request. The same flag gates the public PDF. */}
          {features.schedulePdf && !deviceOnly && accountSessions.length > 0 ? (
            <button
              type="button"
              onClick={onDownloadPdf}
              disabled={pdfState.status === 'loading'}
              className={quietActionClass}
            >
              Download my schedule (PDF)
            </button>
          ) : null}
          {pdfState.status === 'error' ? (
            <p role="alert" className="basis-full font-data text-caption text-danger">
              {pdfState.message}
            </p>
          ) : null}
        </div>
      </header>

      {loading || (!deviceOnly && bookmarksLoading) ? (
        <div className="mt-lg">
          <LoadingState shape="schedule" label="Loading your schedule…" />
        </div>
      ) : mySessions.length === 0 ? (
        <div className="mt-lg">
          <EmptyState
            title="No bookmarked sessions yet"
            description="Browse the schedule and bookmark the sessions you don’t want to miss."
            action={
              <Link to="/schedule" className={primaryActionClass}>
                Browse the schedule
              </Link>
            }
          />
        </div>
      ) : (
        days
          .filter((day) => (myByDay.get(day.id) ?? []).length > 0)
          .map((day) => (
            // The Atlas sheet, on the one surface that holds a programme
            // (owner review, 2026-08-27). See Schedule.jsx for the rule.
            <section key={day.id} aria-labelledby={`my-day-${day.id}`} className="map-grid mt-xl">
              {/* The same folio-on-a-rule day head Schedule.jsx uses (brief
                  §2.1): the standing head of the day, with the date sitting
                  on the same rule rather than stacked above it. */}
              <SectionHead
                variant="folio"
                level={2}
                id={`my-day-${day.id}`}
                title={day.label}
                folio={
                  formatDayDate(day, eventConfig.timezone) ? (
                    <time dateTime={day.date}>{formatDayDate(day, eventConfig.timezone)}</time>
                  ) : null
                }
              />
              {/* No gap between rows: each SessionCard opens with its own
                  hairline, so the rules ARE the separation (brief §2.1). */}
              <ul className="mt-sm">
                {(myByDay.get(day.id) ?? []).map((session, index, list) => {
                  // The move INTO this session, from the one the reader
                  // attends before it. `null` for the first of the day —
                  // arriving is not transferring — and null wherever the
                  // pair has no recorded route, which is most pairs in most
                  // venues and renders as nothing at all.
                  const movement =
                    index > 0 ? sessionMovement(eventConfig, list[index - 1], session) : null;
                  return (
                    <Fragment key={session.id}>
                      {/* Its own item in the itinerary, because that is
                          what it is: the step between two sessions, not a
                          property of either. SessionCard renders the <li>
                          for the session itself. */}
                      {movement ? (
                        <li>
                          <TransferLine movement={movement} />
                        </li>
                      ) : null}
                      <SessionCard
                        session={session}
                        eventConfig={eventConfig}
                        features={features}
                        bookmarked
                        backIssue={isBackIssue(day, eventConfig, now)}
                        // The attendee's private note on this session
                        // (issue #170): the row is theirs, and so is the
                        // text under it. The public page passes nothing.
                        noteSlot={!deviceOnly && accountBookmarkedIds.has(session.id)
                          ? <SessionNote uid={user.uid} sessionId={session.id} />
                          : !deviceOnly && device.ids.includes(session.id)
                            ? <p className="mt-xs font-data text-caption text-text-secondary">Saved in this browser; not yet in your account.</p> : null}
                      />
                    </Fragment>
                  );
                })}
              </ul>
            </section>
          ))
      )}

      {/* The owner's own consent panel (issue #172): its choice is separate
          from the profile's, widening asks twice, and the copy link is
          offered at every level because it never lies about what a visitor
          would receive. */}
      {user ? <ShareSchedule uid={user.uid} /> : null}

      {/* Optional Google Calendar sync (issue #177, ADR 0003): the flag
          gates the whole card, and the .ics download above it stays the
          answer whenever the grant is refused or the flag is off. */}
      {features.calendarSync && !deviceOnly && !loading && !bookmarksLoading ? (
        <CalendarSyncCard key={user.uid} sessions={accountSessions} eventConfig={eventConfig} />
      ) : null}
    </article>
  );
}
