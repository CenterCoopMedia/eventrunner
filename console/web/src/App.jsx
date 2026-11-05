import { useEffect, useRef, useState } from 'react';
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import { AuthProvider, forgetReturn, rememberReturn, signInErrorMessage, useAuth } from './auth.jsx';
import AcceptInvite from './pages/AcceptInvite.jsx';
import AcceptedAgreement from './pages/AcceptedAgreement.jsx';
import ApplicationStatus from './pages/ApplicationStatus.jsx';
import ConnectReturn from './pages/ConnectReturn.jsx';
import OrganizationHome from './pages/OrganizationHome.jsx';
import Setup from './pages/setup/Setup.jsx';
import StartEvent from './pages/StartEvent.jsx';
import Organizations from './pages/Organizations.jsx';
import SignIn from './pages/SignIn.jsx';
import SignInFinish from './pages/SignInFinish.jsx';
import Team from './pages/Team.jsx';
import ConsoleSettings from './pages/review/ConsoleSettings.jsx';
import ReviewApplication from './pages/review/ReviewApplication.jsx';
import ReviewQueue from './pages/review/ReviewQueue.jsx';
import SignupLinks from './pages/review/SignupLinks.jsx';
import LoadingState from './LoadingState.jsx';
import ReportProblem from './ReportProblem.jsx';

const MARK = (
  <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" className="mark">
    <g transform="scale(0.4)" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 44h7 M8 50h4" fill="none" stroke="rgb(var(--accent))" strokeWidth="3.5" />
      <g transform="matrix(1 0 -0.16 1 8 0)">
        <path d="M28 6 40 23 50 6" fill="none" stroke="rgb(var(--accent))" strokeWidth="3.5" />
        <path d="m31 59-7 10-7-3-1 2 M43 59l9 12 5-2 M54 42l8-8" fill="none" stroke="currentColor" strokeWidth="2.8" />
        <rect x="23" y="23" width="32" height="36" rx="5" fill="rgb(var(--surface))" stroke="currentColor" strokeWidth="2.5" />
        <path d="M24.25 28a3.75 3.75 0 0 1 3.75-3.75h22A3.75 3.75 0 0 1 53.75 28v4.75h-29.5Z" fill="rgb(var(--accent))" />
        <rect x="35" y="18" width="8" height="7" rx="1.5" fill="currentColor" />
        <circle cx="33" cy="43" r="2.2" fill="currentColor" />
        <circle cx="45" cy="43" r="2.2" fill="currentColor" />
        <path d="M34 50q5 4 10 0" fill="none" stroke="currentColor" strokeWidth="2.5" />
      </g>
    </g>
  </svg>
);

/** Focus the destination, including its main region while an async heading loads. */
function useFocusHeadingOnNavigate() {
  const { pathname } = useLocation();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    (document.querySelector('main h1') || document.querySelector('main'))?.focus();
  }, [pathname]);
}

function Layout() {
  const helpEmail = import.meta.env.VITE_CONSOLE_HELP_EMAIL;
  const helpName = import.meta.env.VITE_CONSOLE_HELP_NAME?.trim();
  const { user, signOut } = useAuth();
  const { pathname } = useLocation();
  useFocusHeadingOnNavigate();

  useEffect(() => {
    // An unconfirmed reader still has to come back here from the emailed link.
    if (user?.emailVerified && !pathname.startsWith('/signin')) forgetReturn();
  }, [user, pathname]);

  return (
    <>
      <a href="#main" className="skip-link">Skip to main content</a>
      <header className="masthead">
        <div className="masthead-inner">
          <Link to="/" className="brand">{MARK}<span>Event Runner</span></Link>
          {user ? (
            <div className="account">
              <span className="account-email">{user.email}</span>
              {user.emailVerified ? <ReportProblem /> : null}
              <button type="button" className="button quiet" onClick={() => signOut()}>Sign out</button>
            </div>
          ) : null}
        </div>
      </header>
      <main id="main" tabIndex={-1} className="page">
        <Outlet />
        {helpEmail ? <p className="muted section">{helpName ? `Need a hand? Email ${helpName} at ` : 'Need the hosting team? Email '}<a href={`mailto:${helpEmail}`}>{helpEmail}</a>.</p> : null}
      </main>
    </>
  );
}

/** Ask a reader whose email is not confirmed to confirm it with an emailed link. */
function ConfirmEmail({ user }) {
  const { sendEmailLink } = useAuth();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  async function send() {
    if (sending) return;
    setError('');
    setSending(true);
    try {
      await sendEmailLink(user.email);
      setSent(true);
    } catch (err) {
      setError(signInErrorMessage(err));
    } finally {
      setSending(false);
    }
  }
  return (
    <section className="panel narrow" aria-labelledby="confirm-title">
      <h1 id="confirm-title" tabIndex={-1}>Confirm your email address</h1>
      <p>We could not confirm your email address, {user.email}. Get a sign-in link by email to confirm it. You can then set up your organization.</p>
      {error ? <p className="message error" role="alert">{error}</p> : null}
      {sent ? (
        <p className="message success" role="status">We sent a sign-in link to {user.email}. Open it on this device.</p>
      ) : (
        <button type="button" className="button primary" disabled={sending} onClick={send}>{sending ? 'Sending link…' : 'Email me a link'}</button>
      )}
    </section>
  );
}

/** Pages for signed-in readers with a confirmed email address. */
function RequireAuth() {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <LoadingState long>Loading.</LoadingState>;
  if (!user?.emailVerified) rememberReturn(`${location.pathname}${location.search}${location.hash}`);
  if (!user) return <Navigate to="/signin" replace />;
  if (!user.emailVerified) return <ConfirmEmail user={user} />;
  return <Outlet />;
}

function NotFound() {
  return (
    <section className="panel narrow" aria-labelledby="missing-title">
      <h1 id="missing-title" tabIndex={-1}>Page not found</h1>
      <p><Link to="/">Go to your organizations</Link></p>
    </section>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/signin" element={<SignIn />} />
        <Route path="/signin/finish" element={<SignInFinish />} />
        <Route element={<RequireAuth />}>
          <Route path="/" element={<Organizations />} />
          <Route path="/organizations/:orgId" element={<OrganizationHome />} />
          <Route path="/organizations/:orgId/team" element={<Team />} />
          <Route path="/organizations/:orgId/applications/:appId" element={<ApplicationStatus />} />
          <Route path="/organizations/:orgId/applications/:appId/accepted-agreement" element={<AcceptedAgreement />} />
          <Route path="/organizations/:orgId/applications/:appId/:step" element={<Setup />} />
          <Route path="/connect/:provider/return" element={<ConnectReturn />} />
          <Route path="/invite/:inviteId" element={<AcceptInvite />} />
          <Route path="/start/:linkId" element={<StartEvent />} />
          <Route path="/review" element={<ReviewQueue />} />
          <Route path="/review/settings" element={<ConsoleSettings />} />
          <Route path="/review/links" element={<SignupLinks />} />
          <Route path="/review/:appId" element={<ReviewApplication />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}
