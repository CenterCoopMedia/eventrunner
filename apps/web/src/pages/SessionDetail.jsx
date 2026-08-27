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
import { SessionPills, SpeakerNames, TypeBadge, useSessionSpeakerNames } from '../components/SessionCard.jsx';
import SessionMaterialsList from '../components/SessionMaterialsList.jsx';
import { formatSessionTimeRange } from '../lib/eventTime.js';
import { primaryActionClass } from '../components/controlClasses.js';

function NotFoundState({ search }) {
  return (
    <EmptyState
      title="This session is not available"
      description="It may not be published yet, or the link may be out of date."
      action={
        <Link
          to={{ pathname: '/schedule', search }}
          className={primaryActionClass}
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

  // Looked up here, ahead of every early return, so useSessionSpeakerNames
  // (a hook) is called unconditionally — React's rules of hooks forbid
  // calling it only on the "found" branch below.
  const session = scheduleData.find((s) => s.id === sessionId && s.visible);
  const speakerNames = useSessionSpeakerNames(session?.speakerIds);

  if (!features.schedule) {
    return (
      <EmptyState
        title="This event doesn’t have a public schedule"
        description="Everything else about the event is on the home page."
        action={
          <Link to="/" className={primaryActionClass}>
            Go to the home page
          </Link>
        }
      />
    );
  }

  if (loading) {
    return (
      <div className="mt-lg">
        <LoadingState label="Loading the session" />
      </div>
    );
  }

  if (!session) return <NotFoundState search={search} />;

  const range = formatSessionTimeRange(eventConfig, session);
  const day = Array.isArray(eventConfig.days)
    ? eventConfig.days.find((d) => d?.id === session.dayId)
    : null;

  return (
    <article>
      <p className="mb-md">
        <Link
          to={{ pathname: '/schedule', search }}
          className="font-data text-caption font-semibold text-text-secondary hover:text-text-primary hover:underline"
        >
          ← Back to the schedule
        </Link>
      </p>
      <header>
        <div className="flex flex-wrap items-baseline gap-x-sm gap-y-2xs">
          <h1 className="font-heading text-h1 font-semibold text-text-primary">{session.title}</h1>
          <TypeBadge type={session.type} />
        </div>
        <p className="mt-2xs font-data text-caption text-text-secondary">
          {day ? <span>{day.label}</span> : null}
          {day && range ? ' · ' : null}
          {range ? (
            <span className="font-mono">
              <time dateTime={range.startIso}>{range.startLabel}</time>
              {range.endLabel ? (
                <>
                  –<time dateTime={range.endIso}>{range.endLabel}</time>
                </>
              ) : null}
              {range.zone ? <span className="ms-2xs">{range.zone}</span> : null}
            </span>
          ) : !day ? (
            'Time to be announced'
          ) : null}
        </p>
        {session.location ? (
          <p className="mt-2xs font-data text-caption text-text-secondary">{session.location}</p>
        ) : null}
        <SpeakerNames speakers={speakerNames} features={features} />
      </header>

      {session.description ? (
        <p className="mt-md max-w-prose text-lead text-text-secondary" style={{ textWrap: 'pretty' }}>
          {session.description}
        </p>
      ) : null}

      <div className="mt-lg">
        <SessionPills
          session={session}
          eventConfig={eventConfig}
          features={features}
          bookmarked={bookmarkedIds.has(session.id)}
        />
      </div>

      <SessionMaterialsList session={session} features={features} />
    </article>
  );
}
