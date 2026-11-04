import { useEffect, useRef, useState } from 'react';
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import { AuthProvider, forgetReturn, rememberReturn, signInErrorMessage, useAuth } from './auth.jsx';
import AcceptInvite from './pages/AcceptInvite.jsx';
import ApplicationStatus from './pages/ApplicationStatus.jsx';
import OrganizationHome from './pages/OrganizationHome.jsx';
import Setup from './pages/setup/Setup.jsx';
import CreateOrganization from './pages/CreateOrganization.jsx';
import Organizations from './pages/Organizations.jsx';
import SignIn from './pages/SignIn.jsx';
import SignInFinish from './pages/SignInFinish.jsx';
import Team from './pages/Team.jsx';

const MARK = (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="mark">
    <rect x="2.5" y="2" width="3" height="20" />
    <rect x="5.5" y="2" width="16" height="3" />
    <rect x="5.5" y="11" width="9.5" height="2" />
    <rect x="5.5" y="19.5" width="13" height="2.5" />
  </svg>
);

/** A move to another page puts the focus on its heading; the first load does not. */
function useFocusHeadingOnNavigate() {
  const { pathname } = useLocation();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    document.querySelector('main h1')?.focus();
  }, [pathname]);
}

function Layout() {
  const { user, signOut } = useAuth();
  const { pathname } = useLocation();
  useFocusHeadingOnNavigate();

  useEffect(() => {
    if (user && !pathname.startsWith('/signin')) forgetReturn();
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
              <button type="button" className="button quiet" onClick={() => signOut()}>Sign out</button>
            </div>
          ) : null}
        </div>
      </header>
      <main id="main" tabIndex={-1} className="page">
        <Outlet />
      </main>
    </>
  );
}

/** Ask a reader whose email is not confirmed to confirm it with an emailed link. */
function ConfirmEmail({ user }) {
  const { sendEmailLink } = useAuth();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  async function send() {
    setError('');
    try {
      await sendEmailLink(user.email);
      setSent(true);
    } catch (err) {
      setError(signInErrorMessage(err));
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
        <button type="button" className="button primary" onClick={send}>Email me a link</button>
      )}
    </section>
  );
}

/** Pages for signed-in readers with a confirmed email address. */
function RequireAuth() {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <p role="status">Loading.</p>;
  if (!user) {
    rememberReturn(`${location.pathname}${location.search}${location.hash}`);
    return <Navigate to="/signin" replace />;
  }
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
          <Route path="/organizations/new" element={<CreateOrganization />} />
          <Route path="/organizations/:orgId" element={<OrganizationHome />} />
          <Route path="/organizations/:orgId/team" element={<Team />} />
          <Route path="/organizations/:orgId/applications/:appId" element={<ApplicationStatus />} />
          <Route path="/organizations/:orgId/applications/:appId/:step" element={<Setup />} />
          <Route path="/invite/:inviteId" element={<AcceptInvite />} />
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
