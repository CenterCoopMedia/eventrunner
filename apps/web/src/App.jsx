// The Router wraps the providers in main.jsx (tests use MemoryRouter).
// ProfileProvider subscribes to the signed-in account inside AuthProvider.
import { useEffect } from 'react';
import { useLocation, useRoutes, useSearchParams } from 'react-router';
import { EventConfigProvider, useEventConfig } from './contexts/EventConfigContext.jsx';
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx';
import { ContentProvider } from './contexts/ContentContext.jsx';
import { ProfileProvider } from './contexts/ProfileContext.jsx';
import { ToastProvider } from './contexts/ToastContext.jsx';
import Layout from './components/Layout.jsx';
import LaunchGate from './components/LaunchGate.jsx';
import ProfileSetupRedirect from './components/ProfileSetupRedirect.jsx';
import RouteTitle from './components/RouteTitle.jsx';
import ScrollReset from './components/ScrollReset.jsx';
import Home from './pages/Home.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import DeferredPage from './components/DeferredPage.jsx';
import { adminRoute, publicRoutes, prefetchRoutes } from './routes.jsx';
import { installDeferredRoutePrefetch } from './lib/deferredRoutePrefetch.js';
import { IS_DEMO } from './lib/demoMode.js';
import FieldVitals from './components/FieldVitals.jsx';

export function AppRoutes() {
  useEffect(() => installDeferredRoutePrefetch(document, prefetchRoutes, IS_DEMO), []);
  return useRoutes([
    {
      path: adminRoute.path,
      element: (
        <ErrorBoundary appearance="admin" title="Admin could not open">
          <DeferredPage component={adminRoute.Component} label="admin" />
        </ErrorBoundary>
      ),
    },
    {
      element: <LaunchGate />,
      children: [{
        element: <Layout />,
        children: [
          { index: true, element: <Home /> },
          ...publicRoutes.map(({ path, Component, label, shape }) => ({
            path, element: <DeferredPage component={Component} shape={shape} label={label} />,
          })),
        ],
      }],
    },
  ]);
}

// Signing out with ?preview=1 must also stop draft reads. Firestore rules
// enforce access; this gate selects which source ContentProvider requests.
function ContentGate({ children }) {
  const { pathname, search } = useLocation();
  const [searchParams] = useSearchParams();
  const { isAdmin } = useAuth();
  const { features } = useEventConfig();
  const readSource =
    searchParams.get('preview') === '1' && isAdmin ? 'draft' : 'published';

  return (
    <ContentProvider readSource={readSource} pathname={pathname} search={search} publicTools={IS_DEMO || features.webmcpPublic === true}>
      {children}
    </ContentProvider>
  );
}

export default function App() {
  const { pathname, search } = useLocation();
  return (
    <EventConfigProvider pathname={pathname} search={search}>
      <FieldVitals />
      <AuthProvider>
        <ProfileProvider>
          <ContentGate>
            <ToastProvider>
              <ScrollReset />
              <ProfileSetupRedirect />
              <RouteTitle />
              <AppRoutes />
            </ToastProvider>
          </ContentGate>
        </ProfileProvider>
      </AuthProvider>
    </EventConfigProvider>
  );
}
