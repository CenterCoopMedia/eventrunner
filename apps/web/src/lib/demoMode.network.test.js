// The static demo build makes one promise — nothing leaves the browser —
// and Firestore going offline (firebase.js) only keeps HALF of it. Every
// remaining seam is a bare `fetch` to the Cloud Functions origin, which
// nothing switches off globally, and the demo build carries a placeholder
// VITE_FIREBASE_PROJECT_ID so that origin resolves perfectly happily.
//
// These are the seams reachable in the demo WITHOUT signing in (sign-in
// itself is replaced by a notice, so the token-bearing endpoints behind it
// are unreachable by construction):
//
//   validateSpeakerInvite  — fires on load from a `?token=` deep link
//   logClientError         — fires on the first uncaught error in the tab
//   submitFeedback         — unauthenticated by design
//
// This file pins each one to "issues no request in demo mode". IS_DEMO is a
// module constant compiled from import.meta.env, so demo mode is asserted by
// mocking that module rather than by setting env.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./demoMode.js', () => ({ IS_DEMO: true, default: true }));

import { SpeakerInviteError, acceptSpeakerInvite, validateSpeakerInvite } from './speakerInvites.js';
import { submitFeedback } from './feedbackApi.js';
import {
  initErrorReporting,
  isClientErrorReportingEnabled,
  reportClientError,
  resetErrorReportingInstalledForTest,
  resetErrorReportingStateForTest,
} from './errorReporting.js';

/** Stands in for a real deployment's env: an origin IS resolvable here. */
const DEMO_ENV = {
  PROD: true,
  VITE_FIREBASE_PROJECT_ID: 'demo-run-of-show',
  VITE_FIREBASE_REGION: 'us-central1',
};

let fetchMock;

beforeEach(() => {
  resetErrorReportingStateForTest();
  resetErrorReportingInstalledForTest();
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
  globalThis.fetch = fetchMock;
});

describe('speaker invites in demo mode', () => {
  it('never POSTs the token from a ?token= deep link', async () => {
    await expect(validateSpeakerInvite('a'.repeat(64))).rejects.toBeInstanceOf(SpeakerInviteError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports the refusal as `demo`, not as a network failure', async () => {
    // 'network' would render the "check your connection" state, which claims
    // something about the visitor's link that was never checked.
    await expect(validateSpeakerInvite('token')).rejects.toMatchObject({ code: 'demo' });
  });

  it('never POSTs an acceptance either', async () => {
    await expect(
      acceptSpeakerInvite({ token: 'token', idToken: 'id-token' }),
    ).rejects.toBeInstanceOf(SpeakerInviteError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('client error reporting in demo mode', () => {
  it('is disabled even in a production build', () => {
    expect(isClientErrorReportingEnabled(DEMO_ENV)).toBe(false);
  });

  it('is disabled even with an explicit opt-in', () => {
    expect(
      isClientErrorReportingEnabled({ ...DEMO_ENV, VITE_ENABLE_CLIENT_ERROR_REPORTING: 'true' }),
    ).toBe(false);
  });

  it('installs no window listeners', () => {
    const add = vi.spyOn(window, 'addEventListener');
    initErrorReporting({ env: DEMO_ENV });
    expect(add).not.toHaveBeenCalledWith('error', expect.anything());
    expect(add).not.toHaveBeenCalledWith('unhandledrejection', expect.anything());
    add.mockRestore();
  });

  it('sends nothing even when called directly', async () => {
    await reportClientError({ message: 'boom' }, { env: DEMO_ENV, fetchImpl: fetchMock });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('feedback in demo mode', () => {
  it('sends nothing and answers with the fail-soft shape the modal renders', async () => {
    const result = await submitFeedback(
      { message: 'hello', honeypot: '', startedAt: 0, submissionKey: 'k' },
      { env: DEMO_ENV, fetchImpl: fetchMock },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/demo/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
