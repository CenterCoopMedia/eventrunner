// The calendar sync control on the personal schedule (issue #177, ADR
// 0003).
//
// OFF BY DEFAULT, AND THE OFF STATE IS THE OLD STATE. When the operator has
// not turned config/features.calendarSync on, this card renders nothing at
// all and the .ics download above it is the whole calendar story.
//
// THE GRANT IS THE ATTENDEE'S. Pressing sync opens Google's consent screen
// with the calendar.events scope; the token lives in this component's ref
// and never reaches Firestore. A refused grant is not an error — the card
// says so and points back at the .ics download, which never needed a grant.
//
// THE SYNC IS A DIFF, NOT A REPLAY. Every pass computes the event set from
// the current bookmarks and applies the difference against the last pass:
// new bookmarks insert, changed sessions update, removed bookmarks delete.
// A bookmark edit while a live token exists re-syncs on its own, because a
// calendar that only updates on demand is a stale calendar wearing the
// event's name.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext.jsx';
import {
  CalendarScopeRefusedError,
  requestCalendarAccess,
  syncBookmarksToCalendar,
} from '../../lib/calendarSync.js';
import { primaryActionClass, quietActionClass } from '../controlClasses.js';

/**
 * @param {{ sessions: object[], eventConfig: object }} props
 *   `sessions` is the attendee's current bookmarked sessions, full records.
 */
export default function CalendarSyncCard({ sessions, eventConfig }) {
  const { user } = useAuth();
  const tokenRef = useRef(null);
  const previousRef = useRef(null);
  const [state, setState] = useState('idle'); // idle | syncing | synced | refused | error
  const [summary, setSummary] = useState('');

  const sync = useCallback(async () => {
    setState('syncing');
    try {
      let token = tokenRef.current;
      if (!token) {
        token = await requestCalendarAccess(user);
        tokenRef.current = token;
      }
      const result = await syncBookmarksToCalendar({
        token,
        sessions,
        eventConfig,
        previous: previousRef.current,
      });
      previousRef.current = { calendarId: result.calendarId, events: result.events };
      setSummary(
        `${result.created + result.updated} events written, ${result.deleted} removed${
          result.failed > 0 ? `, ${result.failed} could not be written this pass` : ''
        }.`,
      );
      setState('synced');
    } catch (err) {
      if (err instanceof CalendarScopeRefusedError) {
        setState('refused');
      } else {
        setState('error');
      }
    }
  }, [user, sessions, eventConfig]);

  // The event ids are the change signal: an edit to the bookmark set (or a
  // session edit the operator published) moves this string, and a live
  // token re-syncs on its own.
  const sessionKey = sessions.map((session) => session.id).join(',');
  const ranOnce = useRef(false);
  useEffect(() => {
    if (!tokenRef.current || !previousRef.current) return;
    const known = Object.keys(previousRef.current.events ?? {}).sort().join(',');
    if (ranOnce.current && known === sessionKey) return;
    ranOnce.current = true;
    sync();
  }, [sessionKey, sync]);

  if (!user) return null;

  return (
    <section aria-labelledby="calendar-sync-heading" className="mt-xl border-t-hairline border-t-rule-hairline pt-sm">
      <h2 id="calendar-sync-heading" className="font-heading text-h3 font-semibold text-text-primary">
        Google Calendar
      </h2>
      {state === 'refused' ? (
        <p className="mt-xs max-w-prose text-body text-text-secondary">
          Calendar access wasn’t granted, so nothing was written. You can still download the
          .ics file below — it never needs a Google account.
        </p>
      ) : state === 'error' ? (
        <p role="status" className="mt-xs max-w-prose text-body text-text-secondary">
          The calendar could not be updated just now. Try again, or use the .ics download below.
        </p>
      ) : state === 'synced' ? (
        <p role="status" className="mt-xs max-w-prose text-body text-text-secondary">
          Your calendar is up to date. {summary} It re-syncs when you change your bookmarks.
        </p>
      ) : state === 'syncing' ? (
        <p role="status" className="mt-xs max-w-prose text-body text-text-secondary">
          Writing your sessions to your calendar…
        </p>
      ) : (
        <p className="mt-xs max-w-prose text-body text-text-secondary">
          Keep your saved sessions on your own Google Calendar. You choose the account, and you
          can revoke the access at any time from your Google account.
        </p>
      )}
      <div className="mt-sm">
        {state === 'syncing' ? (
          <button type="button" className={primaryActionClass} disabled>
            Syncing…
          </button>
        ) : (
          <button type="button" className={state === 'synced' ? quietActionClass : primaryActionClass} onClick={sync}>
            {state === 'synced' ? 'Sync now' : 'Sync my sessions to Google Calendar'}
          </button>
        )}
      </div>
    </section>
  );
}
