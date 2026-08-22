// One speaker's public page — /speakers/:slug (spec §4.3, §9 "Public
// speaker pages", issue #22).
//
// Reads the SAME `useContent().speakers` array the directory (Speakers.jsx)
// already subscribes to: it is the live `speakers_public` projection, and a
// speaker who is not `approved` has no document in it at all — there is no
// separate "unapproved" state to distinguish from "unknown slug", so both
// 404 identically, the same non-oracle rule AttendeeProfile.jsx follows for
// a private profile.
//
// Their sessions are a QUERY, not a stored list (spec §4.3: "speaker→session
// is a query"): `scheduleData.filter(s => s.speakerIds.includes(speaker.id))`
// over the same live, already-visibility-filtered schedule Schedule.jsx
// renders from.
import { Link, useParams } from 'react-router-dom';
import { useContent } from '../contexts/ContentContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import AssetImage from '../components/media/AssetImage.jsx';
import { formatSessionTimeRange } from '../lib/eventTime.js';

function text(value) {
  return typeof value === 'string' ? value : '';
}

function NotFoundState() {
  return (
    <EmptyState
      title="This speaker isn’t available"
      description="They may not have been announced yet, or the link may be out of date."
      action={
        <Link
          to="/speakers"
          className="touch-target inline-flex items-center rounded-brand bg-brand-primary px-6 py-3 font-semibold text-brand-surface hover:bg-brand-primary-dark"
        >
          Back to speakers
        </Link>
      }
    />
  );
}

export default function SpeakerDetail() {
  const { slug } = useParams();
  const { eventConfig, features } = useEventConfig();
  const { speakers, scheduleData } = useContent();

  if (!features.speakers) {
    return (
      <EmptyState
        title="This event doesn’t have a public speaker directory"
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

  const speaker = speakers.find((candidate) => candidate.slug === slug);
  if (!speaker) return <NotFoundState />;

  const affiliation = [text(speaker.jobTitle), text(speaker.organization)].filter(Boolean).join(', ');
  const sessions = scheduleData.filter(
    (session) => Array.isArray(session.speakerIds) && session.speakerIds.includes(speaker.id),
  );

  return (
    <article>
      <p className="mb-4">
        <Link to="/speakers" className="text-sm font-semibold text-brand-primary-dark hover:underline">
          ← Back to speakers
        </Link>
      </p>
      <div className="flex items-start gap-4">
        {speaker.headshotPath ? (
          <AssetImage
            path={speaker.headshotPath}
            alt=""
            className="h-24 w-24 rounded-full bg-brand-surface-alt object-cover"
          />
        ) : null}
        <div>
          <h1 className="font-heading text-3xl font-semibold text-brand-ink">{text(speaker.displayName)}</h1>
          {affiliation ? <p className="mt-1 text-brand-ink-muted">{affiliation}</p> : null}
          {speaker.socialHandles && Object.keys(speaker.socialHandles).length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-3">
              {Object.entries(speaker.socialHandles).map(([label, handle]) => (
                <li key={label}>
                  <span className="text-sm font-semibold text-brand-ink-muted">{label}:</span>{' '}
                  <span className="text-sm text-brand-ink">{handle}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      {text(speaker.bio) ? (
        <p className="mt-6 max-w-prose whitespace-pre-line text-brand-ink">{text(speaker.bio)}</p>
      ) : null}

      {sessions.length > 0 ? (
        <section className="mt-8">
          <h2 className="font-heading text-xl text-brand-ink">Sessions</h2>
          <ul className="mt-3 space-y-3">
            {sessions.map((session) => {
              const range = formatSessionTimeRange(eventConfig, session);
              return (
                <li key={session.id} className="rounded-brand border border-brand-ink/10 bg-brand-surface-alt p-4">
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
                      'Time to be announced'
                    )}
                  </p>
                  <h3 className="mt-1 font-semibold text-brand-ink">
                    <Link to={`/schedule/${session.id}`} className="hover:underline">
                      {session.title}
                    </Link>
                  </h3>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
