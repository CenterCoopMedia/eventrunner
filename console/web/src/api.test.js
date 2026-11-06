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

  it('keeps server diagnostics out of page errors', async () => {
    auth.currentUser = { getIdToken: async () => 't' };
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 500,
      json: async () => ({ error: { code: 'internal', message: 'getTeam failed at organizations/o1' } }),
    }));
    await expect(callApi('getTeam')).rejects.toThrow('We could not complete this action. Try again.');
  });
});
