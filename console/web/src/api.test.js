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
  });

  it('gives a plain message when the network or the body fails', async () => {
    auth.currentUser = { getIdToken: async () => 't' };
    vi.stubGlobal('fetch', async () => { throw new TypeError('Failed to fetch'); });
    await expect(callApi('getTeam', {})).rejects.toThrow('We could not reach the server. Check your connection and try again.');
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 500, json: async () => { throw new SyntaxError('bad'); } }));
    await expect(callApi('getTeam', {})).rejects.toThrow('Something went wrong. Try again.');
  });

  it('refuses to call when nobody is signed in', async () => {
    await expect(callApi('getTeam', {})).rejects.toMatchObject({ status: 401 });
  });
});
