import { afterEach, describe, expect, it, vi } from 'vitest';
import { FEEDBACK_REQUEST_TIMEOUT_MS, submitFeedback } from './feedbackApi.js';

const env = { VITE_FUNCTIONS_ORIGIN: 'https://functions.example.org' };
const payload = {
  message: 'Please check the schedule link.',
  category: 'bug',
  honeypot: '',
  startedAt: 1000,
  submissionKey: 'feedback-retry-key',
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('submitFeedback', () => {
  it('preserves the endpoint, JSON payload and receipt response', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'feedback-1' }),
    });
    await expect(submitFeedback(payload, { env, fetchImpl })).resolves.toEqual({ ok: true, id: 'feedback-1' });

    expect(fetchImpl).toHaveBeenCalledWith('https://functions.example.org/submitFeedback', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: expect.any(AbortSignal),
    }));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retains a server refusal and clears the request deadline', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'Please wait before sending more feedback.' } }),
    });
    await expect(submitFeedback(payload, { env, fetchImpl })).resolves.toEqual({
      ok: false,
      error: 'Please wait before sending more feedback.',
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('describes a network failure as an unconfirmed receipt', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const result = await submitFeedback(payload, { env, fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('could not confirm your feedback was received');
    expect(result.error).toContain('Your message is still here.');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds a stalled fetch even when the transport ignores its abort signal', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(() => new Promise(() => {}));
    const result = submitFeedback(payload, { env, fetchImpl });
    const signal = fetchImpl.mock.calls[0][1].signal;

    await vi.advanceTimersByTimeAsync(FEEDBACK_REQUEST_TIMEOUT_MS - 1);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal.aborted).toBe(true);
    await expect(result).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('could not confirm your feedback was received'),
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds response parsing and ignores a late receipt after the deadline', async () => {
    vi.useFakeTimers();
    let resolveBody;
    const json = vi.fn(() => new Promise((resolve) => { resolveBody = resolve; }));
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json });
    const result = submitFeedback(payload, { env, fetchImpl });

    await vi.advanceTimersByTimeAsync(FEEDBACK_REQUEST_TIMEOUT_MS);
    const timedOut = await result;
    expect(json).toHaveBeenCalledTimes(1);
    expect(timedOut.ok).toBe(false);
    expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);
    resolveBody({ id: 'late-receipt' });
    await expect(result).resolves.toEqual(timedOut);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the same payload key when a timed-out request is retried', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn()
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'feedback-1' }) });
    const first = submitFeedback(payload, { env, fetchImpl });
    await vi.advanceTimersByTimeAsync(FEEDBACK_REQUEST_TIMEOUT_MS);
    expect((await first).ok).toBe(false);

    await expect(submitFeedback(payload, { env, fetchImpl })).resolves.toEqual({ ok: true, id: 'feedback-1' });
    const bodies = fetchImpl.mock.calls.map(([, options]) => JSON.parse(options.body));
    expect(bodies).toEqual([payload, payload]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts on caller cleanup and clears the deadline without depending on transport cancellation', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetchImpl = vi.fn(() => new Promise(() => {}));
    const result = submitFeedback(payload, { env, fetchImpl, signal: controller.signal });
    controller.abort();

    await expect(result).resolves.toMatchObject({ ok: false });
    expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('still enforces the deadline when AbortController is unavailable', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('AbortController', undefined);
    const fetchImpl = vi.fn(() => new Promise(() => {}));
    const result = submitFeedback(payload, { env, fetchImpl });

    await vi.advanceTimersByTimeAsync(FEEDBACK_REQUEST_TIMEOUT_MS);
    await expect(result).resolves.toMatchObject({ ok: false });
    expect(fetchImpl.mock.calls[0][1]).not.toHaveProperty('signal');
    expect(vi.getTimerCount()).toBe(0);
  });
});
