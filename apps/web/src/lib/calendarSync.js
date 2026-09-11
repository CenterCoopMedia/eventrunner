// Optional Google Calendar sync of saved sessions (issue #177; ADR 0003).
//
// THE SHAPE OF THE INTEGRATION, and why: the browser already holds a
// signed-in Google identity through Firebase Auth, so the grant is one
// popup with the calendar.events scope, and the token never leaves the
// attendee's browser — no platform credential store, no server calendar
// writer, and nothing to leak from Firestore (ADR 0003).
//
// OWNERSHIP OF THE EVENTS. The sync only ever touches events it can
// identify as its own: every one carries a private extended property
// (`eventrunner/sessionId`). Listing filters on that property, so a
// reader's other calendar events — and other attendees' events entirely —
// are invisible here, and a failed pass leaves the next pass correct
// because the target state is computed, not remembered.
//
// THE FALLBACK IS THE PRODUCT. A refused scope is not an error state: the
// caller hands back to the .ics export, which never needed a grant at all.
import { GoogleAuthProvider, reauthenticateWithPopup } from 'firebase/auth';
import { resolveSessionInstants } from './eventTime.js';

const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const SESSION_PROPERTY = 'eventrunner/sessionId';
const DISCOVERY = 'https://www.googleapis.com/calendar/v3';

/** Thrown when the attendee declines the consent screen, or the grant fails. */
export class CalendarScopeRefusedError extends Error {
  constructor(message = 'Calendar access was not granted.') {
    super(message);
    this.name = 'CalendarScopeRefusedError';
  }
}

/**
 * Ask the attendee for calendar write access. Returns the access token for
 * the session; the caller keeps it in memory and never persists it.
 *
 * @param {import('firebase/auth').User} user
 * @returns {Promise<string>} the Google access token
 * @throws {CalendarScopeRefusedError} when the popup is dismissed or the grant refused
 */
export async function requestCalendarAccess(user) {
  const provider = new GoogleAuthProvider();
  provider.addScope(SCOPE);
  try {
    const result = await reauthenticateWithPopup(user, provider);
    const token = GoogleAuthProvider.credentialFromResult(result)?.accessToken;
    if (!token) throw new Error('no access token in the grant');
    return token;
  } catch (err) {
    if (err instanceof CalendarScopeRefusedError) throw err;
    throw new CalendarScopeRefusedError();
  }
}

/** One authenticated Calendar API call. Non-2xx becomes an error the caller states. */
async function call(doFetch, token, method, path, body) {
  const response = await doFetch(`${DISCOVERY}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    throw new Error(`Calendar API ${method} ${path} answered ${response.status}`);
  }
  return response.status === 204 ? null : response.json();
}

/**
 * The Google event body one session produces. Times resolve on the event's
 * wall clock through the one resolver everything else uses
 * (lib/eventTime.js), so the calendar event lands at the same instant the
 * programme prints; a session whose time cannot be resolved produces null
 * and the caller skips it rather than writing a wrong time.
 *
 * @param {object} session
 * @param {{ calendarId: string, eventConfig: object }} cfg
 * @returns {object | null}
 */
export function calendarEventBody(session, { calendarId, eventConfig }) {
  const { start, end } = resolveSessionInstants(eventConfig, session);
  if (!start) return null;
  return {
    summary: session.title ?? 'Untitled session',
    description: session.description ?? '',
    location: session.location ?? '',
    start: { dateTime: start.toISOString() },
    ...(end ? { end: { dateTime: end.toISOString() } } : {}),
    extendedProperties: { private: { [SESSION_PROPERTY]: session.id } },
    calendarId,
  };
}

/**
 * Bring one attendee's calendar to their current bookmark set, in one
 * pass, tolerating a partial failure: every session is applied
 * independently and the summary reports what is left over.
 *
 * @param {{
 *   token: string,
 *   sessions: object[],          // the CURRENT bookmarked sessions, full records
 *   eventConfig: object,
 *   previous?: { calendarId: string, events: Record<string, string> },
 *   fetchImpl?: typeof fetch,
 * }} args
 *   `previous` names the calendar and the sessionId → Google event id map
 *   the last pass left behind, so removed bookmarks can be deleted and
 *   kept ones update in place. Without it the pass lists the calendar's
 *   own events instead.
 * @returns {Promise<{ calendarId: string, events: Record<string, string>,
 *                     created: number, updated: number, deleted: number, failed: number }>}
 */
export async function syncBookmarksToCalendar({ token, sessions, eventConfig, previous = null, fetchImpl } = {}) {
  const doFetch = fetchImpl ?? fetch;

  // One calendar per attendee per event: "the event's own programme on the
  // attendee's own account", never their personal calendar. The name
  // follows the event's configured name; the attendee owns the calendar
  // and can delete it without asking anyone.
  let calendarId = previous?.calendarId ?? null;
  if (!calendarId) {
    const calendar = await call(doFetch, token, 'POST', '/calendars', {
      summary: eventConfig.name ? `${eventConfig.name} — my sessions` : 'My event sessions',
    });
    calendarId = calendar.id;
  }

  const applied = { calendarId, created: 0, updated: 0, deleted: 0, failed: 0, events: {} };
  const wanted = new Map(sessions.map((session) => [session.id, session]));

  // What the last pass left: either handed in, or listed from the calendar
  // itself. The calendar is DEDICATED — every event on it is ours — so the
  // listing is complete without a property filter (the API supports exact
  // matches only), and the private property maps each event back to its
  // session.
  let known = new Map();
  if (previous?.events && typeof previous.events === 'object') {
    known = new Map(Object.entries(previous.events));
  } else {
    const listed = await call(
      doFetch,
      token,
      'GET',
      `/calendars/${encodeURIComponent(calendarId)}/events?maxResults=2500&showDeleted=false`,
    );
    for (const item of listed.items ?? []) {
      const sessionId = item.extendedProperties?.private?.[SESSION_PROPERTY];
      if (sessionId && item.status !== 'cancelled') known.set(sessionId, item.id);
    }
  }

  // Deleted bookmarks: the session is gone from the wanted set but its
  // event is still on the calendar.
  for (const [sessionId, remoteId] of known) {
    if (wanted.has(sessionId)) continue;
    if (!remoteId) continue; // listed pass cleans up on its next full run
    try {
      await call(doFetch, token, 'DELETE', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(remoteId)}`);
      applied.deleted += 1;
    } catch {
      applied.failed += 1;
    }
  }

  for (const [sessionId, session] of wanted) {
    const remoteId = known.get(sessionId);
    const body = calendarEventBody(session, { calendarId, eventConfig });
    if (!body) continue; // an unresolvable time is never written as a wrong one
    try {
      if (remoteId) {
        await call(doFetch, token, 'PUT', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(remoteId)}`, body);
        applied.updated += 1;
        applied.events[sessionId] = remoteId;
      } else {
        const createdEvent = await call(doFetch, token, 'POST', `/calendars/${encodeURIComponent(calendarId)}/events`, body);
        applied.created += 1;
        applied.events[sessionId] = createdEvent.id;
      }
    } catch {
      applied.failed += 1;
    }
  }

  return applied;
}
