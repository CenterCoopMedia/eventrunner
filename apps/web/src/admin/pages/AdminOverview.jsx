// The overview (issue #179): how the event is going, on the page the admin
// opens on.
//
// EVERY FIGURE COMES FROM THE SERVER. The page calls getEventStats
// (functions/src/admin/eventStats.cjs) on mount and when "Refresh figures"
// is pressed, and prints each number exactly as the response carries it. It
// never reads `users`, `tickets`, `speakers`, or `system_errors` in the
// browser: every count is a server aggregate (parity plan, M9). There is no
// polling. A figure changes when somebody asks for it again, and the "read
// at" time says when that was.
//
// FIGURE SENTENCES, NOT TILES (design vocabulary §3.4). Each figure sits in
// a sentence that says what it counts: "412 accounts: 120 pending, …". The
// number is in the data face, bold and tabular, and the words around it are
// the label, so no figure is ever a bare number and nothing is said by
// colour. Zero is printed as "0", never left out.
//
// THE REFRESH CONTROL is never `disabled`: while a request runs it says
// "Refreshing…", carries aria-busy and aria-disabled, and its handler
// ignores the press, so the focus stays on it and a second press sends
// nothing (interface guidelines, Busy).
//
// Three states, each stated in place: the first load is a stated line; a
// failure with nothing to show is an error notice with the server's words
// and no figures; a failure after figures arrived keeps them on the page
// under a caution notice that says when they were read.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { zoneLabel } from '../../lib/eventTime.js';
import { useAdminApi } from '../adminApi.js';
import { Notice, Panel, SaveStatus, secondaryButtonClass } from '../components/formControls.jsx';
import AdminPageHeader, { AdminLoadingState } from '../components/adminChrome.jsx';
import { Figure, plural } from '../overview/figures.jsx';
import MilestonesPanel from '../overview/MilestonesPanel.jsx';

/**
 * The time the figures were read, on the event's clock: "9:14 AM EDT". An
 * unreadable zone falls back to the instant itself rather than throwing.
 *
 * @param {string} iso the response's readAt
 * @param {string} [timeZone] the event's IANA timezone
 * @returns {string}
 */
export function formatReadAt(iso, timeZone) {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return String(iso ?? '');
  try {
    const time = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(instant);
    const zone = zoneLabel(timeZone, instant);
    return zone ? `${time} ${zone}` : time;
  } catch {
    return instant.toISOString();
  }
}

/** "120 pending, 30 ticketed, …": each part a figure and its word. */
function Parts({ parts }) {
  return parts.map(([word, value], index) => (
    <span key={word}>
      {index > 0 ? ', ' : ''}
      <Figure value={value} /> {word}
    </span>
  ));
}

const REGISTRATION_WORDS = [
  ['pending', 'pending'],
  ['ticketed', 'ticketed'],
  ['approved', 'approved'],
  ['revoked', 'revoked'],
];
const TICKET_WORDS = [
  ['valid', 'valid'],
  ['refunded', 'refunded'],
  ['cancelled', 'cancelled'],
  ['pending_info', 'waiting for details'],
];
const SPEAKER_WORDS = [
  ['draft', 'draft'],
  ['invited', 'invited'],
  ['accepted', 'accepted'],
  ['approved', 'approved'],
  ['removed', 'removed'],
];

const partsOf = (byStatus, words) => words.map(([key, word]) => [word, byStatus?.[key] ?? 0]);

/** The six figure sentences, straight from the response. */
function EventFigures({ stats }) {
  const registrations = stats.registrations ?? {};
  const tickets = stats.tickets ?? {};
  const speakers = stats.speakers ?? {};
  const sessions = stats.content?.cmsSchedule ?? {};
  const unresolved = stats.errors?.unresolved ?? 0;
  const accounts = registrations.total ?? 0;
  const sessionsLive = sessions.published ?? 0;
  const sessionsDirty = sessions.drafts ?? 0;
  return (
    <Panel
      title="Event figures"
      description="Counted on the server when you open this page or refresh it. A ticket is one ticket record, not one seat."
    >
      <ul className="flex flex-col gap-2xs text-admin-base text-admin-ink">
        <li>
          <Figure value={accounts} /> {plural(accounts, 'account', 'accounts')}:{' '}
          <Parts parts={partsOf(registrations.byStatus, REGISTRATION_WORDS)} />.
        </li>
        <li>
          <Figure value={registrations.profileComplete} /> of <Figure value={accounts} />{' '}
          {plural(accounts, 'profile', 'profiles')} complete.
        </li>
        <li>
          <Figure value={tickets.total} /> {plural(tickets.total ?? 0, 'ticket', 'tickets')}:{' '}
          <Parts parts={partsOf(tickets.byStatus, TICKET_WORDS)} />.
        </li>
        <li>
          <Figure value={speakers.total} /> {plural(speakers.total ?? 0, 'speaker', 'speakers')}:{' '}
          <Parts parts={partsOf(speakers.byStatus, SPEAKER_WORDS)} />.
        </li>
        <li>
          <Figure value={sessionsLive} /> {plural(sessionsLive, 'session', 'sessions')} on the site.{' '}
          <Figure value={sessionsDirty} /> with unpublished changes.
        </li>
        <li>
          <Figure value={unresolved} /> unresolved {plural(unresolved, 'error', 'errors')}.
        </li>
      </ul>
    </Panel>
  );
}

export default function AdminOverview() {
  const call = useAdminApi();
  const { eventConfig } = useEventConfig();
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // The press guard lives in a ref, not in state: a second press in the same
  // tick must see the first one's request already running.
  const busyRef = useRef(false);

  const refresh = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const next = await call('getEventStats', {});
      setStats(next);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [call]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const readAt = stats ? formatReadAt(stats.readAt, eventConfig.timezone) : null;

  return (
    <div className="flex flex-col gap-md">
      <AdminPageHeader
        title="Overview"
        identifiers={readAt ? `Read at ${readAt}` : null}
        description="How the event is going: accounts, tickets, speakers, the schedule, and errors, counted on the server."
        actions={
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={refresh}
            aria-busy={busy || undefined}
            aria-disabled={busy || undefined}
          >
            {busy ? 'Refreshing…' : 'Refresh figures'}
          </button>
        }
      />

      {!stats && !error ? <AdminLoadingState label="Loading the event figures…" /> : null}
      {!stats && error ? <Notice tone="error" message={error.message} /> : null}
      {stats && error ? (
        <Notice
          tone="caution"
          message={`We could not refresh the figures. These are the figures read at ${readAt}.`}
        />
      ) : null}
      {stats && !error ? <SaveStatus message={`Figures read at ${readAt}.`} /> : null}

      {stats ? <EventFigures stats={stats} /> : null}

      <MilestonesPanel
        milestones={eventConfig.milestones}
        goal={eventConfig.registration?.goal}
        approved={stats?.registrations?.byStatus?.approved}
        timezone={eventConfig.timezone}
      />
    </div>
  );
}
