// lib/calendarSync.js — the optional Google Calendar sync (issue #177).
// fetch is stubbed; every test reads the requests the sync makes and the
// summary it returns.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { syncBookmarksToCalendar, calendarEventBody } = await import('./calendarSync.js');

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

function fakeFetch() {
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

beforeEach(() => {});
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
    const { fetchImpl, calls } = fakeFetch();
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
    const { fetchImpl, calls } = fakeFetch();
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
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) }));
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
