// Optional calendar sync. Tokens stay in memory; only the dedicated
// calendar id is saved locally, scoped to the Firebase account and project.
import { GoogleAuthProvider, linkWithPopup, reauthenticateWithPopup } from 'firebase/auth';
import { resolveSessionInstants } from './eventTime.js';

const SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
const SESSION_PROPERTY = 'eventrunner/sessionId';
const OWNER_PROPERTY = 'eventrunner/owner';
const OWNER = 'saved-session';
const DISCOVERY = 'https://www.googleapis.com/calendar/v3';

export class CalendarScopeRefusedError extends Error {
  constructor(message = 'Calendar access was not granted.') {
    super(message);
    this.name = 'CalendarScopeRefusedError';
  }
}

// Keep only a classification and status, never provider messages, URLs,
// credentials, or raw responses. Unknown 403s do not prove missing setup.
export class CalendarAccessError extends Error {
  constructor(kind, status) {
    super(`Calendar request failed${status ? ` (${status})` : ''}.`);
    this.name = 'CalendarAccessError';
    this.kind = kind;
    this.status = status;
  }
}

function providerErrorKind(status, payload) {
  const errors = Array.isArray(payload?.error?.errors) ? payload.error.errors : [];
  const details = Array.isArray(payload?.error?.details) ? payload.error.details : [];
  const reasons = [
    ...errors.map((entry) => entry?.reason),
    ...details.filter((entry) => entry?.['@type'] === 'type.googleapis.com/google.rpc.ErrorInfo')
      .map((entry) => entry.reason),
  ];
  if (status === 401) return 'expired';
  if (reasons.some((reason) => ['accessNotConfigured', 'SERVICE_DISABLED', 'API_DISABLED'].includes(reason))) return 'setup';
  if (reasons.some((reason) => ['insufficientPermissions', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT'].includes(reason))) return 'scope';
  return 'request';
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
  } catch (error) {
    if (error instanceof CalendarScopeRefusedError) throw error;
    if (['auth/operation-not-allowed', 'auth/unauthorized-domain', 'auth/invalid-oauth-client-id'].includes(error.code)) {
      throw new CalendarAccessError('setup');
    }
    if (['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled',
      'auth/credential-already-in-use', 'auth/account-exists-with-different-credential'].includes(error.code)) {
      throw new CalendarScopeRefusedError();
    }
    throw new CalendarAccessError('request');
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
    let payload;
    try { payload = await response.json(); } catch { /* A non-JSON refusal is unclassified. */ }
    throw new CalendarAccessError(providerErrorKind(response.status, payload), response.status);
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
    start: { dateTime: start.toISOString(), timeZone: eventConfig.timezone },
    end: { dateTime: end.toISOString(), timeZone: eventConfig.timezone },
    extendedProperties: { private: { [OWNER_PROPERTY]: OWNER, [SESSION_PROPERTY]: session.id } },
  };
}

function ownedSession(item) {
  const properties = item.extendedProperties?.private;
  return properties?.[OWNER_PROPERTY] === OWNER ? properties[SESSION_PROPERTY] : null;
}

// Hex is a subset of Google's base32hex alphabet. A stable ID coordinates
// inserts across tabs without tokens, locks, or a stored event map.
async function eventId(seed) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed));
  return `er${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
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
  const listPage = (path, pageToken, filtered = true) => {
    const params = new URLSearchParams({ maxResults: '2500', showDeleted: 'false' });
    if (filtered) params.set('privateExtendedProperty', `${OWNER_PROPERTY}=${OWNER}`);
    if (pageToken) params.set('pageToken', pageToken);
    return request('GET', `${path}?${params}`);
  };

  let calendarId = previous?.calendarId ?? null;
  const rememberedCalendarId = calendarId;
  if (!calendarId) {
    calendarId = await createCalendar();
  }
  let path = `/calendars/${encodeURIComponent(calendarId)}/events`;
  // Old versions wrote only the session property. On the first use of a
  // remembered calendar in this page, finish that migration before using
  // the ownership filter. Never persist migration state or any event IDs.
  let migrate = Boolean(rememberedCalendarId && !previous?.ownershipMigrated);
  let listed;
  try {
    listed = await listPage(path, null, !migrate);
  } catch (error) {
    const missingRememberedCalendar = rememberedCalendarId &&
      (error.status === 404 || error.status === 410) && !signal?.aborted;
    if (!missingRememberedCalendar) throw error;
    onCalendarMissing(rememberedCalendarId);
    calendarId = await createCalendar();
    path = `/calendars/${encodeURIComponent(calendarId)}/events`;
    migrate = false;
    // This fresh calendar gets one list attempt. A second missing response
    // is an API failure, not permission to create calendars in a loop.
    listed = await listPage(path);
  }

  if (migrate) {
    const oldEvents = [];
    while (listed) {
      oldEvents.push(...(listed.items ?? []));
      listed = listed.nextPageToken ? await listPage(path, listed.nextPageToken, false) : null;
    }
    for (const item of oldEvents) {
      const properties = item.extendedProperties?.private;
      if (!properties?.[SESSION_PROPERTY] || properties[OWNER_PROPERTY] || item.status === 'cancelled') continue;
      try {
        await request('PATCH', `${path}/${encodeURIComponent(item.id)}`, {
          extendedProperties: { private: { ...properties, [OWNER_PROPERTY]: OWNER } },
        });
      } catch (error) {
        // A concurrent removal needs no migration. Any other failure stops
        // here: hiding an unmigrated event could create a replacement copy.
        if (![404, 410].includes(error.status) || signal?.aborted) throw error;
      }
    }
    listed = await listPage(path);
  }

  const known = new Map();
  while (listed) {
    for (const item of listed.items ?? []) {
      const sessionId = ownedSession(item);
      if (!sessionId || item.status === 'cancelled') continue;
      const ids = known.get(sessionId) ?? new Set();
      ids.add(item.id);
      known.set(sessionId, ids);
    }
    listed = listed.nextPageToken ? await listPage(path, listed.nextPageToken) : null;
  }

  const applied = { calendarId, ownershipMigrated: true, created: 0, updated: 0, deleted: 0, failed: 0 };
  const fatal = (error) => signal?.aborted || ['setup', 'scope', 'expired'].includes(error.kind);
  const remove = async (remoteId) => {
    try {
      await request('DELETE', `${path}/${encodeURIComponent(remoteId)}`);
      applied.deleted += 1;
    } catch (error) {
      if (fatal(error)) throw error;
      if (![404, 410].includes(error.status)) applied.failed += 1;
    }
  };

  const createOrRecover = async (sessionId, body) => {
    let id = await eventId(`eventrunner/session:${sessionId}`);
    for (;;) {
      signal?.throwIfAborted();
      try {
        await request('POST', path, { ...body, id });
        applied.created += 1;
        return id;
      } catch (error) {
        if (error.status !== 409) throw error;
      }
      // A conflict may be another tab's successful insert, an unrelated
      // event, or a tombstone. Only update a live event with our ownership.
      let existing;
      try {
        existing = await request('GET', `${path}/${encodeURIComponent(id)}`);
      } catch (error) {
        if (error.status !== 410) throw error;
        id = await eventId(id);
        continue;
      }
      if (existing.status === 'cancelled') {
        // Deleted IDs cannot be reused. All tabs walk the same deterministic
        // successor chain, so re-saving a removed bookmark is retry safe.
        id = await eventId(id);
        continue;
      }
      if (ownedSession(existing) !== sessionId) throw new CalendarAccessError('request', 409);
      await request('PUT', `${path}/${encodeURIComponent(id)}`, body);
      applied.updated += 1;
      return id;
    }
  };

  const wanted = new Map(sessions.map((session) => [session.id, session]));
  for (const [sessionId, remoteIds] of known) {
    if (wanted.has(sessionId)) continue;
    for (const id of remoteIds) await remove(id);
  }
  for (const [sessionId, session] of wanted) {
    const [remoteId, ...duplicates] = [...(known.get(sessionId) ?? [])].sort();
    const body = calendarEventBody(session, { eventConfig });
    if (!body) { applied.failed += 1; continue; }
    try {
      let keptId = remoteId;
      if (remoteId) {
        try {
          await request('PUT', `${path}/${encodeURIComponent(remoteId)}`, body);
          applied.updated += 1;
        } catch (error) {
          if (![404, 410].includes(error.status)) throw error;
          keptId = await createOrRecover(sessionId, body);
        }
      } else {
        keptId = await createOrRecover(sessionId, body);
      }
      for (const id of duplicates) {
        if (id !== keptId) await remove(id);
      }
    } catch (error) {
      if (fatal(error)) throw error;
      applied.failed += 1;
    }
  }
  return applied;
}
