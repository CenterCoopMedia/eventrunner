// Optional calendar sync, scoped to the current signed-in account.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext.jsx';
import {
  CalendarScopeRefusedError,
  clearCalendarId,
  requestCalendarAccess,
  readCalendarId,
  saveCalendarId,
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
  const controllerRef = useRef(null);
  const busyRef = useRef(false);
  const requestedRef = useRef(false);
  const completedKeyRef = useRef(null);
  const [state, setState] = useState('idle');
  const [summary, setSummary] = useState('');
  const inputKey = JSON.stringify({ sessions, days: eventConfig.days, timezone: eventConfig.timezone });
  const inputRef = useRef(null);
  inputRef.current = { sessions, eventConfig, key: inputKey };
  const syncRef = useRef(null);

  useEffect(() => () => {
    controllerRef.current?.abort();
    tokenRef.current = null;
  }, []);

  const sync = useCallback(async () => {
    if (busyRef.current) {
      requestedRef.current = true;
      return;
    }
    busyRef.current = true;
    requestedRef.current = false;
    const controller = new AbortController();
    controllerRef.current = controller;
    setState('syncing');
    try {
      let token = tokenRef.current;
      if (!token) {
        token = await requestCalendarAccess(user);
        if (controller.signal.aborted) return;
        tokenRef.current = token;
      }
      if (!previousRef.current) {
        previousRef.current = { calendarId: readCalendarId(user) };
      }
      const input = inputRef.current;
      const result = await syncBookmarksToCalendar({
        token,
        sessions: input.sessions,
        eventConfig: input.eventConfig,
        previous: previousRef.current,
        signal: controller.signal,
        onCalendarCreated: (calendarId) => {
          previousRef.current = { calendarId };
          saveCalendarId(user, calendarId);
        },
        onCalendarMissing: () => {
          previousRef.current = { calendarId: null };
          clearCalendarId(user);
        },
      });
      if (controller.signal.aborted) return;
      previousRef.current = { calendarId: result.calendarId };
      completedKeyRef.current = input.key;
      setSummary(
        `${result.created + result.updated} events written, ${result.deleted} removed${
          result.failed > 0 ? `, ${result.failed} could not be written this pass` : ''
        }.`,
      );
      setState(result.failed ? 'partial' : 'synced');
    } catch (err) {
      if (controller.signal.aborted) return;
      if (err instanceof CalendarScopeRefusedError) {
        setState('refused');
      } else {
        if (err.status === 401) tokenRef.current = null;
        setState('error');
      }
    } finally {
      busyRef.current = false;
      if (!controller.signal.aborted && requestedRef.current && tokenRef.current) {
        void syncRef.current();
      }
    }
  }, [user]);
  syncRef.current = sync;

  useEffect(() => {
    if (!tokenRef.current || completedKeyRef.current === inputKey) return;
    void sync();
  }, [inputKey, sync]);

  if (!user) return null;

  return (
    <section aria-labelledby="calendar-sync-heading" aria-busy={state === 'syncing'} className="mt-xl border-t-hairline border-t-rule-hairline pt-sm">
      <h2 id="calendar-sync-heading" className="font-heading text-h3 font-semibold text-text-primary">
        Google Calendar
      </h2>
      {state === 'refused' ? (
        <p role="status" className="mt-xs max-w-prose text-body text-text-secondary">
          Calendar access wasn’t granted, so nothing was written. You can still download the
          .ics file from your schedule — it never needs a Google account.
        </p>
      ) : state === 'error' ? (
        <p role="status" className="mt-xs max-w-prose text-body text-text-secondary">
          The calendar could not be updated just now. Try again, or use the .ics download from your schedule.
        </p>
      ) : state === 'partial' ? (
        <p role="status" className="mt-xs max-w-prose text-body text-text-secondary">
          Some events could not be updated. {summary} Try syncing again.
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
          can revoke the access at any time from your Google account. If you signed in by email,
          this connects the chosen Google account to your event sign-in. Sync runs while this page is open.
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
