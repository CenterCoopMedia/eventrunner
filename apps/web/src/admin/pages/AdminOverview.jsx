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
// THE REFRESH CONTROL is never `disabled`: while a request runs it says
// "Refreshing…", carries aria-busy and aria-disabled, and its handler
// ignores the press, so the focus stays on it and a second press sends
// nothing (interface guidelines, Busy).
//
// Three states, each stated in place: the first load is a stated line; a
// failure with nothing to show is an error notice with the server's words
// and no figures; a failure after figures arrived keeps them on the page
// under a caution notice that says when they were read.
//
// Under the figures: the milestones and the goal from config/event (issue
// #180), then the registration funnel and the content readiness table
// (issue #181), both read from the same response.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { zoneLabel } from '../../lib/eventTime.js';
import { useAdminApi } from '../adminApi.js';
import { Notice, primaryButtonClass, secondaryButtonClass } from '../components/formControls.jsx';
import AdminPageHeader, { AdminLoadingState } from '../components/adminChrome.jsx';
import EventFigures from '../overview/EventFigures.jsx';
import MilestonesPanel from '../overview/MilestonesPanel.jsx';
import FunnelPanel from '../overview/FunnelPanel.jsx';
import ReadinessPanel from '../overview/ReadinessPanel.jsx';

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

export default function AdminOverview() {
  const call = useAdminApi();
  const { isOperator } = useAuth();
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
    <div className="admin-overview flex flex-col gap-md">
      <AdminPageHeader
        title="Overview"
        identifiers={readAt ? `Read at ${readAt}` : null}
        description={`${eventConfig.shortName || eventConfig.name || 'Your event'} at a glance. Check progress and go straight to the work that needs you.`}
        actions={
          <>
            <button
            type="button"
            className={secondaryButtonClass}
            onClick={refresh}
            aria-busy={busy || undefined}
            aria-disabled={busy || undefined}
          >
            {busy ? 'Refreshing…' : 'Refresh figures'}
          </button>
            <Link to="/admin/unpublished" className={primaryButtonClass}>Review unpublished changes</Link>
          </>
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
      {stats && !error ? <p role="status" className="sr-only">Figures read at {readAt}.</p> : null}

      {stats ? <EventFigures stats={stats} isOperator={isOperator} /> : null}

      <div className="admin-overview-detail-grid">
      <MilestonesPanel
        milestones={eventConfig.milestones}
        goal={eventConfig.registration?.goal}
        approved={stats?.registrations?.byStatus?.approved}
        timezone={eventConfig.timezone}
      />

      {stats ? (
        <>
          <FunnelPanel funnel={stats.funnel} revoked={stats.registrations?.byStatus?.revoked} />
          <ReadinessPanel content={stats.content} />
        </>
      ) : null}
      </div>
    </div>
  );
}
