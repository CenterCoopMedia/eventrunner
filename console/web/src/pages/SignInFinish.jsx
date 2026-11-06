import { useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { EMAIL_KEY, peekReturn, readStored, signInErrorMessage, useAuth } from '../auth.jsx';
import { isEmail } from '../text.js';
import LoadingState from '../LoadingState.jsx';

/** The page the emailed sign-in link opens: /signin/finish. */
export default function SignInFinish() {
  const auth = useAuth();
  const [href] = useState(() => window.location.href);
  const [isLink] = useState(() => auth.isEmailLink(href));
  const [remembered] = useState(() => readStored(EMAIL_KEY));
  // A session that is open but not confirmed still needs this link; its own
  // address is the one the link was sent to when nothing was remembered.
  const unconfirmed = auth.user && !auth.user.emailVerified;
  const address = remembered || (unconfirmed ? auth.user.email : null);
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  const fieldRef = useRef(null);

  async function finish(address) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await auth.finishEmailLink(address, href);
    } catch (err) {
      setError(signInErrorMessage(err) || 'Sign-in did not work. Try again.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if ((!auth.user || unconfirmed) && isLink && address && !started.current) {
      started.current = true;
      finish(address);
    }
    // finish reads only stable values; this runs once per page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLink, address]);

  if (auth.user && auth.user.emailVerified) return <Navigate to={peekReturn(href)} replace />;
  if (!isLink) return <Navigate to={auth.user ? peekReturn(href) : '/signin'} replace />;

  function onSubmit(event) {
    event.preventDefault();
    if (!isEmail(email)) {
      setFieldError('Enter the email address the link was sent to.');
      fieldRef.current?.focus();
      return;
    }
    setFieldError('');
    finish(email);
  }

  return (
    <section className="panel narrow" aria-labelledby="finish-title">
      <h1 id="finish-title" tabIndex={-1}>{address ? 'Signing you in' : 'Confirm your email address'}</h1>
      {error ? (
        <>
          <p className="message error" role="alert">{error}</p>
          <p><Link to="/signin">Get a new sign-in link</Link></p>
        </>
      ) : null}
      {address && !error ? <LoadingState long>Signing you in.</LoadingState> : null}
      {!address ? (
        <form noValidate onSubmit={onSubmit} className="stack">
          <p>Enter the email address used for this sign-in link. If you have a signup link, open it again after signing in.</p>
          <div className="field">
            <label htmlFor="finish-email">Email address</label>
            <input
              id="finish-email"
              ref={fieldRef}
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              disabled={busy}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={fieldError ? 'true' : undefined}
              aria-describedby={fieldError ? 'finish-email-error' : undefined}
            />
            {fieldError ? <p id="finish-email-error" className="field-error">{fieldError}</p> : null}
          </div>
          <button type="submit" className="button primary" disabled={busy} aria-busy={busy || undefined}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
      ) : null}
    </section>
  );
}
