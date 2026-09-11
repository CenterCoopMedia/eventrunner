// Optional calendar sync. Tokens stay in memory; only the dedicated
// calendar id is saved locally, scoped to the Firebase account and project.
import { GoogleAuthProvider, linkWithPopup, reauthenticateWithPopup } from 'firebase/auth';
import { resolveSessionInstants } from './eventTime.js';

const SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
const SESSION_PROPERTY = 'eventrunner/sessionId';
const DISCOVERY = 'https://www.googleapis.com/calendar/v3';

export class CalendarScopeRefusedError extends Error {
  constructor(message = 'Calendar access was not granted.') {
    super(message);
    this.name = 'CalendarScopeRefusedError';
  }
}

export async function requestCalendarAccess(user) {
  const provider = new GoogleAuthProvider();
  provider.addScope(SCOPE);
  try {
    const linked = user.providerData?.some((entry) => entry.providerId === 'google.com');
    const result = await (linked ? reauthenticateWithPopup : linkWithPopup)(user, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) throw new CalendarScopeRefusedError();
    return credential.accessToken;
  } catch {
    throw new CalendarScopeRefusedError();
  }
}

function calendarStorageKey(user) {
  const googleId = user.providerData?.find((entry) => entry.providerId === 'google.com')?.uid;
  return `eventrunner.calendar:${user.auth.app.options.projectId}:${user.uid}:${googleId ?? ''}`;
}

export function readCalendarId(user) {
  try {
    return localStorage.getItem(calendarStorageKey(user));
  } catch {
    return null;
  }
}

export function saveCalendarId(user, calendarId) {
  try {
    localStorage.setItem(calendarStorageKey(user), calendarId);
  } catch {
    // Persistence is optional. The mounted sync control keeps this id in memory.
  }
}

export function clearCalendarId(user) {
  try {
    localStorage.removeItem(calendarStorageKey(user));
  } catch {
    // An unavailable store is already equivalent to having no saved id.
  }
}

async function call(doFetch, token, method, path, body, signal) {
  const response = await doFetch(`${DISCOVERY}${path}`, {
    method,
    signal,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const error = new Error(`Calendar request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

export function calendarEventBody(session, { eventConfig }) {
  const { start, end } = resolveSessionInstants(eventConfig, session);
  if (!start || !end || end <= start) return null;
  return {
    summary: session.title ?? 'Untitled session',
    description: session.description ?? '',
    location: session.location ?? '',
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    extendedProperties: { private: { [SESSION_PROPERTY]: session.id } },
  };
}

/**
 * Read the current remote state on every pass, including every page. An
 * earlier failed update or delete must remain eligible for the next pass.
 * Untagged events, including user additions to this calendar, are untouched.
 */
export async function syncBookmarksToCalendar({
  token, sessions, eventConfig, previous = null, fetchImpl,
  onCalendarCreated = () => {}, onCalendarMissing = () => {}, signal,
} = {}) {
  const doFetch = fetchImpl ?? fetch;
  const request = (method, path, body) => call(doFetch, token, method, path, body, signal);
  const createCalendar = async () => {
    const calendar = await request('POST', '/calendars', {
      summary: eventConfig.name ? `${eventConfig.name} — my sessions` : 'My event sessions',
    });
    // Save before any event write: a partial failure must not create a
    // second calendar on the next attempt.
    onCalendarCreated(calendar.id);
    return calendar.id;
  };
  const listPage = (path, pageToken) => {
    const params = new URLSearchParams({ maxResults: '2500', showDeleted: 'false' });
    if (pageToken) params.set('pageToken', pageToken);
    return request('GET', `${path}?${params}`);
  };

  let calendarId = previous?.calendarId ?? null;
  const rememberedCalendarId = calendarId;
  if (!calendarId) {
    calendarId = await createCalendar();
  }
  let path = `/calendars/${encodeURIComponent(calendarId)}/events`;
  const known = new Map();
  let listed;
  try {
    listed = await listPage(path);
  } catch (error) {
    const missingRememberedCalendar = rememberedCalendarId &&
      (error.status === 404 || error.status === 410) && !signal?.aborted;
    if (!missingRememberedCalendar) throw error;
    onCalendarMissing(rememberedCalendarId);
    calendarId = await createCalendar();
    path = `/calendars/${encodeURIComponent(calendarId)}/events`;
    // This fresh calendar gets one list attempt. A second missing response
    // is an API failure, not permission to create calendars in a loop.
    listed = await listPage(path);
  }

  while (listed) {
    for (const item of listed.items ?? []) {
      const sessionId = item.extendedProperties?.private?.[SESSION_PROPERTY];
      if (sessionId && item.status !== 'cancelled') known.set(sessionId, item.id);
    }
    listed = listed.nextPageToken ? await listPage(path, listed.nextPageToken) : null;
  }

  const applied = { calendarId, created: 0, updated: 0, deleted: 0, failed: 0, events: {} };
  const wanted = new Map(sessions.map((session) => [session.id, session]));
  for (const [sessionId, remoteId] of known) {
    if (wanted.has(sessionId)) continue;
    try {
      await request('DELETE', `${path}/${encodeURIComponent(remoteId)}`);
      applied.deleted += 1;
    } catch (error) {
      if (error.status === 401 || signal?.aborted) throw error;
      if (error.status === 404 || error.status === 410) continue;
      applied.failed += 1;
      applied.events[sessionId] = remoteId;
    }
  }
  for (const [sessionId, session] of wanted) {
    const remoteId = known.get(sessionId);
    const body = calendarEventBody(session, { eventConfig });
    if (!body) { applied.failed += 1; continue; }
    try {
      if (remoteId) {
        await request('PUT', `${path}/${encodeURIComponent(remoteId)}`, body);
        applied.updated += 1;
        applied.events[sessionId] = remoteId;
      } else {
        const created = await request('POST', path, body);
        applied.created += 1;
        applied.events[sessionId] = created.id;
      }
    } catch (error) {
      if (error.status === 401 || signal?.aborted) throw error;
      applied.failed += 1;
      if (remoteId) applied.events[sessionId] = remoteId;
    }
  }
  return applied;
}
