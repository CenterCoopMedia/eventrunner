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
//
// Restyled onto the editorial base (design brief §2.1, §5.1) as a single
// specimen-index entry rather than a profile card: name, role, and org sit
// in one rule-bounded metadata block — a hairline opens it and a hairline
// closes it, the same device a directory row uses, just for one entry
// instead of many — the bio runs as plain body prose underneath, and the
// sessions list reuses the SectionHead + hairline-row idiom Schedule.jsx and
// SessionCard.jsx already carry. No avatar card: the headshot, where present,
// sits inline with the name at directory scale (Speakers.jsx), never boxed
// or shadowed on its own.
import { Link, useParams } from 'react-router-dom';
import { useContent } from '../contexts/ContentContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import AssetImage from '../components/media/AssetImage.jsx';
import Rule from '../components/editorial/Rule.jsx';
import SectionHead from '../components/editorial/SectionHead.jsx';
import { formatSessionTimeRange } from '../lib/eventTime.js';
import { sortSessions } from './Schedule.jsx';
import { primaryActionClass } from '../components/controlClasses.js';

function text(value) {
  return typeof value === 'string' ? value : '';
}

function NotFoundState() {
  return (
    <EmptyState
      title="This speaker isn’t available"
      description="They may not have been announced yet, or the link may be out of date."
      action={
        <Link to="/speakers" className={primaryActionClass}>
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
          <Link to="/" className={primaryActionClass}>
            Go to the home page
          </Link>
        }
      />
    );
  }

  const speaker = speakers.find((candidate) => candidate.slug === slug);
  if (!speaker) return <NotFoundState />;

  const affiliation = [text(speaker.jobTitle), text(speaker.organization)].filter(Boolean).join(', ');
  // Gated on features.schedule (issue #22 review finding P2-6): the
  // schedule itself is a feature a deployment can turn off, and a session
  // list here would be a working cross-link into a part of the site that
  // does not otherwise exist for this event.
  //
  // Day-major, then time-minor (issue #22 review finding P2-10): a
  // speaker's sessions can span multiple days, and sortSessions alone only
  // orders by start time — correct for one day's list (Schedule.jsx groups
  // by day first), wrong across days, where a later day's early-morning
  // session would sort ahead of an earlier day's afternoon one. Array.sort
  // is stable, so sorting by day index AFTER sortSessions's time/order/title
  // pass preserves that ordering within each day.
  const dayOrder = new Map(
    (Array.isArray(eventConfig.days) ? eventConfig.days : []).map((day, index) => [day?.id, index]),
  );
  const sessions = features.schedule
    ? sortSessions(
        scheduleData.filter(
          (session) => Array.isArray(session.speakerIds) && session.speakerIds.includes(speaker.id),
        ),
      ).sort((a, b) => (dayOrder.get(a.dayId) ?? Infinity) - (dayOrder.get(b.dayId) ?? Infinity))
    : [];

  const hasSocials = speaker.socialHandles && Object.keys(speaker.socialHandles).length > 0;

  return (
    <article>
      <p className="mb-md">
        <Link
          to="/speakers"
          className="font-data text-caption font-semibold text-text-secondary hover:text-text-primary hover:underline"
        >
          ← Back to speakers
        </Link>
      </p>

      {/* The specimen-index entry: name, role, and org sit in one
          rule-bounded metadata block — a hairline opens it and a hairline
          closes it, the same device a directory row uses (Speakers.jsx),
          just drawn once instead of repeated per row. No avatar card: the
          headshot, where present, sits inline with the name at directory
          scale, never boxed or shadowed on its own. */}
      <Rule weight="hairline" />
      <header className="py-sm">
        <div className="flex flex-wrap items-baseline gap-x-sm gap-y-2xs">
          {speaker.headshotPath ? (
            <AssetImage
              path={speaker.headshotPath}
              alt=""
              className="h-14 w-14 shrink-0 self-center rounded-brand bg-surface-alt object-cover"
            />
          ) : null}
          <h1 className="font-heading text-h1 font-semibold text-text-primary">
            {text(speaker.displayName)}
          </h1>
        </div>
        {affiliation ? (
          <p className="mt-2xs font-data text-caption text-text-secondary">{affiliation}</p>
        ) : null}
        {hasSocials ? (
          <ul className="mt-xs flex flex-wrap gap-x-md gap-y-2xs">
            {Object.entries(speaker.socialHandles).map(([label, handle]) => (
              <li key={label} className="font-data text-caption text-text-secondary">
                <span className="font-medium text-text-primary">{label}:</span> {handle}
              </li>
            ))}
          </ul>
        ) : null}
      </header>
      <Rule weight="hairline" />

      {text(speaker.bio) ? (
        <p
          className="mt-md max-w-prose whitespace-pre-line text-lead text-text-secondary"
          style={{ textWrap: 'pretty' }}
        >
          {text(speaker.bio)}
        </p>
      ) : null}

      {sessions.length > 0 ? (
        <section className="mt-xl" aria-labelledby="speaker-sessions">
          <SectionHead title="Sessions" level={2} id="speaker-sessions" />
          {/* No gap: every row opens with its own hairline, the same list
              idiom Schedule.jsx and SessionCard.jsx use. */}
          <ul className="mt-sm">
            {sessions.map((session) => {
              const range = formatSessionTimeRange(eventConfig, session);
              return (
                <li key={session.id} className="border-t-hairline border-t-rule-hairline py-sm">
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
                      'Time to be announced'
                    )}
                  </p>
                  <h3 className="mt-2xs font-heading text-h3 font-semibold text-text-primary">
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
