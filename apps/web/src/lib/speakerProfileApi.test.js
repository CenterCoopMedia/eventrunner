// The speaker self-service seam (issue #22): same wire shape as the admin
// API (POST + bearer token), but exercised against getOwnSpeakerProfile /
// updateOwnSpeakerProfile / speakerPhotoUpload — endpoints a non-admin
// speaker calls about their own record.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getOwnSpeakerProfile,
  updateOwnSpeakerProfile,
  uploadSpeakerPhoto,
} from './speakerProfileApi.js';

const user = { getIdToken: async () => 'id-token' };

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

beforeEach(() => {
  globalThis.fetch = vi.fn();
});

describe('getOwnSpeakerProfile', () => {
  it('POSTs speakerId with the bearer token and returns the speaker payload', async () => {
    fetch.mockResolvedValueOnce(response(200, { speaker: { speakerId: 'rae', bio: 'Hi.' } }));
    const speaker = await getOwnSpeakerProfile({ user, speakerId: 'rae' });
    expect(speaker).toEqual({ speakerId: 'rae', bio: 'Hi.' });
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toMatch(/\/getOwnSpeakerProfile$/);
    expect(init.headers.Authorization).toBe('Bearer id-token');
    expect(JSON.parse(init.body)).toEqual({ speakerId: 'rae' });
  });
});

describe('updateOwnSpeakerProfile', () => {
  it('sends the fields under a `speaker` key, matching the admin CRUD wire shape', async () => {
    fetch.mockResolvedValueOnce(response(200, { speakerId: 'rae', docPath: 'speakers/rae' }));
    await updateOwnSpeakerProfile({ user, speakerId: 'rae', fields: { bio: 'New bio.' } });
    const [, init] = fetch.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ speakerId: 'rae', speaker: { bio: 'New bio.' } });
  });

  it('surfaces a server rejection as a field error a form can point at', async () => {
    fetch.mockResolvedValueOnce(
      response(400, { error: { code: 'bad-request', message: 'slug: not editable here' } }),
    );
    await expect(
      updateOwnSpeakerProfile({ user, speakerId: 'rae', fields: { slug: 'nope' } }),
    ).rejects.toMatchObject({ name: 'AdminApiError', code: 'bad-request' });
  });
});

describe('uploadSpeakerPhoto', () => {
  it('base64-encodes the file and posts it with contentType and speakerId', async () => {
    fetch.mockResolvedValueOnce(response(200, { path: 'speaker-photos/rae/photo.png' }));
    const file = new File(['x'], 'me.png', { type: 'image/png' });
    const result = await uploadSpeakerPhoto({ user, speakerId: 'rae', file });
    expect(result).toEqual({ path: 'speaker-photos/rae/photo.png' });
    const [, init] = fetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.speakerId).toBe('rae');
    expect(body.contentType).toBe('image/png');
    expect(typeof body.data).toBe('string');
  });

  it('refuses a disallowed type before ever calling fetch', async () => {
    const file = new File(['x'], 'me.svg', { type: 'image/svg+xml' });
    await expect(uploadSpeakerPhoto({ user, speakerId: 'rae', file })).rejects.toThrow(/SVG|PNG|JPEG|WEBP/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses a file at or over the 2 MiB cap before calling fetch', async () => {
    const big = new File([''], 'big.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 2 * 1024 * 1024 });
    await expect(uploadSpeakerPhoto({ user, speakerId: 'rae', file: big })).rejects.toThrow(/limit/);
    expect(fetch).not.toHaveBeenCalled();
  });
});
