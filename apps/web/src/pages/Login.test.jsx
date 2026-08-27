// Sign-in flow state machine (issue #11): mocked fetch + mocked Firebase
// auth (see src/test/setup.js). Covers send→verify→custom-token happy path,
// 429 rate-limit copy, error focus handling, and the never-block-paste rule.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { signInWithCustomToken } from 'firebase/auth';
import App from '../App.jsx';
import { functionsOrigin } from '../contexts/AuthContext.jsx';
import { appCheckHeaders } from '../firebase.js';

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function renderSignIn() {
  return render(
    <MemoryRouter
      initialEntries={['/signin']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <App />
    </MemoryRouter>,
  );
}

async function requestCode(email = 'attendee@example.org') {
  fireEvent.change(screen.getByLabelText('Email address'), {
    target: { value: email },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }));
  return screen.findByLabelText('Six-digit code');
}

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = vi.fn();
  // Test env runs credential-free (no VITE_FIREBASE_PROJECT_ID, spec §8.1),
  // which is the one case functionsOrigin() now logs about (see the
  // "functions origin convention" describe block below) — expected here,
  // so keep it out of the rest of the suite's output.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('functions origin convention', () => {
  it('builds https://<region>-<project>.cloudfunctions.net (spec §2.4)', () => {
    // Test env deliberately runs credential-free (spec §8.1): no
    // VITE_FIREBASE_PROJECT_ID is set, so this pins the default-region
    // shape only, not a real project id.
    expect(functionsOrigin()).toMatch(
      /^https:\/\/us-central1-.*\.cloudfunctions\.net$/,
    );
  });

  it('logs a diagnosable error when the project id is missing, instead of failing silently', () => {
    // console.error is already a vi.fn() from the top-level beforeEach.
    functionsOrigin();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('VITE_FIREBASE_PROJECT_ID'),
    );
  });
});

describe('emailed-code sign-in', () => {
  it('walks send → verify → signInWithCustomToken and lands on home', async () => {
    fetch
      .mockResolvedValueOnce(
        jsonResponse(200, { challengeId: 'chal-1', expiresInMinutes: 10 }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { token: 'custom-token-abc' }));

    renderSignIn();
    const codeInput = await requestCode();

    // Step 1 request shape.
    expect(fetch).toHaveBeenCalledWith(
      `${functionsOrigin()}/sendOtpCode`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'attendee@example.org' }),
      }),
    );

    // The code field follows the interface guidelines to the letter.
    expect(codeInput).toHaveAttribute('inputmode', 'numeric');
    expect(codeInput).toHaveAttribute('autocomplete', 'one-time-code');
    // Expiry countdown from expiresInMinutes is visible.
    expect(screen.getByText(/Your code expires in/)).toBeInTheDocument();

    fireEvent.change(codeInput, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        `${functionsOrigin()}/verifyOtpCode`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            challengeId: 'chal-1',
            email: 'attendee@example.org',
            code: '123456',
          }),
        }),
      );
    });
    expect(signInWithCustomToken).toHaveBeenCalledWith({}, 'custom-token-abc');

    // Success navigates to the home page — assert on content that only the
    // home page renders (the login page's own "Sign in" h1 would otherwise
    // satisfy a generic `heading level 1` check even with no navigation at
    // all), and confirm the sign-in form itself is gone.
    //
    // The dates section is now titled by its own section head ("Dates")
    // rather than carrying an aria-label, which is what the editorial
    // restyle gave every section boundary (design brief §2.1).
    await screen.findByRole('region', { name: 'Dates' });
    expect(
      screen.queryByRole('button', { name: 'Sign in' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Six-digit code')).not.toBeInTheDocument();
  });

  it('never blocks paste on the code input', async () => {
    fetch.mockResolvedValueOnce(
      jsonResponse(200, { challengeId: 'chal-1', expiresInMinutes: 10 }),
    );
    renderSignIn();
    const codeInput = await requestCode();

    // fireEvent returns false when a handler calls preventDefault — pasting
    // must never be cancelled.
    const notPrevented = fireEvent.paste(codeInput, {
      clipboardData: { getData: () => '123456' },
    });
    expect(notPrevented).toBe(true);
  });

  it('surfaces a 429 as friendly role="status" copy with the retry countdown', async () => {
    fetch.mockResolvedValueOnce(
      jsonResponse(429, {
        error: {
          code: 'rate-limited',
          message: 'Too many code requests. Try again later.',
          retryAfterSeconds: 90,
        },
      }),
    );
    renderSignIn();

    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'attendee@example.org' },
    });
    const submit = screen.getByRole('button', { name: 'Email me a code' });
    fireEvent.click(submit);

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(/request another in/i);
    expect(status).toHaveTextContent('1:30');
    // Not styled or announced as an error, and submit stays available.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(submit).toBeEnabled();
    expect(screen.getByLabelText('Email address')).not.toHaveAttribute(
      'aria-invalid',
    );
  });

  it('surfaces a resend failure while already on the code step', async () => {
    fetch
      .mockResolvedValueOnce(
        jsonResponse(200, { challengeId: 'chal-1', expiresInMinutes: 10 }),
      )
      .mockResolvedValueOnce(
        jsonResponse(502, {
          error: { code: 'send-failed', message: 'Your code could not be sent. Try again.' },
        }),
      );
    renderSignIn();
    await requestCode();

    fireEvent.click(screen.getByRole('button', { name: 'Email me a new code' }));

    await screen.findByText(/could not be sent/);
    // Still on the code step, with the code input intact.
    expect(screen.getByLabelText('Six-digit code')).toBeInTheDocument();
  });

  it('shows the server message on a 429 with no retry-after hint', async () => {
    fetch.mockResolvedValueOnce(
      jsonResponse(429, {
        error: {
          code: 'rate-limited',
          message: 'Too many code requests. Try again later.',
          retryAfterSeconds: null,
        },
      }),
    );
    renderSignIn();

    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'attendee@example.org' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Too many code requests. Try again later.');
  });

  it('marks a rejected code aria-invalid and moves focus to the error', async () => {
    fetch
      .mockResolvedValueOnce(
        jsonResponse(200, { challengeId: 'chal-1', expiresInMinutes: 10 }),
      )
      .mockResolvedValueOnce(
        jsonResponse(401, {
          error: {
            code: 'invalid-code',
            message: 'That code is invalid or has expired. Request a new one.',
          },
        }),
      );
    renderSignIn();
    const codeInput = await requestCode();

    fireEvent.change(codeInput, { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    const error = await screen.findByText(
      'That code is invalid or has expired. Request a new one.',
    );
    expect(codeInput).toHaveAttribute('aria-invalid', 'true');
    expect(codeInput).toHaveAccessibleDescription(/invalid or has expired/);
    await waitFor(() => {
      expect(error.closest('[tabindex="-1"]')).toHaveFocus();
    });
    expect(signInWithCustomToken).not.toHaveBeenCalled();
    // Submit is re-enabled for another attempt.
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('validates the email on submit with focus moved to the error', async () => {
    renderSignIn();
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'not-an-email' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }));

    const error = await screen.findByText(/Enter a valid email address/);
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Email address')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await waitFor(() => {
      expect(error.closest('[tabindex="-1"]')).toHaveFocus();
    });
  });
});

describe('App Check attestation (issue #45)', () => {
  it('sends no extra header when App Check is unconfigured', async () => {
    fetch.mockResolvedValueOnce(
      jsonResponse(200, { challengeId: 'chal-1', expiresInMinutes: 10 }),
    );
    renderSignIn();
    await requestCode();

    const [, init] = fetch.mock.calls[0];
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('attaches X-Firebase-AppCheck to both OTP calls when a token is available', async () => {
    vi.mocked(appCheckHeaders).mockResolvedValue({
      'X-Firebase-AppCheck': 'attestation-token',
    });
    fetch
      .mockResolvedValueOnce(
        jsonResponse(200, { challengeId: 'chal-1', expiresInMinutes: 10 }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { token: 'custom-token-abc' }));

    renderSignIn();
    const codeInput = await requestCode();
    fireEvent.change(codeInput, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    for (const [, init] of fetch.mock.calls) {
      expect(init.headers).toEqual({
        'Content-Type': 'application/json',
        'X-Firebase-AppCheck': 'attestation-token',
      });
    }
    vi.mocked(appCheckHeaders).mockResolvedValue({});
  });
});
