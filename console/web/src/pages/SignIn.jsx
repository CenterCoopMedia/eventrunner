import { useRef, useState } from 'react';
import { Navigate } from 'react-router';
import { signInErrorMessage, peekReturn, useAuth } from '../auth.jsx';
import { isEmail } from '../text.js';

export default function SignIn() {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [error, setError] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [busy, setBusy] = useState(false);
  const fieldRef = useRef(null);

  if (auth.user) return <Navigate to={peekReturn()} replace />;

  async function run(method) {
    setError('');
    setBusy(true);
    try {
      await method();
    } catch (err) {
      setError(signInErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onEmailSubmit(event) {
    event.preventDefault();
    if (!isEmail(email)) {
      setFieldError('Enter a valid email address.');
      fieldRef.current?.focus();
      return;
    }
    setFieldError('');
    await run(async () => {
      await auth.sendEmailLink(email);
      setSentTo(email.trim().toLowerCase());
    });
  }

  return (
    <section className="panel narrow" aria-labelledby="signin-title">
      <h1 id="signin-title" tabIndex={-1}>Sign in to Event Runner</h1>
      <p className="lead">Sign in to set up your event site. If you are new, signing in makes your account.</p>

      {error ? <p className="message error" role="alert">{error}</p> : null}

      <div className="stack">
        <button type="button" className="button provider" disabled={busy} onClick={() => run(auth.signInWithGoogle)}>
          Continue with Google
        </button>
        <button type="button" className="button provider" disabled={busy} onClick={() => run(auth.signInWithMicrosoft)}>
          Continue with Microsoft
        </button>
      </div>

      <h2 className="divider">Or get a sign-in link by email</h2>
      {sentTo ? (
        <p className="message success" role="status">
          We sent a sign-in link to {sentTo}. Open the link on this device to sign in.
        </p>
      ) : (
        <form noValidate onSubmit={onEmailSubmit} className="stack">
          <div className="field">
            <label htmlFor="signin-email">Email address</label>
            <input
              id="signin-email"
              ref={fieldRef}
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={fieldError ? 'true' : undefined}
              aria-describedby={fieldError ? 'signin-email-error' : undefined}
            />
            {fieldError ? <p id="signin-email-error" className="field-error">{fieldError}</p> : null}
          </div>
          <button type="submit" className="button primary" disabled={busy}>Email me a link</button>
        </form>
      )}
    </section>
  );
}
