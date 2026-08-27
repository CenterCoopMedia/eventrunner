// SessionCard — one session as a ruled row in the programme.
//
// A ROW IS: the time, the title, the format, the room, the speakers, the
// session's own words, its calling points, and one line of quiet controls.
// The controls themselves live in components/session/ (SessionActions), and
// which of them a row gets is that module's decision, not this one's — a
// row and a detail page are different pages and get different sets.
//
// Everything below the title reads at the same weight, so the eye keeps
// running down the time column instead of stopping at a shelf of boxes.
import { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useContent } from '../contexts/ContentContext.jsx';
import { formatSessionTimeRange } from '../lib/eventTime.js';
import SpecimenLabel from './editorial/SpecimenLabel.jsx';
import SessionActions from './session/SessionActions.jsx';
import SessionFormat from './session/SessionFormat.jsx';
import CallingPoints from './CallingPoints.jsx';

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
 * MOVEMENT IS NOT INFERRED (design brief §4.6; visual story, Atlas).
 *
 * The schedule used to compare one session's room string with the previous
 * one's and, when they differed, print "Transfer to <room>". That was a
 * guess wearing the voice of a fact. Two rooms with different names may be
 * the same door; a reader who never sat in the earlier session is not
 * transferring from anywhere; and the sentence claimed a movement the data
 * never recorded.
 *
 * So movement facts — transfers, walking guidance, movement instructions —
 * render ONLY from explicit data. A session carries a day, a time, a title,
 * a room, a track, and its speakers. None of those is a movement, so the
 * room renders plainly and the page says nothing more. When the schema
 * gains a stated transfer, the statement comes back and reads from it.
 *
 * Track letters stay: a track IS explicit data (config/event.tracks, one
 * letter and one name), which is why RouteMark still renders in the grid.
 */

/**
 * @param {{ session: object, eventConfig: object, features?: object,
 *           bookmarked?: boolean, linkToDetail?: boolean,
 *           callingPoints?: object[], backIssue?: boolean }} props
 */
export default function SessionCard({
  session,
  eventConfig,
  features = {},
  bookmarked = false,
  linkToDetail = true,
  callingPoints = [],
  backIssue = false,
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
    <li className="session-block border-t-hairline border-t-rule-hairline">
      {/* The face is the first ink pass; the stamp behind it is the second,
          printed off register (brief §2.4, "Exception two", Zine only). At
          the zero offset every other preset holds, the face covers the
          stamp exactly and this is the plain ruled row it has always
          been. */}
      <article className="session-block__face grid gap-2xs sm:grid-cols-[9.5rem,1fr] sm:gap-md">
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
            <SessionFormat format={session.type} />
          </div>
          {/* The room, as a specimen label (brief §4.5). Under five presets
              the label draws no rules and shows no field name, so this is
              the caption line it has always been; under Field Guide the same
              markup is the collection tag the story asks for. */}
          <SpecimenLabel
            className="mt-2xs"
            fields={[{ key: 'Place', value: session.location }]}
          />
          {session.description ? (
            <p
              className="mt-xs max-w-prose text-body text-text-secondary"
              style={{ textWrap: 'pretty' }}
            >
              {session.description}
            </p>
          ) : null}
          <SpeakerNames speakers={speakerNames} features={features} />
          {/* A parent session's children are calling points on the way
              through it (brief §4.6), never rows of their own. */}
          <CallingPoints
            className="mt-sm"
            parent={session}
            points={callingPoints}
            eventConfig={eventConfig}
          />
          <div className="mt-sm">
            <SessionActions
              surface="row"
              session={session}
              eventConfig={eventConfig}
              features={features}
              bookmarked={bookmarked}
              backIssue={backIssue}
            />
          </div>
        </div>
      </article>
    </li>
  );
}
