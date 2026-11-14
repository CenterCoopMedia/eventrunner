import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSpeakerDiscussionPoints, saveSpeakerDiscussionPoints } from './speakerDiscussionApi.js';

const user = { getIdToken: async () => 'synthetic-speaker-token' };
const request = { speakerId: 'speaker-own', text: 'Opening question.', expectedRevision: 0, requestId: 'request_12345678' };
const submission = {
  text: request.text, revision: 1, requestId: request.requestId,
  submittedAt: '2026-11-13T15:00:00.000Z', notification: { state: 'accepted' },
};
const response = (body) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => { globalThis.fetch = vi.fn(); });

describe('speaker discussion HTTP contract', () => {
  it('accepts only an explicit null as an empty submission and sends bearer-authenticated speaker identity', async () => {
    fetch.mockResolvedValue(response({ submission: null }));
    await expect(getSpeakerDiscussionPoints({ user, speakerId: request.speakerId })).resolves.toBeNull();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toMatch(/\/getSpeakerDiscussionPoints$/);
    expect(init.headers.Authorization).toBe('Bearer synthetic-speaker-token');
    expect(JSON.parse(init.body)).toEqual({ speakerId: request.speakerId });
  });

  it.each(['accepted', 'omitted', 'failed', 'unknown'])('returns a saved %s result, including an exact replay', async (state) => {
    const saved = { ...submission, notification: { state } };
    fetch.mockResolvedValue(response({ submission: saved, replay: true }));
    await expect(saveSpeakerDiscussionPoints({ user, ...request })).resolves.toEqual(saved);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toMatch(/\/saveSpeakerDiscussionPoints$/);
    expect(JSON.parse(init.body)).toEqual(request);
  });

  it.each([
    {}, { submission: undefined }, { submission: { ...submission, revision: '1' } },
    { submission: { ...submission, revision: 0 } },
    { submission: { ...submission, text: '  unnormalized  ' } },
    { submission: { ...submission, requestId: 'short' } },
    { submission: { ...submission, submittedAt: 'invalid date' } },
    { submission: { ...submission, notification: { state: 'delivered' } } },
  ])('refuses malformed successful reads', async (body) => {
    fetch.mockResolvedValue(response(body));
    await expect(getSpeakerDiscussionPoints({ user, speakerId: request.speakerId }))
      .rejects.toMatchObject({ code: 'unresolved-response', status: 0 });
  });

  it('refuses non-JSON success and a null or mismatched successful save', async () => {
    fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new SyntaxError(); } });
    await expect(getSpeakerDiscussionPoints({ user, speakerId: request.speakerId })).rejects.toMatchObject({ code: 'unresolved-response' });
    for (const body of [
      { submission: null },
      { submission: { ...submission, text: 'Different text.' } },
      { submission: { ...submission, revision: 2 } },
      { submission: { ...submission, requestId: 'request_abcdefgh' } },
    ]) {
      fetch.mockResolvedValueOnce(response(body));
      await expect(saveSpeakerDiscussionPoints({ user, ...request })).rejects.toMatchObject({ code: 'unresolved-response' });
    }
  });

  it.each([400, 401, 403, 409, 500])('preserves HTTP %s for form recovery decisions', async (status) => {
    fetch.mockResolvedValue({ ok: false, status, json: async () => ({ error: { code: 'refused', message: 'Request refused.' } }) });
    await expect(saveSpeakerDiscussionPoints({ user, ...request })).rejects.toMatchObject({ status, code: 'refused' });
  });
});
