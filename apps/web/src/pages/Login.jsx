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
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { PublicLink as Link } from '../components/PublicLink.jsx';
import { usePublicLanguage } from '../contexts/PublicLanguageContext.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import SignInPanel from '../components/SignInPanel.jsx';
import { primaryButtonClass, secondaryButtonClass } from '../components/controlClasses.js';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { adminReturnPath } from '../lib/adminReturnPath.js';
import { isReadOnlyDemo } from '../lib/readOnlyDemo.js';
import LoadingState from '../components/LoadingState.jsx';

export default function Login() {
  const { text, localize } = usePublicLanguage();
  const { user, loading, signOut, authError, retryAuth } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { eventConfig } = useEventConfig();
  const readOnlyDemo = isReadOnlyDemo(eventConfig);
  const returnPath = adminReturnPath(location.state?.from);
  const [reauthenticateUid, setReauthenticateUid] = useState(null);
  const panelOnly = (readOnlyDemo && !returnPath) || authError;
  const checkingSignIn = !panelOnly && loading;

  function renderSignInContent() {
    if (panelOnly) return <div className="mt-lg"><SignInPanel /></div>;
    if (checkingSignIn) return null;
    if (user) return (
      <>
        <div className="mt-lg space-y-md border-hairline border-rule-hairline bg-surface-alt p-lg">
          <p className="text-text-primary">
            {user.email ? text(`You are signed in as ${user.email}.`, `Iniciaste sesión como ${user.email}.`) : text('You are signed in.', 'Iniciaste sesión.')}
          </p>
          <Link to={returnPath || '/'} className={primaryButtonClass}>
            {returnPath ? text('Go to the admin CMS', 'Ir al gestor de contenido') : text('Go to the home page', 'Ir a la página de inicio')}
          </Link>
          {returnPath && user.email && !readOnlyDemo ? (
            <button type="button" onClick={() => setReauthenticateUid(user.uid)} className={secondaryButtonClass}>
              {text(`Continue as ${user.email}`, `Continuar como ${user.email}`)}
            </button>
          ) : null}
          <button type="button" onClick={() => signOut()} className={secondaryButtonClass}>
            {text('Sign out', 'Cerrar sesión')}
          </button>
        </div>
        {reauthenticateUid === user.uid ? (
          <div className="mt-lg">
            <SignInPanel initialEmail={user.email} onSignedIn={() => navigate(localize(returnPath || '/'), { replace: true })} />
          </div>
        ) : null}
      </>
    );
    return (
      <>
        <p className="mt-xs max-w-prose text-body text-text-secondary text-pretty">
          {readOnlyDemo
            ? text('Use the Google account for your admin email. This demo does not send email codes.', 'Usa la cuenta de Google de tu correo de administración. Esta demostración no envía códigos por correo.')
            : eventConfig?.auth?.googleProviderEnabled === true
              ? text('Use your Google account, or get a one-time code by email. No password needed.', 'Usa tu cuenta de Google o recibe un código de un solo uso por correo. No necesitas contraseña.')
              : text('Get a one-time code by email. No password needed.', 'Recibe un código de un solo uso por correo. No necesitas contraseña.')}
        </p>

        <div className="mt-lg">
          <SignInPanel onSignedIn={() => navigate(localize(returnPath || '/'), { replace: true })} />
        </div>
      </>
    );
  }

  return (
    <article className="mx-auto max-w-md">
      <h1 className="font-heading text-h1 font-semibold text-text-primary">{text('Sign in', 'Iniciar sesión')}</h1>
      {checkingSignIn ? (
        <LoadingState label={text('Checking your sign-in…', 'Comprobando el inicio de sesión…')} rows={0} onRetry={retryAuth} />
      ) : null}
      <section aria-label={text('Sign-in options', 'Opciones de inicio de sesión')} aria-busy={checkingSignIn}>
        {renderSignInContent()}
      </section>
    </article>
  );
}
