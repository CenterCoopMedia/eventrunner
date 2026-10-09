// Sign-in page (issue #11, spec §9 porting map: "Google + OTP only" — the
// magic-link branch and its inbox screen are gone).
//
// The form itself lives in components/SignInPanel.jsx, which the speaker
// invite-acceptance page mounts too (issue #21): §9 rewrites SpeakerAccept's
// email path onto the same request-code / enter-code flow, and one
// implementation is what keeps them from drifting. This page owns the
// heading, the already-signed-in branch, and where a successful sign-in
// lands.
//
// Editorial base restyle (design brief §2.1, §2.4): the already-signed-in
// state sits in a hairline-ruled block tinted by --color-surface-alt, the
// same flat-tint device SignInPanel itself uses — never a shadowed,
// rounded card.
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import SignInPanel from '../components/SignInPanel.jsx';
import { primaryButtonClass, secondaryButtonClass } from '../components/controlClasses.js';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { adminReturnPath } from '../lib/adminReturnPath.js';
import { isReadOnlyDemo } from '../lib/readOnlyDemo.js';

export default function Login() {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { eventConfig } = useEventConfig();
  const readOnlyDemo = isReadOnlyDemo(eventConfig);
  const returnPath = adminReturnPath(location.state?.from);

  if (readOnlyDemo && !returnPath) {
    return (
      <article className="mx-auto max-w-md">
        <h1 className="font-heading text-h1 font-semibold text-text-primary">Sign in</h1>
        <div className="mt-lg"><SignInPanel /></div>
      </article>
    );
  }

  if (loading) {
    return (
      <p role="status" className="font-data text-caption text-text-secondary">
        Checking your sign-in…
      </p>
    );
  }

  if (user) {
    return (
      <article className="mx-auto max-w-md">
        <h1 className="font-heading text-h1 font-semibold text-text-primary">Sign in</h1>
        <div className="mt-lg space-y-md border-hairline border-rule-hairline bg-surface-alt p-lg">
          <p className="text-text-primary">
            You are signed in{user.email ? ` as ${user.email}` : ''}.
          </p>
          <Link to={returnPath || '/'} className={primaryButtonClass}>
            {returnPath ? 'Go to the admin CMS' : 'Go to the home page'}
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
      <h1 className="font-heading text-h1 font-semibold text-text-primary">Sign in</h1>
      <p className="mt-xs max-w-prose text-body text-text-secondary text-pretty">
        {readOnlyDemo
          ? 'Use the Google account for your admin email. This demo does not send email codes.'
          : 'Use your Google account, or get a one-time code by email. No password needed.'}
      </p>

      <div className="mt-lg">
        <SignInPanel onSignedIn={() => navigate(returnPath || '/', { replace: true })} />
      </div>
    </article>
  );
}
