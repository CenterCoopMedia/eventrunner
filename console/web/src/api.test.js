import { afterEach, describe, expect, it, vi } from 'vitest';
import { auth } from './firebase.js';
import { ApiError, callApi } from './api.js';

afterEach(() => {
  vi.unstubAllGlobals();
  delete auth.currentUser;
});

describe('callApi', () => {
  it('posts JSON to /api/<name> with the ID token', async () => {
    auth.currentUser = { getIdToken: vi.fn(async () => 'id-token') };
    const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ organizations: [] }) }));
    vi.stubGlobal('fetch', fetch);
    await expect(callApi('listOrganizations', { a: 1 })).resolves.toEqual({ organizations: [] });
    expect(fetch).toHaveBeenCalledWith('/api/listOrganizations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer id-token' },
      body: JSON.stringify({ a: 1 }),
    });
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
