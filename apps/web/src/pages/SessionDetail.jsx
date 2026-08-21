// SessionDetail — one published session at /schedule/:sessionId (issue #16).
// Feature-gated by config/features.schedule, same as Schedule.jsx (direct
// navigation bypasses the nav, so the route itself must gate too, matching
// the Speakers.jsx pattern). A session id that does not resolve to a
// visible cmsSchedule doc 404s here rather than rendering a blank page.
import { Link, useLocation, useParams } from 'react-router-dom';
import { useContent } from '../contexts/ContentContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { useMyBookmarks } from '../hooks/useMyBookmarks.js';
import EmptyState from '../components/EmptyState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import { SessionPills, TypeBadge } from '../components/SessionCard.jsx';
import { formatSessionTimeRange } from '../lib/eventTime.js';

function NotFoundState({ search }) {
  return (
    <EmptyState
      title="This session is not available"
      description="It may not be published yet, or the link may be out of date."
      action={
        <Link
          to={{ pathname: '/schedule', search }}
          className="touch-target inline-flex items-center rounded-brand bg-brand-primary px-6 py-3 font-semibold text-brand-surface hover:bg-brand-primary-dark"
        >
          Back to the schedule
        </Link>
      }
    />
  );
}

export default function SessionDetail() {
  const { sessionId } = useParams();
  const { eventConfig, features } = useEventConfig();
  const { scheduleData, loading } = useContent();
  const { bookmarkedIds } = useMyBookmarks();
  // Carries ?preview=1 (and any other query string) back to /schedule —
  // without this, an admin previewing drafts loses the preview the moment
  // they click "back to the schedule" (spec: matches SessionCard.jsx's
  // detail-link fix for the same round trip).
  const { search } = useLocation();

  if (!features.schedule) {
    return (
      <EmptyState
        title="This event doesn’t have a public schedule"
        description="Everything else about the event is on the home page."
        action={
          <Link
            to="/"
            className="touch-target inline-flex items-center rounded-brand bg-brand-primary px-4 py-2 font-semibold text-brand-surface"
          >
            Go to the home page
          </Link>
        }
      />
    );
  }

  if (loading) {
    return (
      <div className="mt-6">
        <LoadingState label="Loading the session" />
      </div>
    );
  }

  const session = scheduleData.find((s) => s.id === sessionId && s.visible);
  if (!session) return <NotFoundState search={search} />;

  const range = formatSessionTimeRange(eventConfig, session);
  const day = Array.isArray(eventConfig.days)
    ? eventConfig.days.find((d) => d?.id === session.dayId)
    : null;

  return (
    <article>
      <p className="mb-4">
        <Link
          to={{ pathname: '/schedule', search }}
          className="text-sm font-semibold text-brand-primary-dark hover:underline"
        >
          ← Back to the schedule
        </Link>
      </p>
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-heading text-3xl font-semibold text-brand-ink">{session.title}</h1>
          <TypeBadge type={session.type} />
        </div>
        <p className="mt-2 text-brand-ink-muted">
          {day ? <span>{day.label}</span> : null}
          {day && range ? ' · ' : null}
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
          ) : !day ? (
            'Time to be announced'
          ) : null}
        </p>
        {session.location ? <p className="mt-1 text-brand-ink-muted">{session.location}</p> : null}
      </header>

      {session.description ? (
        <p className="mt-6 max-w-prose text-brand-ink" style={{ textWrap: 'pretty' }}>
          {session.description}
        </p>
      ) : null}

      <div className="mt-6">
        <SessionPills
          session={session}
          eventConfig={eventConfig}
          features={features}
          bookmarked={bookmarkedIds.has(session.id)}
        />
      </div>
    </article>
  );
}
