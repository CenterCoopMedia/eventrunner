// The signed-out sign-in form, shared by /signin and the speaker
// invite-acceptance page (issue #11, issue #21; spec §9 "Google + OTP only").
//
// Extracted from Login.jsx rather than reimplemented: §9 rewrites
// SpeakerAccept's email path onto OTP, and two copies of a request-code /
// enter-code state machine is exactly how the two pages drift — one gets the
// 429 countdown, the other keeps a stale error slot, and only one of them is
// tested. There is one implementation and both pages mount it.
//
// Two paths:
//   • Google popup.
//   • Emailed six-digit code, two steps: email → sendOtpCode →
//     code → verifyOtpCode → signInWithCustomToken (AuthContext owns the
//     endpoint fetches and the custom-token exchange).
//
// Interface guidelines applied here: real labels with correct
// type/inputmode, paste never blocked on the code field, submit enabled
// until the request starts, validation on submit with aria-invalid and focus
// moved to the error, 429 surfaced as friendly role="status" copy with a
// countdown, tabular numerals on timers, 44px touch targets.
//
// Editorial base restyle (design brief §2.1, §2.4): the form sits in a
// hairline-ruled block tinted by --color-surface-alt rather than a
// shadowed card — elevation by tint, never depth. The "or" divider between
// the Google and email paths is drawn with the hairline rule tokens
// (§2.1's rule device), not a raw color literal. Countdown and code digits
// take the mono face with tabular figures (§3.2): they are values a reader
// compares, not running prose. Every form `<label>` stays above its input —
// that is a control label, the one exemption the eyebrow ban names (§2.4),
// never an eyebrow to "fix".
import { useCallback, useEffect, useRef, useState } from 'react';
import { OtpRequestError, useAuth } from '../contexts/AuthContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { IS_DEMO } from '../lib/demoMode.js';

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

// The boundary is --color-border-control, not --rule-hairline (design brief
// §8.1 polish, WCAG 1.4.11): a rule is tuned for low-contrast section
// dividers, and a form control's boundary needs 3:1 against its ground.
const inputClass =
  'touch-target w-full rounded-brand border-hairline border-control bg-surface px-sm py-xs ' +
  'font-body text-body text-text-primary placeholder:text-text-secondary ' +
  'aria-[invalid=true]:border-danger';

export const primaryButtonClass =
  'touch-target inline-flex w-full items-center justify-center rounded-brand ' +
  'bg-accent px-md py-xs font-data text-caption font-semibold text-surface ' +
  'hover:bg-accent-strong disabled:opacity-60';

export const secondaryButtonClass =
  'touch-target inline-flex w-full items-center justify-center rounded-brand ' +
  'border-hairline border-rule-hairline bg-surface px-md py-xs font-data text-caption font-semibold ' +
  'text-text-primary hover:bg-surface-alt disabled:opacity-60';

const linkButtonClass =
  'touch-target inline-flex items-center rounded-brand px-2xs py-3xs font-data text-caption underline ' +
  'underline-offset-2 text-text-secondary hover:text-text-primary';

/**
 * Inline form error: not color alone (icon + text), focusable so submit
 * handlers can move focus onto it (tabIndex -1).
 */
export function FormError({ id, message, errorRef }) {
  if (!message) return null;
  return (
    <p
      id={id}
      ref={errorRef}
      tabIndex={-1}
      className="flex items-start gap-xs rounded-brand border-hairline border-danger/40 bg-danger/10 px-sm py-xs font-data text-caption text-danger"
    >
      <span aria-hidden="true" className="font-semibold">
        !
      </span>
      <span>{message}</span>
    </p>
  );
}

/**
 * @param {{ onSignedIn?: () => void, initialEmail?: string }} props
 *   `onSignedIn` fires after either path completes — the caller decides
 *   where that leads (the home page from /signin, staying put on the
 *   acceptance page). `initialEmail` prefills the address the invitation
 *   was sent to, when the caller knows it.
 */
function SignInForm({ onSignedIn, initialEmail = '' }) {
  const { signInWithGoogle, sendOtpCode, verifyOtpCode } = useAuth();
  const { showToast } = useToast();

  const [step, setStep] = useState('email'); // 'email' | 'code'
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState(null);
  const [expiresInMinutes, setExpiresInMinutes] = useState(null);
  const [expiresAt, setExpiresAt] = useState(null); // ms epoch
  const [retryAt, setRetryAt] = useState(null); // ms epoch (429 window)
  const [rateLimitMessage, setRateLimitMessage] = useState(null); // 429 w/o a countdown hint
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
    setRateLimitMessage(null);
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
      setRateLimitMessage(null);
      setCode('');
      if (step === 'code') {
        showToast('New code sent. Check your inbox.');
        codeInputRef.current?.focus();
      } else {
        setStep('code');
      }
    } catch (err) {
      if (err instanceof OtpRequestError && err.status === 429) {
        // Friendly rate-limit copy, announced via role="status" below. When
        // the server gives us a retry window we show a live countdown;
        // otherwise we still surface the server's message as status copy
        // (no countdown to show, but silence would look like nothing
        // happened).
        if (err.retryAfterSeconds) {
          setRetryAt(Date.now() + err.retryAfterSeconds * 1000);
          setRateLimitMessage(null);
        } else {
          setRetryAt(null);
          setRateLimitMessage(err.message);
        }
      } else {
        // Route to the general (field: null) error slot, which renders on
        // both the email and code steps — a resend failure while already on
        // the code step must still be visible.
        failWith(null, err);
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
      onSignedIn?.();
    } catch (err) {
      failWith('code', err);
    } finally {
      setBusy(null);
    }
  }

  async function googleSignIn() {
    setError(null);
    setBusy('google');
    try {
      await signInWithGoogle();
      showToast('Signed in.');
      onSignedIn?.();
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

  return (
    <div className="space-y-lg border-hairline border-rule-hairline bg-surface-alt p-lg">
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

      <div className="flex items-center gap-sm" aria-hidden="true">
        <span className="h-0 flex-1 border-t-hairline border-t-rule-hairline" />
        <span className="font-data text-caption text-text-secondary">or</span>
        <span className="h-0 flex-1 border-t-hairline border-t-rule-hairline" />
      </div>

      {step === 'email' ? (
        <form onSubmit={requestCode} noValidate className="space-y-sm">
          <div className="space-y-3xs">
            <label htmlFor="signin-email" className="block font-semibold text-text-primary">
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
          <p role="status" className="font-data text-caption text-text-secondary">
            {retrySeconds > 0 ? (
              <>
                You have requested several codes recently. You can request
                another in{' '}
                <span aria-hidden="true" data-numeric className="font-mono">
                  {formatClock(retrySeconds)}
                </span>
                <span className="sr-only">
                  {' '}
                  about {Math.max(1, Math.ceil(retrySeconds / 60))} minute
                  {Math.ceil(retrySeconds / 60) === 1 ? '' : 's'}
                </span>
                .
              </>
            ) : (
              rateLimitMessage
            )}
          </p>
        </form>
      ) : (
        <form onSubmit={submitCode} noValidate className="space-y-sm">
          <p id="signin-code-hint" className="text-text-primary" style={{ textWrap: 'pretty' }}>
            We emailed a six-digit code to <strong>{email}</strong>. Enter it
            here within {expiresInMinutes} minutes.
          </p>
          <div className="space-y-3xs">
            <label htmlFor="signin-code" className="block font-semibold text-text-primary">
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
              className={`${inputClass} font-mono tracking-[0.3em]`}
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
          <p role="status" className="font-data text-caption text-text-secondary">
            {retrySeconds > 0 ? (
              <>
                You have requested several codes recently. You can request
                another in{' '}
                <span aria-hidden="true" data-numeric className="font-mono">
                  {formatClock(retrySeconds)}
                </span>
                <span className="sr-only">
                  {' '}
                  about {Math.max(1, Math.ceil(retrySeconds / 60))} minute
                  {Math.ceil(retrySeconds / 60) === 1 ? '' : 's'}
                </span>
                .
              </>
            ) : rateLimitMessage ? (
              rateLimitMessage
            ) : expirySeconds > 0 ? (
              <>
                Your code expires in{' '}
                <span aria-hidden="true" data-numeric className="font-mono">
                  {formatClock(expirySeconds)}
                </span>
                <span className="sr-only">
                  {' '}
                  about {Math.max(1, Math.ceil(expirySeconds / 60))} minute
                  {Math.ceil(expirySeconds / 60) === 1 ? '' : 's'}
                </span>
                .
              </>
            ) : (
              'Your code has expired. Email yourself a new one below.'
            )}
          </p>
          <div className="flex flex-wrap items-center justify-between gap-xs">
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
                setRetryAt(null);
                setRateLimitMessage(null);
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
  );
}

/**
 * The demo build's stand-in for the whole sign-in panel: there is no Firebase
 * project behind the static site, so both paths would fail at the network.
 * Saying so plainly beats a form that cannot work — and it keeps every
 * existing "Sign in" link in the app (SessionCard, Attendees, MySchedule,
 * Profile, the admin gate) landing somewhere honest, without touching any of
 * them.
 */
function DemoSignInNotice() {
  return (
    <div className="space-y-sm border-hairline border-rule-hairline bg-surface-alt p-lg">
      <p className="font-heading text-h3 font-semibold text-text-primary">
        Sign-in is disabled in this demo
      </p>
      <p className="text-text-secondary" style={{ textWrap: 'pretty' }}>
        This is a read-only tour of a fictional event. Accounts, bookmarks,
        the attendee directory, and the admin CMS all work on a real
        deployment — ask us for a walkthrough.
      </p>
    </div>
  );
}

/**
 * @param {{ onSignedIn?: () => void, initialEmail?: string }} props
 */
export default function SignInPanel(props) {
  // A plain branch rather than an early return inside SignInForm: the form
  // is a hooks-heavy component and rules-of-hooks forbids returning before
  // them. In a normal client build IS_DEMO is a compile-time `false`.
  return IS_DEMO ? <DemoSignInNotice /> : <SignInForm {...props} />;
}
