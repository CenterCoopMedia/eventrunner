// The admin endpoint seam: what it sends, and what it preserves from a
// failure. The message-splitting is exercised through the forms; this pins
// the parts a UI test cannot see.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminApiError, callAdminEndpoint, fieldErrorsOf } from './adminApi.js';

const getIdToken = async () => 'id-token';

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

beforeEach(() => {
  globalThis.fetch = vi.fn();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('callAdminEndpoint', () => {
  it('sends the ID token as a bearer credential', async () => {
    fetch.mockResolvedValueOnce(response(200, { ok: true }));
    await callAdminEndpoint('cmsSavePage', { page: {} }, getIdToken);
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer id-token');
    expect(fetch.mock.calls[0][1].method).toBe('POST');
  });

  it('preserves a part-way publish’s queueId on the error', async () => {
    // functions/src/cms/publish.cjs answers a mid-publish failure with the
    // error body PLUS a top-level queueId; resuming with { queueId } is what
    // stops committed chunks from being published a second time.
    fetch.mockResolvedValueOnce(
      response(500, {
        error: { code: 'publish-failed', message: 'Publish failed part-way. Re-run with { queueId } to resume.' },
        queueId: 'queue-42',
      }),
    );
    await expect(
      callAdminEndpoint('cmsPublish', { collection: 'cmsPages', docIds: ['a'] }, getIdToken),
    ).rejects.toMatchObject({
      name: 'AdminApiError',
      code: 'publish-failed',
      queueId: 'queue-42',
    });
  });

  it('leaves queueId null for failures that carry none', async () => {
    fetch.mockResolvedValueOnce(response(400, { error: { code: 'bad-request', message: 'nope' } }));
    await expect(callAdminEndpoint('cmsPublish', {}, getIdToken)).rejects.toMatchObject({
      queueId: null,
    });
  });

  it('reports an unreachable server without inventing a server message', async () => {
    fetch.mockRejectedValueOnce(new Error('offline'));
    await expect(callAdminEndpoint('cmsSavePage', {}, getIdToken)).rejects.toMatchObject({
      code: 'network',
      status: 0,
    });
  });
});

describe('fieldErrorsOf', () => {
  it('splits the server’s joined message into per-field segments', () => {
    expect(
      fieldErrorsOf("Invalid page: path: must start with '/'; label: must be a non-empty string"),
    ).toEqual([
      { field: 'path', message: "path: must start with '/'" },
      { field: 'label', message: 'label: must be a non-empty string' },
    ]);
  });

  it('keeps a segment that names no field rather than dropping it', () => {
    expect(fieldErrorsOf('Admin access required.')).toEqual([
      { field: null, message: 'Admin access required.' },
    ]);
  });

  it('is attached to every AdminApiError', () => {
    const error = new AdminApiError({ code: 'bad-request', status: 400, message: 'id: nope' });
    expect(error.fieldErrors).toEqual([{ field: 'id', message: 'id: nope' }]);
  });
});
