// Sign-in page (issue #11, spec §9 porting map: "Google + OTP only" — the
// magic-link branch and its inbox screen are gone). Two paths:
//
//   • Google popup.
//   • Emailed six-digit code, two steps: email → sendOtpCode →
//     code → verifyOtpCode → signInWithCustomToken (AuthContext owns the
//     endpoint fetches and the custom-token exchange).
//
// Interface guidelines applied here: real labels with correct type/inputmode,
// paste never blocked on the code field, submit enabled until the request
// starts, validation on submit with aria-invalid and focus moved to the
// error, 429 surfaced as friendly role="status" copy with a countdown,
// tabular numerals on timers, 44px touch targets.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { OtpRequestError, useAuth } from '../contexts/AuthContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Seconds remaining until `deadline` (ms epoch), ticking once per second. */
function useCountdown(deadline) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!deadline || deadline <= Date.now()) return undefined;
    const id = setInterval(() => {
      setTick((t) => t + 1);
      if (Date.now() >= deadline) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [deadline]);
  if (!deadline) return 0;
  return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
}

function formatClock(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

const inputClass =
  'touch-target w-full rounded-brand border border-brand-ink/20 bg-brand-surface px-3 py-2 ' +
  'text-brand-ink placeholder:text-brand-ink-muted ' +
  'aria-[invalid=true]:border-danger';

const primaryButtonClass =
  'touch-target inline-flex w-full items-center justify-center rounded-brand ' +
  'bg-brand-primary px-4 py-2 font-semibold text-brand-surface ' +
  'hover:bg-brand-primary-dark disabled:opacity-60';

const secondaryButtonClass =
  'touch-target inline-flex w-full items-center justify-center rounded-brand ' +
  'border border-brand-ink/20 bg-brand-surface px-4 py-2 font-semibold ' +
  'text-brand-ink hover:bg-brand-surface-alt disabled:opacity-60';

const linkButtonClass =
  'touch-target inline-flex items-center rounded-brand px-2 py-1 underline ' +
  'underline-offset-2 text-brand-ink-muted hover:text-brand-ink';

/**
 * Inline form error: not color alone (icon + text), focusable so submit
 * handlers can move focus onto it (tabIndex -1).
 */
function FormError({ id, message, errorRef }) {
  if (!message) return null;
  return (
    <p
      id={id}
      ref={errorRef}
      tabIndex={-1}
      className="flex items-start gap-2 rounded-brand border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
    >
      <span aria-hidden="true" className="font-semibold">
        !
      </span>
      <span>{message}</span>
    </p>
  );
}

export default function Login() {
  const { user, loading, signInWithGoogle, sendOtpCode, verifyOtpCode, signOut } =
    useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [step, setStep] = useState('email'); // 'email' | 'code'
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState(null);
  const [expiresInMinutes, setExpiresInMinutes] = useState(null);
  const [expiresAt, setExpiresAt] = useState(null); // ms epoch
  const [retryAt, setRetryAt] = useState(null); // ms epoch (429 window)
  const [busy, setBusy] = useState(null); // null | 'send' | 'verify' | 'google'
  const [error, setError] = useState(null); // { field: 'email'|'code'|null, message }

  const errorRef = useRef(null);
  const codeInputRef = useRef(null);

  const expirySeconds = useCountdown(expiresAt);
  const retrySeconds = useCountdown(retryAt);

  // Validation on submit: aria-invalid marks the field, focus moves to the
  // error (interface guidelines: Accessibility).
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const failWith = useCallback((field, err) => {
    setError({
      field,
      message:
        err instanceof OtpRequestError
          ? err.message
          : 'Something went wrong. Try again.',
    });
  }, []);

  async function requestCode(event) {
    event.preventDefault();
    setError(null);
    const address = email.trim();
    if (!EMAIL_RE.test(address)) {
      setError({
        field: 'email',
        message: 'Enter a valid email address, like you@example.org.',
      });
      return;
    }
    setBusy('send');
    try {
      const result = await sendOtpCode(address);
      setEmail(address);
      setChallengeId(result.challengeId);
      setExpiresInMinutes(result.expiresInMinutes);
      setExpiresAt(Date.now() + result.expiresInMinutes * 60_000);
      setRetryAt(null);
      setCode('');
      if (step === 'code') {
        showToast('New code sent. Check your inbox.');
        codeInputRef.current?.focus();
      } else {
        setStep('code');
      }
    } catch (err) {
      if (err instanceof OtpRequestError && err.status === 429) {
        // Friendly rate-limit copy, announced via role="status" below.
        setRetryAt(
          err.retryAfterSeconds ? Date.now() + err.retryAfterSeconds * 1000 : null,
        );
      } else {
        failWith('email', err);
      }
    } finally {
      setBusy(null);
    }
  }

  async function submitCode(event) {
    event.preventDefault();
    setError(null);
    const digits = code.trim();
    if (!/^\d{6}$/.test(digits)) {
      setError({ field: 'code', message: 'Enter the six-digit code from the email.' });
      return;
    }
    setBusy('verify');
    try {
      await verifyOtpCode({ challengeId, email, code: digits });
      showToast('Signed in.');
      navigate('/', { replace: true });
    } catch (err) {
      failWith('code', err);
      setBusy(null);
    }
  }

  async function googleSignIn() {
    setError(null);
    setBusy('google');
    try {
      await signInWithGoogle();
      showToast('Signed in.');
      navigate('/', { replace: true });
    } catch (err) {
      // Closing the popup is a choice, not an error.
      if (
        err?.code !== 'auth/popup-closed-by-user' &&
        err?.code !== 'auth/cancelled-popup-request'
      ) {
        setError({
          field: null,
          message: 'Google sign-in did not complete. Try again or use an emailed code.',
        });
      }
    } finally {
      setBusy(null);
    }
  }

  // Move to the code input when step 2 appears.
  useEffect(() => {
    if (step === 'code') codeInputRef.current?.focus();
  }, [step]);

  if (loading) {
    return (
      <p role="status" className="text-brand-ink-muted">
        Checking your sign-in…
      </p>
    );
  }

  if (user) {
    return (
      <article className="mx-auto max-w-md">
        <h1 className="text-3xl font-semibold text-brand-ink">Sign in</h1>
        <div className="mt-6 space-y-4 rounded-brand-lg border border-brand-ink/10 bg-brand-surface p-6">
          <p className="text-brand-ink">
            You are signed in{user.email ? ` as ${user.email}` : ''}.
          </p>
          <Link to="/" className={primaryButtonClass}>
            Go to the home page
          </Link>
          <button type="button" onClick={() => signOut()} className={secondaryButtonClass}>
            Sign out
          </button>
        </div>
      </article>
    );
  }

  return (
    <article className="mx-auto max-w-md">
      <h1 className="text-3xl font-semibold text-brand-ink">Sign in</h1>
      <p className="mt-2 text-brand-ink-muted" style={{ textWrap: 'pretty' }}>
        Use your Google account, or get a one-time code by email. No password
        needed.
      </p>

      <div className="mt-6 space-y-6 rounded-brand-lg border border-brand-ink/10 bg-brand-surface p-6">
        {error?.field === null && (
          <FormError id="signin-error" message={error.message} errorRef={errorRef} />
        )}

        <button
          type="button"
          onClick={googleSignIn}
          disabled={busy === 'google'}
          className={secondaryButtonClass}
        >
          {busy === 'google' ? 'Waiting for Google…' : 'Continue with Google'}
        </button>

        <div className="flex items-center gap-3" aria-hidden="true">
          <span className="h-px flex-1 bg-brand-ink/10" />
          <span className="text-sm text-brand-ink-muted">or</span>
          <span className="h-px flex-1 bg-brand-ink/10" />
        </div>

        {step === 'email' ? (
          <form onSubmit={requestCode} noValidate className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="signin-email" className="block font-semibold text-brand-ink">
                Email address
              </label>
              <input
                id="signin-email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-invalid={error?.field === 'email' ? 'true' : undefined}
                aria-describedby={
                  error?.field === 'email' ? 'signin-email-error' : undefined
                }
                className={inputClass}
              />
            </div>
            {error?.field === 'email' && (
              <FormError
                id="signin-email-error"
                message={error.message}
                errorRef={errorRef}
              />
            )}
            <button type="submit" disabled={busy === 'send'} className={primaryButtonClass}>
              {busy === 'send' ? 'Sending code…' : 'Email me a code'}
            </button>
            <p role="status" className="text-sm text-brand-ink-muted">
              {retrySeconds > 0 && (
                <>
                  You have requested several codes recently. You can request
                  another in{' '}
                  <span data-numeric>{formatClock(retrySeconds)}</span>.
                </>
              )}
            </p>
          </form>
        ) : (
          <form onSubmit={submitCode} noValidate className="space-y-4">
            <p id="signin-code-hint" className="text-brand-ink" style={{ textWrap: 'pretty' }}>
              We emailed a six-digit code to <strong>{email}</strong>. Enter it
              here within {expiresInMinutes} minutes.
            </p>
            <div className="space-y-1">
              <label htmlFor="signin-code" className="block font-semibold text-brand-ink">
                Six-digit code
              </label>
              <input
                id="signin-code"
                name="code"
                ref={codeInputRef}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(event) =>
                  // Keep digits only; pasting "123 456" still lands as 123456.
                  setCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                }
                aria-invalid={error?.field === 'code' ? 'true' : undefined}
                aria-describedby={
                  error?.field === 'code'
                    ? 'signin-code-hint signin-code-error'
                    : 'signin-code-hint'
                }
                className={`${inputClass} tracking-[0.3em]`}
                data-numeric
              />
            </div>
            {error?.field === 'code' && (
              <FormError
                id="signin-code-error"
                message={error.message}
                errorRef={errorRef}
              />
            )}
            <button
              type="submit"
              disabled={busy === 'verify'}
              className={primaryButtonClass}
            >
              {busy === 'verify' ? 'Signing in…' : 'Sign in'}
            </button>
            <p role="status" className="text-sm text-brand-ink-muted">
              {retrySeconds > 0 ? (
                <>
                  You have requested several codes recently. You can request
                  another in{' '}
                  <span data-numeric>{formatClock(retrySeconds)}</span>.
                </>
              ) : expirySeconds > 0 ? (
                <>
                  Your code expires in{' '}
                  <span data-numeric>{formatClock(expirySeconds)}</span>.
                </>
              ) : (
                'Your code has expired. Email yourself a new one below.'
              )}
            </p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={requestCode}
                disabled={busy === 'send'}
                className={linkButtonClass}
              >
                {busy === 'send' ? 'Sending code…' : 'Email me a new code'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep('email');
                  setError(null);
                  setChallengeId(null);
                  setExpiresAt(null);
                  setCode('');
                }}
                className={linkButtonClass}
              >
                Use a different email
              </button>
            </div>
          </form>
        )}
      </div>
    </article>
  );
}
