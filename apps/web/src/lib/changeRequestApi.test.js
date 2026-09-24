// The public seam for submitChangeRequest (issue #188). No network: fetch is
// injected, and demo mode is a module constant, so the demo case loads the
// module again under a mocked demoMode.js.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./demoMode.js', () => ({ IS_DEMO: false, default: false }));

import { submitChangeRequest } from './changeRequestApi.js';

const ENV = { VITE_FUNCTIONS_ORIGIN: 'https://functions.example.test/' };
const PAYLOAD = { message: 'The travel page lists the wrong hotel.', page: '/travel', submissionKey: 'key0000000000001' };
const user = { getIdToken: vi.fn(async () => 'id-token-1') };

function respond(status, body) {
  return vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }));
}

afterEach(() => {
  vi.doUnmock('./demoMode.js');
});

describe('submitChangeRequest', () => {
  it('posts the payload with the bearer token to the endpoint', async () => {
    const fetchImpl = respond(201, { id: 'key0000000000001', ok: true });
    const result = await submitChangeRequest(PAYLOAD, { user, env: ENV, fetchImpl });

    expect(result).toEqual({ ok: true, id: 'key0000000000001' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://functions.example.test/submitChangeRequest');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer id-token-1');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual(PAYLOAD);
  });

  it('passes the server’s own words through on a refusal', async () => {
    const fetchImpl = respond(429, { error: { code: 'rate-limited', message: 'Too many change requests. Try again later.' } });
    expect(await submitChangeRequest(PAYLOAD, { user, env: ENV, fetchImpl })).toEqual({
      ok: false,
      error: 'Too many change requests. Try again later.',
    });
  });

  it('states a plain failure when the refusal has no readable body', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 502, json: async () => { throw new Error('html'); } }));
    expect(await submitChangeRequest(PAYLOAD, { user, env: ENV, fetchImpl })).toEqual({
      ok: false,
      error: 'Something went wrong. Try again.',
    });
  });

  it('turns a network failure into a message, never a throw', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    expect(await submitChangeRequest(PAYLOAD, { user, env: ENV, fetchImpl })).toEqual({
      ok: false,
      error: 'We could not reach the server. Check your connection and try again.',
    });
  });

  it('sends nothing without a signed-in user, or when the token cannot be read', async () => {
    const fetchImpl = respond(201, {});
    expect(await submitChangeRequest(PAYLOAD, { user: null, env: ENV, fetchImpl })).toEqual({
      ok: false,
      error: 'Sign in to send a change request.',
    });
    const expired = { getIdToken: vi.fn(async () => { throw new Error('token revoked'); }) };
    expect(await submitChangeRequest(PAYLOAD, { user: expired, env: ENV, fetchImpl })).toEqual({
      ok: false,
      error: 'Your session has expired. Sign in again.',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses in the read-only demo and sends nothing', async () => {
    vi.resetModules();
    vi.doMock('./demoMode.js', () => ({ IS_DEMO: true, default: true }));
    const { submitChangeRequest: demoSubmit } = await import('./changeRequestApi.js');
    const fetchImpl = respond(201, {});
    expect(await demoSubmit(PAYLOAD, { user, env: ENV, fetchImpl })).toEqual({
      ok: false,
      error: 'Change requests are off in this read-only demo.',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
