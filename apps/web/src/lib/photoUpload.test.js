import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auth } from '../firebase.js';
import { uploadProfilePhoto } from './photoUpload.js';

const request = vi.fn();

beforeEach(() => {
  auth.currentUser = { uid: 'owner', getIdToken: vi.fn(async () => 'test-id-token') };
  request.mockReset().mockResolvedValue({
    ok: true,
    json: async () => ({ path: 'profile-photos/owner/server-id/photo.webp', expiresAtMs: 20_000 }),
  });
  vi.stubGlobal('fetch', request);
  vi.stubEnv('VITE_FUNCTIONS_ORIGIN', 'https://functions.example.test');
});

afterEach(() => {
  delete auth.currentUser;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('profile photo upload', () => {
  it('posts bytes to the bounded endpoint with the current auth token', async () => {
    const file = new File(['photo'], 'a.png', { type: 'image/png' });
    expect(await uploadProfilePhoto({ uid: 'owner', file })).toEqual({ path: 'profile-photos/owner/server-id/photo.webp', expiresAtMs: 20_000 });
    expect(request).toHaveBeenCalledWith('https://functions.example.test/profilePhotoUpload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-id-token' },
      body: JSON.stringify({ contentType: 'image/png', data: 'cGhvdG8=' }),
    });
  });
  it('refuses a signed-out or mismatched account before sending bytes', async () => {
    const file = new File(['photo'], 'a.png', { type: 'image/png' });
    await expect(uploadProfilePhoto({ uid: 'other', file })).rejects.toThrow('Sign in again');
    auth.currentUser = null;
    await expect(uploadProfilePhoto({ uid: 'owner', file })).rejects.toThrow('Sign in again');
    expect(request).not.toHaveBeenCalled();
  });
  it('surfaces quota and network errors to the existing save flow', async () => {
    const file = new File(['photo'], 'a.png', { type: 'image/png' });
    request.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ error: { code: 'photo-quota', message: 'Photo storage is full.' } }),
    });
    await expect(uploadProfilePhoto({ uid: 'owner', file })).rejects.toThrow('Photo storage is full.');
    request.mockRejectedValueOnce(new Error('network'));
    await expect(uploadProfilePhoto({ uid: 'owner', file })).rejects.toThrow('We could not reach the server.');
  });
});
