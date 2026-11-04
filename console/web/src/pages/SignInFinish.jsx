import { useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { EMAIL_KEY, peekReturn, readStored, signInErrorMessage, useAuth } from '../auth.jsx';
import { isEmail } from '../text.js';

/** The page the emailed sign-in link opens: /signin/finish. */
export default function SignInFinish() {
  const auth = useAuth();
  const [href] = useState(() => window.location.href);
  const [isLink] = useState(() => auth.isEmailLink(href));
  const [remembered] = useState(() => readStored(EMAIL_KEY));
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  const fieldRef = useRef(null);

  async function finish(address) {
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
    if (!auth.user && isLink && remembered && !started.current) {
      started.current = true;
      finish(remembered);
    }
    // finish reads only stable values; this runs once per page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLink, remembered]);

  if (auth.user) return <Navigate to={peekReturn()} replace />;
  if (!isLink) return <Navigate to="/signin" replace />;

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
      <h1 id="finish-title" tabIndex={-1}>{remembered ? 'Signing you in' : 'Confirm your email address'}</h1>
      {error ? (
        <>
          <p className="message error" role="alert">{error}</p>
          <p><Link to="/signin">Get a new sign-in link</Link></p>
        </>
      ) : null}
      {remembered && !error ? <p role="status">Signing you in. This takes a moment.</p> : null}
      {!remembered ? (
        <form noValidate onSubmit={onSubmit} className="stack">
          <p>You opened the link in a different browser. Enter the email address the link was sent to.</p>
          <div className="field">
            <label htmlFor="finish-email">Email address</label>
            <input
              id="finish-email"
              ref={fieldRef}
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={fieldError ? 'true' : undefined}
              aria-describedby={fieldError ? 'finish-email-error' : undefined}
            />
            {fieldError ? <p id="finish-email-error" className="field-error">{fieldError}</p> : null}
          </div>
          <button type="submit" className="button primary" disabled={busy}>Sign in</button>
        </form>
      ) : null}
    </section>
  );
}
