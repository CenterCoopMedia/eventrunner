import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEDUPE_WINDOW_MS,
  MAX_REPORTS_PER_SESSION,
  initErrorReporting,
  isBenignClientError,
  isClientErrorReportingEnabled,
  reportClientError,
  reportFromRejectionEvent,
  reportFromWindowErrorEvent,
  resetErrorReportingInstalledForTest,
  resetErrorReportingStateForTest,
  resolveFunctionsOrigin,
} from './errorReporting.js';

beforeEach(() => {
  resetErrorReportingStateForTest();
  resetErrorReportingInstalledForTest();
});

// --- benign filter ---------------------------------------------------------------

describe('isBenignClientError', () => {
  it('flags a SafeLinks url', () => {
    expect(
      isBenignClientError({ url: 'https://eur03.safelinks.protection.outlook.com/?url=x' }),
    ).toBe(true);
  });

  it('flags a stale-bundle chunk-load error', () => {
    expect(isBenignClientError({ message: 'ChunkLoadError: Loading chunk 7 failed.' })).toBe(true);
  });

  it('flags a browser-extension stack frame', () => {
    expect(
      isBenignClientError({ stack: 'at inject (chrome-extension://abc/content.js:1:1)' }),
    ).toBe(true);
  });

  it('does not flag an ordinary application error', () => {
    expect(
      isBenignClientError({ message: "Cannot read properties of undefined (reading 'x')" }),
    ).toBe(false);
  });

  it('handles empty input without throwing', () => {
    expect(isBenignClientError()).toBe(false);
    expect(isBenignClientError({})).toBe(false);
  });
});

// --- resolveFunctionsOrigin / isClientErrorReportingEnabled --------------------------

describe('resolveFunctionsOrigin', () => {
  it('prefers VITE_FUNCTIONS_ORIGIN and strips a trailing slash', () => {
    expect(resolveFunctionsOrigin({ VITE_FUNCTIONS_ORIGIN: 'http://127.0.0.1:5001/proj/us-central1/' }))
      .toBe('http://127.0.0.1:5001/proj/us-central1');
  });

  it('builds a cloudfunctions.net origin from project + region', () => {
    expect(resolveFunctionsOrigin({ VITE_FIREBASE_PROJECT_ID: 'proj-1', VITE_FIREBASE_REGION: 'us-east1' }))
      .toBe('https://us-east1-proj-1.cloudfunctions.net');
  });

  it('defaults the region to us-central1', () => {
    expect(resolveFunctionsOrigin({ VITE_FIREBASE_PROJECT_ID: 'proj-1' }))
      .toBe('https://us-central1-proj-1.cloudfunctions.net');
  });

  it('returns null (never throws) with no project id and no override', () => {
    expect(resolveFunctionsOrigin({})).toBeNull();
  });
});

describe('isClientErrorReportingEnabled', () => {
  it('is on in a production build by default', () => {
    expect(isClientErrorReportingEnabled({ PROD: true })).toBe(true);
  });

  it('is off in dev by default (including the emulator)', () => {
    expect(isClientErrorReportingEnabled({ PROD: false, DEV: true })).toBe(false);
  });

  it('an explicit "true" enables it even in dev', () => {
    expect(isClientErrorReportingEnabled({ PROD: false, VITE_ENABLE_CLIENT_ERROR_REPORTING: 'true' })).toBe(true);
  });

  it('an explicit "false" disables it even in production', () => {
    expect(isClientErrorReportingEnabled({ PROD: true, VITE_ENABLE_CLIENT_ERROR_REPORTING: 'false' })).toBe(false);
  });
});

// --- reportClientError -------------------------------------------------------------

const ENV = { PROD: true, VITE_FIREBASE_PROJECT_ID: 'proj-1', VITE_FIREBASE_REGION: 'us-central1' };

function fakeFetch(impl) {
  const calls = [];
  const fn = vi.fn(async (url, init) => {
    calls.push({ url, init });
    return impl ? impl(url, init) : { ok: true, status: 200 };
  });
  fn.calls = calls;
  return fn;
}

describe('reportClientError', () => {
  it('POSTs to <origin>/logClientError with the report as JSON', async () => {
    const fetchImpl = fakeFetch();
    await reportClientError(
      { message: 'boom', stack: 'at x', url: 'https://example.org', userAgent: 'UA', context: { a: 1 } },
      { env: ENV, fetchImpl, now: () => 1000 },
    );
    expect(fetchImpl.calls).toHaveLength(1);
    expect(fetchImpl.calls[0].url).toBe('https://us-central1-proj-1.cloudfunctions.net/logClientError');
    expect(fetchImpl.calls[0].init.method).toBe('POST');
    expect(fetchImpl.calls[0].init.keepalive).toBe(true);
    expect(JSON.parse(fetchImpl.calls[0].init.body)).toEqual({
      message: 'boom', stack: 'at x', url: 'https://example.org', userAgent: 'UA', context: { a: 1 },
    });
  });

  it('does not send a benign (SafeLinks) report', async () => {
    const fetchImpl = fakeFetch();
    await reportClientError(
      { message: 'Failed to fetch', url: 'https://x.safelinks.protection.outlook.com/y' },
      { env: ENV, fetchImpl },
    );
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('does not send when message is missing', async () => {
    const fetchImpl = fakeFetch();
    await reportClientError({ url: 'https://example.org' }, { env: ENV, fetchImpl });
    await reportClientError(null, { env: ENV, fetchImpl });
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('does not send when the functions origin cannot be resolved', async () => {
    const fetchImpl = fakeFetch();
    await reportClientError({ message: 'boom' }, { env: {}, fetchImpl });
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('swallows a fetch rejection instead of throwing', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('network down'); });
    await expect(
      reportClientError({ message: 'boom' }, { env: ENV, fetchImpl }),
    ).resolves.toBeUndefined();
  });

  it('dedupes the same message+url within the dedupe window', async () => {
    const fetchImpl = fakeFetch();
    let nowMs = 0;
    const deps = { env: ENV, fetchImpl, now: () => nowMs };
    await reportClientError({ message: 'boom', url: 'https://x/1' }, deps);
    nowMs += DEDUPE_WINDOW_MS - 1;
    await reportClientError({ message: 'boom', url: 'https://x/1' }, deps);
    expect(fetchImpl.calls).toHaveLength(1);

    nowMs += 2;
    await reportClientError({ message: 'boom', url: 'https://x/1' }, deps);
    expect(fetchImpl.calls).toHaveLength(2);
  });

  it('a different url is not deduped against the first', async () => {
    const fetchImpl = fakeFetch();
    const deps = { env: ENV, fetchImpl, now: () => 0 };
    await reportClientError({ message: 'boom', url: 'https://x/1' }, deps);
    await reportClientError({ message: 'boom', url: 'https://x/2' }, deps);
    expect(fetchImpl.calls).toHaveLength(2);
  });

  it('bounds the number of reports sent per session', async () => {
    const fetchImpl = fakeFetch();
    let nowMs = 0;
    for (let i = 0; i < MAX_REPORTS_PER_SESSION + 5; i += 1) {
       
      await reportClientError({ message: `err ${i}` }, { env: ENV, fetchImpl, now: () => nowMs });
      nowMs += DEDUPE_WINDOW_MS + 1; // distinct keys, past the dedupe window every time
    }
    expect(fetchImpl.calls).toHaveLength(MAX_REPORTS_PER_SESSION);
  });
});

// --- window/rejection event adapters ------------------------------------------------
//
// Both adapters funnel into reportClientError, whose own send/filter/throttle
// behavior is covered above — these tests only need to confirm the report
// SHAPE built from each browser event, so they stub global fetch and inspect
// what was sent.

describe('reportFromWindowErrorEvent', () => {
  it('builds a report from the thrown Error, falling back to event.message', async () => {
    const fetchImpl = fakeFetch();
    await reportFromWindowErrorEvent(
      { error: new Error('kaboom'), message: 'kaboom (ignored, error.message wins)', filename: 'app.js', lineno: 10, colno: 2 },
      { env: ENV, fetchImpl },
    );
    expect(fetchImpl.calls).toHaveLength(1);
    const sent = JSON.parse(fetchImpl.calls[0].init.body);
    expect(sent.message).toBe('kaboom');
    expect(sent.stack).toContain('Error: kaboom');
    expect(sent.context).toEqual({ source: 'window-error', filename: 'app.js', lineno: 10, colno: 2 });
  });

  it('falls back to event.message when there is no error object (e.g. a script error)', async () => {
    const fetchImpl = fakeFetch();
    await reportFromWindowErrorEvent({ message: 'Script error.' }, { env: ENV, fetchImpl });
    const sent = JSON.parse(fetchImpl.calls[0].init.body);
    expect(sent.message).toBe('Script error.');
    expect(sent.stack).toBeNull();
  });
});

describe('reportFromRejectionEvent', () => {
  it('builds a report from an Error rejection reason', async () => {
    const fetchImpl = fakeFetch();
    await reportFromRejectionEvent({ reason: new Error('rejected') }, { env: ENV, fetchImpl });
    const sent = JSON.parse(fetchImpl.calls[0].init.body);
    expect(sent.message).toBe('rejected');
    expect(sent.stack).toContain('Error: rejected');
    expect(sent.context).toEqual({ source: 'unhandled-rejection' });
  });

  it('falls back to a string reason, and a generic message for anything else', async () => {
    const fetchImpl = fakeFetch();
    await reportFromRejectionEvent({ reason: 'plain string reason' }, { env: ENV, fetchImpl });
    expect(JSON.parse(fetchImpl.calls[0].init.body).message).toBe('plain string reason');

    resetErrorReportingStateForTest();
    await reportFromRejectionEvent({ reason: { code: 42 } }, { env: ENV, fetchImpl });
    expect(JSON.parse(fetchImpl.calls[1].init.body).message).toBe('Unhandled promise rejection');
  });
});

// --- initErrorReporting -------------------------------------------------------------

describe('initErrorReporting', () => {
  it('does not attach listeners when reporting is disabled', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const teardown = initErrorReporting({ env: { PROD: false } });
    expect(addSpy).not.toHaveBeenCalledWith('error', expect.anything());
    teardown();
    addSpy.mockRestore();
  });

  it('attaches window error + unhandledrejection listeners when enabled, and teardown removes them', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const teardown = initErrorReporting({ env: { PROD: true } });

    expect(addSpy).toHaveBeenCalledWith('error', expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith('unhandledrejection', expect.any(Function));

    teardown();
    expect(removeSpy).toHaveBeenCalledWith('error', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('unhandledrejection', expect.any(Function));

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('is idempotent: a second call before teardown does not double-attach', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const teardown1 = initErrorReporting({ env: { PROD: true } });
    const errorCallsAfterFirst = addSpy.mock.calls.filter(([name]) => name === 'error').length;
    const teardown2 = initErrorReporting({ env: { PROD: true } });
    const errorCallsAfterSecond = addSpy.mock.calls.filter(([name]) => name === 'error').length;

    expect(errorCallsAfterSecond).toBe(errorCallsAfterFirst);

    teardown2();
    teardown1();
    addSpy.mockRestore();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
