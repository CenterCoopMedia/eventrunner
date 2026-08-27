// SessionActions — everything a reader can do with one session, and where.
//
// Was SessionPills, which rendered the same four control groups in both
// places it was used. Under a schedule row that came out as a shelf:
// bookmark, materials count, five reaction chips, and three calendar
// buttons — up to ten bordered rectangles under every session on a page
// that might list thirty. The programme stopped being a programme.
//
// THE TWO SURFACES ARE NOT THE SAME PAGE, so they no longer get the same
// controls:
//
//   row     the schedule list. One bookmark action, the materials count as
//           a link, one "Add to calendar" disclosure, and one clearly
//           labelled way into the session — "Session details". Nothing is
//           boxed; every control is text in the data face.
//
//   detail  the session's own page. The bookmark and the calendar, plus the
//           reactions, which live here and only here: reacting is an act on
//           a session you have already chosen. No "Session details" link,
//           because this IS the session details, and no materials link,
//           because the materials list itself is on the page.
//
// A back issue keeps every word and loses its live controls (brief §2.1).
// Bookmarking a session that has finished, reacting to it, or adding it to
// a calendar are all acts on an event that is not happening: the controls
// go out of the document rather than sitting there disabled. The materials
// a session left behind are content, so they stay.
import { Link, useLocation } from 'react-router-dom';
import BookmarkAction from './BookmarkAction.jsx';
import CalendarMenu from './CalendarMenu.jsx';
import MaterialsLink from './MaterialsLink.jsx';
import ReactionGroup from './ReactionGroup.jsx';
import { rowActionClass } from './sessionActionClass.js';

/**
 * The one link into a session, named so the reader knows where it goes.
 * The title above it is a link to the same place, which is the convention
 * every list follows; this is the labelled one, for a reader scanning the
 * actions rather than the headings.
 */
function DetailsLink({ session }) {
  const { search } = useLocation();
  return (
    <Link to={{ pathname: `/schedule/${session.id}`, search }} className={rowActionClass}>
      Session details
    </Link>
  );
}

/**
 * @param {{ session: object, eventConfig: object, features?: object,
 *           bookmarked?: boolean, backIssue?: boolean,
 *           surface?: 'row' | 'detail' }} props
 */
export default function SessionActions({
  session,
  eventConfig,
  features = {},
  bookmarked = false,
  backIssue = false,
  surface = 'row',
}) {
  const onRow = surface === 'row';
  const live = !backIssue;
  const showBookmark = live && features.sessionBookmarks;
  const showCalendar = live && features.icsExport;
  const showMaterials = onRow && features.sessionMaterials;
  const showReactions = !onRow && live && features.sessionReactions;

  // On a row the details link is unconditional — a session always has a
  // detail page — so the row always has at least one control and the
  // wrapper always renders. On the detail page every control is optional,
  // and a deployment with all of them off must add no empty box.
  if (!onRow && !showBookmark && !showCalendar && !showReactions) return null;

  return (
    <div className="session-actions flex flex-wrap items-start gap-x-md gap-y-2xs">
      {showBookmark ? <BookmarkAction session={session} bookmarked={bookmarked} /> : null}
      {showMaterials ? <MaterialsLink session={session} /> : null}
      {showCalendar ? <CalendarMenu eventConfig={eventConfig} session={session} /> : null}
      {showReactions ? <ReactionGroup session={session} /> : null}
      {onRow ? <DetailsLink session={session} /> : null}
    </div>
  );
}
