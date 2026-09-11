// lib/calendarSync.js — the optional Google Calendar sync (issue #177).
// fetch is stubbed; every test reads the requests the sync makes and the
// summary it returns.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({ link: vi.fn(), reauth: vi.fn(), scope: vi.fn(), credential: vi.fn() }));
vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: class {
    addScope(value) { authMocks.scope(value); }
    static credentialFromResult(value) { return authMocks.credential(value); }
  },
  linkWithPopup: authMocks.link,
  reauthenticateWithPopup: authMocks.reauth,
}));
const {
  syncBookmarksToCalendar, calendarEventBody, requestCalendarAccess,
  readCalendarId, saveCalendarId, clearCalendarId,
} = await import('./calendarSync.js');

const EVENT = {
  name: '[Fixture] Lakeshore Docs Camp',
  timezone: 'America/Chicago',
  days: [{ id: 'd1', label: 'Day one', date: '2026-10-15' }],
};

const SESSION = {
  id: 's1',
  dayId: 'd1',
  startTime: '09:05',
  endTime: '09:45',
  title: 'Morning kickoff',
  description: 'What the day covers',
  location: 'Main hall',
};

function fakeFetch(known = {}) {
  const calls = [];
  const fetchImpl = vi.fn(async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null });
    if (url.includes('/calendars') && init.method === 'POST' && !url.includes('/events')) {
      return { ok: true, status: 200, json: async () => ({ id: 'cal-1' }) };
    }
    if (url.includes('/events/') && init.method === 'PUT') {
      return { ok: true, status: 200, json: async () => ({ id: 'ev-1' }) };
    }
    if (url.includes('/events') && init.method === 'POST') {
      return { ok: true, status: 200, json: async () => ({ id: `ev-${calls.length}` }) };
    }
    if (init.method === 'DELETE') {
      return { ok: true, status: 204, json: async () => null };
    }
    if (init.method === 'GET') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            ...Object.entries(known).map(([sessionId, id]) => ({ id, extendedProperties: { private: { 'eventrunner/sessionId': sessionId } } })),
            {
              id: 'ev-listed',
              status: 'cancelled',
              extendedProperties: { private: { 'eventrunner/sessionId': 'gone' } },
            },
          ],
        }),
      };
    }
    return { ok: false, status: 500, json: async () => ({}) };
  });
  return { fetchImpl, calls };
}

beforeEach(() => {
  authMocks.link.mockReset().mockResolvedValue({});
  authMocks.reauth.mockReset().mockResolvedValue({});
  authMocks.scope.mockReset();
  authMocks.credential.mockReset().mockReturnValue({ accessToken: 'fixture-token' });
  localStorage.clear();
});
afterEach(() => {});

describe('syncBookmarksToCalendar', () => {
  it('creates a dedicated calendar once and inserts one event per bookmark', async () => {
    const { fetchImpl, calls } = fakeFetch();
    const result = await syncBookmarksToCalendar({
      token: 'tok',
      sessions: [SESSION],
      eventConfig: EVENT,
      previous: null,
      fetchImpl,
    });

    expect(result.calendarId).toBe('cal-1');
    expect(result.created).toBe(1);
    // Order: calendar create, list the fresh calendar, insert the event.
    expect(calls[0].body.summary).toContain('[Fixture] Lakeshore Docs Camp');
    expect(calls[1].method).toBe('GET');
    expect(
      calls[2].body.extendedProperties.private['eventrunner/sessionId'],
    ).toBe('s1');
    expect(calls[2].body.summary).toBe('Morning kickoff');
  });

  it('a second pass with the same set inserts nothing new', async () => {
    const { fetchImpl, calls } = fakeFetch({ s1: 'ev-known' });
    await syncBookmarksToCalendar({
      token: 'tok',
      sessions: [SESSION],
      eventConfig: EVENT,
      previous: { calendarId: 'cal-1', events: { s1: 'ev-known' } },
      fetchImpl,
    });
    const inserts = calls.filter((call) => call.method === 'POST' && call.url.includes('/events'));
    expect(inserts).toHaveLength(0);
    const updates = calls.filter((call) => call.method === 'PUT');
    expect(updates).toHaveLength(1);
    expect(updates[0].url).toContain('ev-known');
  });

  it('a removed bookmark deletes its event, and an edit updates in place', async () => {
    const { fetchImpl, calls } = fakeFetch({ s1: 'ev-known' });
    const result = await syncBookmarksToCalendar({
      token: 'tok',
      sessions: [],
      eventConfig: EVENT,
      previous: { calendarId: 'cal-1', events: { s1: 'ev-known' } },
      fetchImpl,
    });
    expect(result.deleted).toBe(1);
    expect(calls.some((call) => call.method === 'DELETE' && call.url.includes('null'))).toBe(false);
  });

  it('a refused or failing call counts as failed and never throws away the pass', async () => {
    const fetchImpl = vi.fn(async (_url, init) => init.method === 'GET'
      ? { ok: true, status: 200, json: async () => ({ items: [] }) }
      : { ok: false, status: 429, json: async () => ({}) });
    const result = await syncBookmarksToCalendar({
      token: 'tok',
      sessions: [SESSION],
      eventConfig: EVENT,
      previous: { calendarId: 'cal-1', events: {} },
      fetchImpl,
    });
    expect(result.failed).toBe(1);
  });

  it('a session whose time cannot be resolved is skipped, not written wrong', async () => {
    const { fetchImpl, calls } = fakeFetch();
    const broken = { ...SESSION, startTime: null };
    await syncBookmarksToCalendar({
      token: 'tok',
      sessions: [broken],
      eventConfig: EVENT,
      previous: { calendarId: 'cal-1', events: {} },
      fetchImpl,
    });
    const inserts = calls.filter((call) => call.method === 'POST' && call.url.includes('/events'));
    expect(inserts).toHaveLength(0);
  });

  it.each([404, 410])('replaces a remembered calendar when its first listing returns %i', async (status) => {
    const calls = [];
    const missing = vi.fn();
    const created = vi.fn();
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url, method: init.method });
      if (url.includes('/calendars/stale/events') && init.method === 'GET') {
        return { ok: false, status };
      }
      if (url.endsWith('/calendars') && init.method === 'POST') {
        return { ok: true, status: 200, json: async () => ({ id: 'replacement' }) };
      }
      if (url.includes('/calendars/replacement/events') && init.method === 'GET') {
        return { ok: true, status: 200, json: async () => ({ items: [] }) };
      }
      if (url.includes('/calendars/replacement/events') && init.method === 'POST') {
        return { ok: true, status: 200, json: async () => ({ id: 'new-event' }) };
      }
      return { ok: false, status: 500 };
    });

    const result = await syncBookmarksToCalendar({
      token: 'tok', sessions: [SESSION], eventConfig: EVENT,
      previous: { calendarId: 'stale' }, fetchImpl,
      onCalendarMissing: missing, onCalendarCreated: created,
    });

    expect(missing).toHaveBeenCalledWith('stale');
    expect(created).toHaveBeenCalledWith('replacement');
    expect(result.calendarId).toBe('replacement');
    expect(result.created).toBe(1);
    expect(calls.filter((entry) => entry.url.endsWith('/calendars'))).toHaveLength(1);
  });

  it.each([401, 403])('does not replace a remembered calendar after a %i listing error', async (status) => {
    const missing = vi.fn();
    const created = vi.fn();
    const fetchImpl = vi.fn(async () => ({ ok: false, status }));

    await expect(syncBookmarksToCalendar({
      token: 'tok', sessions: [], eventConfig: EVENT,
      previous: { calendarId: 'stale' }, fetchImpl,
      onCalendarMissing: missing, onCalendarCreated: created,
    })).rejects.toMatchObject({ status });
    expect(missing).not.toHaveBeenCalled();
    expect(created).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not mistake an event-item 404 for a missing calendar', async () => {
    const missing = vi.fn();
    const fetchImpl = vi.fn(async (url, init) => {
      if (init.method === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [{
              id: 'missing-event',
              extendedProperties: { private: { 'eventrunner/sessionId': 's1' } },
            }],
          }),
        };
      }
      if (url.includes('/events/missing-event') && init.method === 'PUT') {
        return { ok: false, status: 404 };
      }
      return { ok: false, status: 500 };
    });

    const result = await syncBookmarksToCalendar({
      token: 'tok', sessions: [SESSION], eventConfig: EVENT,
      previous: { calendarId: 'kept' }, fetchImpl, onCalendarMissing: missing,
    });
    expect(result.calendarId).toBe('kept');
    expect(result.failed).toBe(1);
    expect(missing).not.toHaveBeenCalled();
    expect(fetchImpl.mock.calls.some(([url]) => url.endsWith('/calendars'))).toBe(false);
  });

  it('does not create a second replacement when the fresh calendar listing fails', async () => {
    const fetchImpl = vi.fn(async (url, init) => {
      if (url.endsWith('/calendars') && init.method === 'POST') {
        return { ok: true, status: 200, json: async () => ({ id: 'replacement' }) };
      }
      return { ok: false, status: 404 };
    });

    await expect(syncBookmarksToCalendar({
      token: 'tok', sessions: [], eventConfig: EVENT,
      previous: { calendarId: 'stale' }, fetchImpl,
    })).rejects.toMatchObject({ status: 404 });
    expect(fetchImpl.mock.calls.filter(([url]) => url.endsWith('/calendars'))).toHaveLength(1);
  });
});

describe('calendarEventBody', () => {
  it('resolves the session on the event wall clock', () => {
    const body = calendarEventBody(SESSION, { calendarId: 'cal-1', eventConfig: EVENT });
    // 09:05 CDT (UTC−5) on 2026-10-15.
    expect(body.start.dateTime).toBe('2026-10-15T14:05:00.000Z');
    expect(body.end.dateTime).toBe('2026-10-15T14:45:00.000Z');
    expect(body.summary).toBe('Morning kickoff');
  });

  it('an unresolvable session produces no body at all', () => {
    expect(calendarEventBody({ ...SESSION, startTime: null }, { calendarId: 'c', eventConfig: EVENT })).toBeNull();
  });
});

it('re-reads every page and retries failed deletions without touching untagged events', async () => {
  const calls = [];
  let refuse = true;
  const fetchImpl = vi.fn(async (url, init) => {
    calls.push({ url, method: init.method });
    if (init.method === 'GET') return { ok: true, status: 200, json: async () => url.includes('pageToken=next')
      ? { items: [{ id: 'ours', extendedProperties: { private: { 'eventrunner/sessionId': 's1' } } }] }
      : { items: [{ id: 'personal' }], nextPageToken: 'next' } };
    return { ok: !refuse, status: refuse ? 429 : 204 };
  });
  const args = { token: 'tok', sessions: [], eventConfig: EVENT, previous: { calendarId: 'c' }, fetchImpl };
  const failed = await syncBookmarksToCalendar(args);
  expect(failed.failed).toBe(1);
  expect(failed.events.s1).toBe('ours');
  refuse = false;
  const retried = await syncBookmarksToCalendar({ ...args, previous: failed });
  expect(retried.deleted).toBe(1);
  expect(calls.filter((c) => c.method === 'DELETE').every((c) => c.url.endsWith('/ours'))).toBe(true);
});

it('retains the calendar id before a later request fails', async () => {
  const saved = vi.fn();
  const fetchImpl = vi.fn(async (_url, init) => init.method === 'POST'
    ? { ok: true, status: 200, json: async () => ({ id: 'new-calendar' }) }
    : { ok: false, status: 503 });
  await expect(syncBookmarksToCalendar({ token: 'tok', sessions: [], eventConfig: EVENT,
    onCalendarCreated: saved, fetchImpl })).rejects.toThrow('503');
  expect(saved).toHaveBeenCalledWith('new-calendar');
});

it('reports an expired token so the control can obtain a new grant', async () => {
  const fetchImpl = vi.fn(async (_url, init) => init.method === 'GET'
    ? { ok: true, status: 200, json: async () => ({ items: [] }) }
    : { ok: false, status: 401 });
  await expect(syncBookmarksToCalendar({ token: 'tok', sessions: [SESSION], eventConfig: EVENT,
    previous: { calendarId: 'c' }, fetchImpl })).rejects.toMatchObject({ status: 401 });
});

it('refuses a session without a usable end time', () => {
  expect(calendarEventBody({ ...SESSION, endTime: null }, { eventConfig: EVENT })).toBeNull();
});

it('requests permission to create the dedicated calendar and links an email account only once', async () => {
  const emailUser = { uid: 'u1', providerData: [] };
  expect(await requestCalendarAccess(emailUser)).toBe('fixture-token');
  expect(authMocks.scope).toHaveBeenCalledWith('https://www.googleapis.com/auth/calendar.app.created');
  expect(authMocks.link).toHaveBeenCalledWith(emailUser, expect.anything());
  const linked = { ...emailUser, providerData: [{ providerId: 'google.com', uid: 'g1' }] };
  await requestCalendarAccess(linked);
  expect(authMocks.link).toHaveBeenCalledTimes(1);
  expect(authMocks.reauth).toHaveBeenCalledWith(linked, expect.anything());
});

it('stores only the calendar id and isolates it by attendee, project and Google identity', () => {
  const user = { uid: 'u1', auth: { app: { options: { projectId: 'demo-run-of-show' } } },
    providerData: [{ providerId: 'google.com', uid: 'g1' }] };
  saveCalendarId(user, 'calendar-id');
  expect(readCalendarId(user)).toBe('calendar-id');
  expect(readCalendarId({ ...user, uid: 'u2' })).toBeNull();
  expect(readCalendarId({ ...user, providerData: [{ providerId: 'google.com', uid: 'g2' }] })).toBeNull();
  expect(readCalendarId({ ...user, auth: { app: { options: { projectId: 'demo-other' } } } })).toBeNull();
  expect(localStorage.length).toBe(1);
  expect(localStorage.getItem(localStorage.key(0))).toBe('calendar-id');
  clearCalendarId(user);
  expect(readCalendarId(user)).toBeNull();
  expect(localStorage.length).toBe(0);
});

it('continues without persisted calendar ids when browser storage is unavailable', () => {
  const user = { uid: 'u1', auth: { app: { options: { projectId: 'demo-run-of-show' } } },
    providerData: [{ providerId: 'google.com', uid: 'g1' }] };
  const unavailable = () => { throw new DOMException('Storage unavailable', 'SecurityError'); };

  const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(unavailable);
  expect(readCalendarId(user)).toBeNull();
  getItem.mockRestore();

  const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(unavailable);
  expect(() => saveCalendarId(user, 'calendar-id')).not.toThrow();
  expect(setItem).toHaveBeenCalledOnce();
  setItem.mockRestore();

  const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(unavailable);
  expect(() => clearCalendarId(user)).not.toThrow();
  expect(removeItem).toHaveBeenCalledOnce();
  removeItem.mockRestore();
});
