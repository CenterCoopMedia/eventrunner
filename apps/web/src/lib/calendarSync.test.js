// lib/calendarSync.js — the optional Google Calendar sync (issue #177).
// fetch is stubbed; every test reads the requests the sync makes and the
// summary it returns.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { calendarProvider, calendarResponse } from '../test/calendarProvider.mjs';

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
    if (url.includes('/events/') && ['PUT', 'PATCH'].includes(init.method)) {
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
            ...Object.entries(known).map(([sessionId, id]) => ({ id, extendedProperties: { private: { 'eventrunner/sessionId': sessionId, 'eventrunner/owner': 'saved-session' } } })),
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
  vi.stubGlobal('crypto', webcrypto);
  authMocks.link.mockReset().mockResolvedValue({});
  authMocks.reauth.mockReset().mockResolvedValue({});
  authMocks.scope.mockReset();
  authMocks.credential.mockReset().mockReturnValue({ accessToken: 'fixture-token' });
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

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
              extendedProperties: { private: { 'eventrunner/sessionId': 's1', 'eventrunner/owner': 'saved-session' } },
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
    expect(body.start.timeZone).toBe('America/Chicago');
    expect(body.end.timeZone).toBe('America/Chicago');
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
      ? { items: [{ id: 'ours', extendedProperties: { private: { 'eventrunner/sessionId': 's1', 'eventrunner/owner': 'saved-session' } } }] }
      : { items: [{ id: 'personal' }], nextPageToken: 'next' } };
    return { ok: !refuse, status: refuse ? 429 : 204 };
  });
  const args = { token: 'tok', sessions: [], eventConfig: EVENT, previous: { calendarId: 'c' }, fetchImpl };
  const failed = await syncBookmarksToCalendar(args);
  expect(failed.failed).toBe(1);
  expect(failed.deleted).toBe(0);
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

describe('Calendar v3 reconciliation contract (issues 547 and 548)', () => {
  const marked = (id, sessionId = 's1', migrated = true) => ({
    id, extendedProperties: { private: {
      'eventrunner/sessionId': sessionId, ...(migrated ? { 'eventrunner/owner': 'saved-session' } : {}),
    } },
  });
  const args = { token: 'synthetic-access', sessions: [SESSION], eventConfig: EVENT,
    previous: { calendarId: 'c1', ownershipMigrated: true } };

  it('two tabs reading the same empty snapshot converge, including removal and re-saving after tombstones', async () => {
    const provider = calendarProvider([{ id: 'personal', summary: 'An attendee addition' }]);
    let reads = 0;
    let release;
    const bothListed = new Promise((resolve) => { release = resolve; });
    const fetchImpl = async (url, init) => {
      const response = await provider.fetchImpl(url, init);
      if (init.method === 'GET' && new URL(url).pathname.endsWith('/events')) {
        reads += 1;
        if (reads === 2) release();
        await bothListed;
      }
      return response;
    };
    const results = await Promise.all([syncBookmarksToCalendar({ ...args, fetchImpl }), syncBookmarksToCalendar({ ...args, fetchImpl })]);
    expect(results.every((result) => result.failed === 0)).toBe(true);
    expect(provider.live()).toHaveLength(2);
    const event = provider.live().find((item) => item.id !== 'personal');
    expect(event.id).toMatch(/^[0-9a-v]{5,1024}$/);
    expect(event.start).toEqual({ dateTime: '2026-10-15T14:05:00.000Z', timeZone: 'America/Chicago' });
    const removed = await syncBookmarksToCalendar({ ...args, sessions: [], fetchImpl: provider.fetchImpl });
    expect(removed).toMatchObject({ deleted: 1, failed: 0 });
    expect(provider.live()).toEqual([{ id: 'personal', summary: 'An attendee addition' }]);
    await Promise.all([syncBookmarksToCalendar({ ...args, fetchImpl: provider.fetchImpl }), syncBookmarksToCalendar({ ...args, fetchImpl: provider.fetchImpl })]);
    expect(provider.live()).toHaveLength(2);
    expect(provider.live().find((item) => item.id !== 'personal').id).not.toBe(event.id);
    expect(provider.calls.filter((call) => call.method === 'GET' && new URL(call.url).pathname.endsWith('/events'))
      .every((call) => new URL(call.url).searchParams.get('privateExtendedProperty') === 'eventrunner/owner=saved-session')).toBe(true);
  });

  it('migrates every legacy copy across pages before filtering, deduplicates, and retries all failed removals', async () => {
    const personal = { id: 'personal', summary: 'Keep me' };
    const provider = calendarProvider([personal, marked('old-a', 's1', false), marked('old-b', 's1', false), marked('old-c')], { pageSize: 1 });
    const migrated = await syncBookmarksToCalendar({ ...args, previous: { calendarId: 'c1' }, fetchImpl: provider.fetchImpl });
    expect(migrated).toMatchObject({ created: 0, updated: 1, deleted: 2, failed: 0, ownershipMigrated: true });
    expect(provider.live()).toHaveLength(2);
    expect(provider.events.get('old-a').summary).toBe(SESSION.title);
    expect(provider.calls.filter((call) => call.method === 'PATCH')).toHaveLength(2);
    expect(provider.calls.some((call) => new URL(call.url).searchParams.has('privateExtendedProperty'))).toBe(true);
    // Simulate old duplicates present again, so a failed delete cannot hide
    // another copy or report this calendar as up to date.
    provider.events.set('old-b', marked('old-b'));
    provider.failures.set('DELETE /calendar/v3/calendars/c1/events/old-a', 503);
    const failed = await syncBookmarksToCalendar({ ...args, sessions: [], previous: migrated, fetchImpl: provider.fetchImpl });
    expect(failed).toMatchObject({ deleted: 1, failed: 1 });
    expect(provider.live().map((event) => event.id).sort()).toEqual(['old-a', 'personal']);
    provider.failures.clear();
    expect(await syncBookmarksToCalendar({ ...args, sessions: [], previous: failed, fetchImpl: provider.fetchImpl }))
      .toMatchObject({ deleted: 1, failed: 0 });
    expect(provider.live()).toEqual([personal]);
  });

  it('stops a failed migration before replacements can hide old events', async () => {
    const provider = calendarProvider([marked('old', 's1', false)]);
    provider.failures.set('PATCH /calendar/v3/calendars/c1/events/old', 503);
    await expect(syncBookmarksToCalendar({ ...args, previous: { calendarId: 'c1' }, fetchImpl: provider.fetchImpl }))
      .rejects.toMatchObject({ status: 503 });
    expect(provider.calls.some((call) => call.method === 'POST')).toBe(false);
    provider.failures.clear();
    expect(await syncBookmarksToCalendar({ ...args, previous: { calendarId: 'c1' }, fetchImpl: provider.fetchImpl }))
      .toMatchObject({ created: 0, updated: 1, failed: 0 });
  });

  it('retains the recovered stable event when a legacy canonical copy disappears after listing', async () => {
    const provider = calendarProvider();
    await syncBookmarksToCalendar({ ...args, fetchImpl: provider.fetchImpl });
    const stable = provider.live()[0].id;
    provider.events.set('aaaaa', marked('aaaaa'));
    const fetchImpl = async (url, init) => {
      if (init.method === 'PUT' && url.endsWith('/aaaaa')) provider.events.delete('aaaaa');
      return provider.fetchImpl(url, init);
    };
    expect(await syncBookmarksToCalendar({ ...args, fetchImpl })).toMatchObject({ failed: 0 });
    expect(provider.live()).toHaveLength(1);
    expect(provider.live()[0]).toMatchObject({ id: stable, summary: SESSION.title });
  });

  it('recovers a deleted stable ID returned as HTTP 410 without touching a conflicting unowned event', async () => {
    const provider = calendarProvider([], { tombstoneStatus: 410 });
    await syncBookmarksToCalendar({ ...args, fetchImpl: provider.fetchImpl });
    const original = provider.live()[0];
    await syncBookmarksToCalendar({ ...args, sessions: [], fetchImpl: provider.fetchImpl });
    expect(await syncBookmarksToCalendar({ ...args, fetchImpl: provider.fetchImpl })).toMatchObject({ created: 1, failed: 0 });
    expect(provider.live()[0].id).not.toBe(original.id);
    const personal = { id: original.id, summary: 'Unmarked collision' };
    const conflict = calendarProvider([personal]);
    expect(await syncBookmarksToCalendar({ ...args, fetchImpl: conflict.fetchImpl })).toMatchObject({ failed: 1 });
    expect(conflict.live()).toEqual([personal]);
  });

  it.each([
    [403, { errors: [{ reason: 'accessNotConfigured' }] }, 'setup'],
    [403, { details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'SERVICE_DISABLED' }] }, 'setup'],
    [403, { errors: [{ reason: 'insufficientPermissions' }] }, 'scope'],
    [401, {}, 'expired'],
    [403, { errors: [{ reason: 'rateLimitExceeded' }] }, 'request'],
    [429, {}, 'request'], [503, {}, 'request'], [403, {}, 'request'],
  ])('classifies %i from safe structured reasons (%j)', async (status, error, kind) => {
    const fetchImpl = async () => calendarResponse(status, { error: { ...error, message: 'synthetic credential-bearing message' } });
    let caught;
    try { await syncBookmarksToCalendar({ ...args, fetchImpl }); } catch (value) { caught = value; }
    expect(caught).toMatchObject({ status, kind });
    expect(`${caught}\n${JSON.stringify(caught)}`).not.toContain('credential-bearing');
  });
});

it.each([
  ['auth/popup-closed-by-user', 'CalendarScopeRefusedError'],
  ['auth/operation-not-allowed', 'CalendarAccessError'],
  ['auth/network-request-failed', 'CalendarAccessError'],
])('keeps popup failure %s classified without retaining SDK details', async (code, name) => {
  authMocks.reauth.mockRejectedValueOnce({ code, message: 'synthetic private response' });
  await expect(requestCalendarAccess({ providerData: [{ providerId: 'google.com' }] })).rejects.toMatchObject({ name });
});
