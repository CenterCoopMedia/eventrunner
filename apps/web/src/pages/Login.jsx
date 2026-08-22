// Sign-in page (issue #11, spec §9 porting map: "Google + OTP only" — the
// magic-link branch and its inbox screen are gone).
//
// The form itself lives in components/SignInPanel.jsx, which the speaker
// invite-acceptance page mounts too (issue #21): §9 rewrites SpeakerAccept's
// email path onto the same request-code / enter-code flow, and one
// implementation is what keeps them from drifting. This page owns the
// heading, the already-signed-in branch, and where a successful sign-in
// lands.
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import SignInPanel, {
  primaryButtonClass,
  secondaryButtonClass,
} from '../components/SignInPanel.jsx';

export default function Login() {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();

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

      <div className="mt-6">
        <SignInPanel onSignedIn={() => navigate('/', { replace: true })} />
      </div>
    </article>
  );
}
