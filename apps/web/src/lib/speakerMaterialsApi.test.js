import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_SPEAKER_MATERIAL_FILE_BYTES,
  addSpeakerMaterialLink,
  listSpeakerSessionMaterials,
  updateSpeakerMaterial,
  uploadSpeakerMaterialFile,
} from './speakerMaterialsApi.js';

const user = { getIdToken: async () => 'speaker-token' };

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

beforeEach(() => {
  globalThis.fetch = vi.fn();
});

describe('speaker materials API', () => {
  it('lists and adds links through authenticated session-material endpoints', async () => {
    fetch
      .mockResolvedValueOnce(response(200, { materials: [{ id: 'm1', reviewStatus: 'pending' }] }))
      .mockResolvedValueOnce(response(200, { id: 'm2' }));

    await expect(listSpeakerSessionMaterials({ user, sessionId: 's1' })).resolves.toEqual([
      { id: 'm1', reviewStatus: 'pending' },
    ]);
    await addSpeakerMaterialLink({
      user,
      sessionId: 's1',
      url: 'https://example.org/deck',
      label: 'Deck',
    });

    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ sessionId: 's1' });
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
      sessionId: 's1',
      url: 'https://example.org/deck',
      label: 'Deck',
    });
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer speaker-token');
  });

  it('uploads a synthetic file as bytes without accepting a browser storage path', async () => {
    fetch.mockResolvedValueOnce(response(200, { id: 'm-file' }));
    const file = new File(['synthetic handout'], 'handout.txt', { type: 'text/plain' });
    await uploadSpeakerMaterialFile({ user, sessionId: 's1', file });

    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body).toMatchObject({
      sessionId: 's1',
      filename: 'handout.txt',
      contentType: 'text/plain',
    });
    expect(body.data).toBe(btoa('synthetic handout'));
    expect(body).not.toHaveProperty('storagePath');
  });

  it('refuses an oversized file before the request', async () => {
    const file = new File(['x'], 'large.bin', { type: 'application/octet-stream' });
    Object.defineProperty(file, 'size', { value: MAX_SPEAKER_MATERIAL_FILE_BYTES + 1 });
    await expect(uploadSpeakerMaterialFile({ user, sessionId: 's1', file })).rejects.toThrow(/limit/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('surfaces a foreign-session refusal from the server', async () => {
    fetch.mockResolvedValueOnce(
      response(403, { error: { code: 'forbidden', message: 'You do not have permission to change this material.' } }),
    );
    await expect(
      addSpeakerMaterialLink({ user, sessionId: 'foreign', url: 'https://example.org', label: 'Deck' }),
    ).rejects.toMatchObject({ name: 'AdminApiError', code: 'forbidden', status: 403 });
  });

  it('surfaces the reviewed-item lock from the update endpoint', async () => {
    fetch.mockResolvedValueOnce(
      response(403, { error: { code: 'forbidden', message: 'This material has already been reviewed; ask an admin to change it.' } }),
    );
    await expect(
      updateSpeakerMaterial({ user, materialId: 'm1', filename: 'New deck', url: 'https://example.org/new' }),
    ).rejects.toThrow(/already been reviewed/i);
  });
});
