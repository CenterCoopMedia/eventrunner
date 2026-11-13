import { afterEach, describe, expect, it, vi } from 'vitest';
import { auth } from './firebase.js';
import { ApiError, callApi } from './api.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete auth.currentUser;
});

describe('callApi', () => {
  it.each([['small', 10, true], ['oversized', 30000, false]])('uses keepalive only when the %s UTF-8 body fits the browser budget', async (_size, length, keepalive) => {
    auth.currentUser = { getIdToken: async () => 't' };
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ saved: true }) }));
    vi.stubGlobal('fetch', fetch);
    const body = { answers: { name: '界'.repeat(length) } };
    await callApi('saveApplicationStep', body, { keepalive: true });
    const options = fetch.mock.calls[0][1];
    expect(options.keepalive === true).toBe(keepalive);
    expect(options.body).toBe(JSON.stringify(body));
    expect(new TextEncoder().encode(options.body).byteLength <= 65536).toBe(keepalive);
  });

  it('posts JSON to /api/<name> with the ID token', async () => {
    auth.currentUser = { getIdToken: vi.fn(async () => 'id-token') };
    const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ organizations: [] }) }));
    vi.stubGlobal('fetch', fetch);
    await expect(callApi('listOrganizations', { a: 1 })).resolves.toEqual({ organizations: [] });
    expect(fetch).toHaveBeenCalledWith('/api/listOrganizations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer id-token' },
      body: JSON.stringify({ a: 1 }),
      signal: expect.any(AbortSignal),
    });
  });

  it.each([['getTeam', 20000], ['listOrganizations', 0], ['checkWebAddress', 0]])('ends an unanswered %s read at 30 seconds including %sms of token lookup', async (name, tokenDelay) => {
    vi.useFakeTimers();
    auth.currentUser = { getIdToken: () => new Promise((resolve) => setTimeout(() => resolve('t'), tokenDelay)) };
    const fetch = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetch);
    let outcome;
    callApi(name).then((value) => { outcome = { value }; }, (error) => { outcome = { error }; });
    await vi.advanceTimersByTimeAsync(29999);
    expect(outcome).toBeUndefined();
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toMatchObject({ error: { status: 0, code: 'timeout', message: 'We could not finish loading. Try again.' } });
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds token lookup and never sends a read after its token arrives too late', async () => {
    vi.useFakeTimers();
    let token;
    auth.currentUser = { getIdToken: () => new Promise((resolve) => { token = resolve; }) };
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    let outcome;
    callApi('getTeam').catch((error) => { outcome = error; });
    await vi.advanceTimersByTimeAsync(30000);
    expect(outcome).toMatchObject({ status: 0, code: 'timeout' });
    expect(fetch).not.toHaveBeenCalled();
    token('late-token');
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds body reading, permits a fresh read and ignores the abandoned response', async () => {
    vi.useFakeTimers();
    auth.currentUser = { getIdToken: async () => 't' };
    let oldBody;
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => new Promise((resolve) => { oldBody = resolve; }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ team: 'fresh' }) });
    vi.stubGlobal('fetch', fetch);
    let first;
    callApi('getTeam').then((value) => { first = { value }; }, (error) => { first = { error }; });
    await vi.advanceTimersByTimeAsync(30000);
    expect(first).toMatchObject({ error: { status: 0, code: 'timeout' } });
    await expect(callApi('getTeam')).resolves.toEqual({ team: 'fresh' });
    oldBody({ team: 'obsolete' });
    await vi.advanceTimersByTimeAsync(0);
    expect(first).toMatchObject({ error: { code: 'timeout' } });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['saveApplicationStep', 'acceptAgreement', 'completeConnection', 'getUnknownAction'])('leaves %s untimed and sends no repeat while its result is unknown', async (name) => {
    vi.useFakeTimers();
    auth.currentUser = { getIdToken: async () => 't' };
    let finish;
    const fetch = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    vi.stubGlobal('fetch', fetch);
    let outcome;
    const request = callApi(name).then((value) => { outcome = value; });
    await vi.advanceTimersByTimeAsync(60000);
    expect(outcome).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]).not.toHaveProperty('signal');
    expect(vi.getTimerCount()).toBe(0);
    finish({ ok: true, json: async () => ({ saved: true }) });
    await request;
    expect(outcome).toEqual({ saved: true });
  });

  it.each(['success', 'failure'])('clears a read deadline after an early %s', async (outcome) => {
    vi.useFakeTimers();
    auth.currentUser = { getIdToken: async () => 't' };
    const fetch = vi.fn(async () => {
      if (outcome === 'failure') throw new TypeError('Network offline');
      return { ok: true, json: async () => ({ team: 'ready' }) };
    });
    vi.stubGlobal('fetch', fetch);
    if (outcome === 'success') await expect(callApi('getTeam')).resolves.toEqual({ team: 'ready' });
    else await expect(callApi('getTeam')).rejects.toMatchObject({ status: 0, code: 'network' });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(30000);
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);
  });

  it('throws an ApiError with the server message and code', async () => {
    auth.currentUser = { getIdToken: async () => 't' };
    vi.stubGlobal('fetch', async () => ({
      ok: false,
      status: 409,
      json: async () => ({ error: { code: 'last-owner', message: 'An organization needs at least one Owner.' } }),
    }));
    const error = await callApi('removeMember', {}).catch((err) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('last-owner');
    expect(error.status).toBe(409);
    expect(error.message).toBe('An organization needs at least one Owner.');
    expect(error.field).toBe(null);
  });

  it.each([
    ['reportProblem', 503, 'unavailable', 'Reports are not switched on yet. Email us instead.'],
    ['startConnection', 503, 'not-available', 'Connecting a Stripe account is not available yet.'],
    ['listEventbriteEvents', 502, 'events-failed', 'We could not read your Eventbrite events. Try again, or connect your account again.'],
    ['createSignupLink', 502, 'not-configured', 'The console address is not set, so a link cannot be made.'],
    ['inviteMember', 502, 'mail-failed', 'We could not send the invite email. Try again.'],
    ['inviteMember', 500, 'mail-failed', 'We could not send the invite email. Try again.'],
  ])('keeps the curated %s message at status %i', async (name, status, code, message) => {
    auth.currentUser = { getIdToken: async () => 't' };
    vi.stubGlobal('fetch', async () => ({
      ok: false, status, json: async () => ({ error: { code, message } }),
    }));
    await expect(callApi(name)).rejects.toMatchObject({ status, code, message });
  });

  it('keeps the field the server names, so a page can focus it', async () => {
    auth.currentUser = { getIdToken: async () => 't' };
    vi.stubGlobal('fetch', async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { code: 'invalid-setting', message: 'Enter a region.', field: 'region' } }),
    }));
    const error = await callApi('saveConsoleSettings', {}).catch((err) => err);
    expect(error.field).toBe('region');
  });

  it('keeps the field errors of a refusal', async () => {
    auth.currentUser = { getIdToken: async () => 't' };
    vi.stubGlobal('fetch', async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { code: 'incomplete', message: 'Some answers need attention.', fields: { 'event.name': 'Enter the event name.' } } }),
    }));
    const error = await callApi('acceptAgreement', {}).catch((err) => err);
    expect(error.fields).toEqual({ 'event.name': 'Enter the event name.' });
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 409, json: async () => ({ error: { code: 'x', message: 'No.' } }) }));
    expect((await callApi('acceptAgreement', {}).catch((err) => err)).fields).toEqual({});
  });

  it('gives a plain message when the network or the body fails', async () => {
    auth.currentUser = { getIdToken: async () => 't' };
    vi.stubGlobal('fetch', async () => { throw new TypeError('Failed to fetch'); });
    await expect(callApi('getTeam', {})).rejects.toThrow('We could not reach the server. Check your connection and try again.');
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 500, json: async () => { throw new SyntaxError('bad'); } }));
    await expect(callApi('getTeam', {})).rejects.toThrow('We could not complete this action. Try again.');
  });

  it('refuses to call when nobody is signed in', async () => {
    await expect(callApi('getTeam', {})).rejects.toMatchObject({ status: 401 });
  });

  it('keeps sign-in diagnostics out of page errors and never sends an unconfirmed request', async () => {
    auth.currentUser = { getIdToken: vi.fn().mockRejectedValue(new Error('Firebase: auth/user-token-expired')) };
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(callApi('getTeam')).rejects.toMatchObject({
      status: 401, message: 'We could not confirm your sign-in. Sign out, then sign in again.',
    });
    auth.currentUser.getIdToken.mockRejectedValue({ code: 'auth/network-request-failed' });
    await expect(callApi('getTeam')).rejects.toMatchObject({
      status: 0, message: 'We could not reach the server. Check your connection and try again.',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [500, 'internal', 'getTeam failed at organizations/o1'],
    [500, undefined, 'getTeam failed at organizations/o1'],
    [500, 'unavailable', undefined],
    [502, 'unavailable', ''],
    [503, 'unavailable', '   '],
  ])('uses a safe fallback for status %i without a curated message (%s, %s)', async (status, code, message) => {
    auth.currentUser = { getIdToken: async () => 't' };
    vi.stubGlobal('fetch', async () => ({ ok: false, status,
      json: async () => ({ error: { code, message } }),
    }));
    await expect(callApi('getTeam')).rejects.toThrow('We could not complete this action. Try again.');
  });
});
