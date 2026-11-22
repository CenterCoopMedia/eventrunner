// The Router wraps the providers in main.jsx (tests use MemoryRouter).
// ProfileProvider subscribes to the signed-in account inside AuthProvider.
import { useEffect } from 'react';
import { useLocation, useRoutes, useSearchParams } from 'react-router';
import { EventConfigProvider, useEventConfig } from './contexts/EventConfigContext.jsx';
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx';
import { ContentProvider } from './contexts/ContentContext.jsx';
import { mayHaveSpanish, PublicLanguageProvider } from './contexts/PublicLanguageProvider.jsx';
import { ProfileProvider } from './contexts/ProfileContext.jsx';
import { ToastProvider } from './contexts/ToastContext.jsx';
import Layout from './components/Layout.jsx';
import LaunchGate from './components/LaunchGate.jsx';
import ProfileSetupRedirect from './components/ProfileSetupRedirect.jsx';
import RouteTitle from '@route-title';
import ScrollReset from './components/ScrollReset.jsx';
import Home from './pages/Home.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import DeferredPage from './components/DeferredPage.jsx';
import { BlockRecoveryContext } from './components/blocks/registry.jsx';
import { adminRoute, publicRoutes, prefetchRoutes } from './routes.jsx';
import { installDeferredRoutePrefetch } from './lib/deferredRoutePrefetch.js';
import { IS_DEMO } from './lib/demoMode.js';
import FieldVitals from './components/FieldVitals.jsx';

export function AppRoutes() {
  const { pathname } = useLocation();
  useEffect(() => installDeferredRoutePrefetch(document, prefetchRoutes, IS_DEMO), []);
  return useRoutes([
    {
      path: adminRoute.path,
      element: (
        <ErrorBoundary appearance="admin" title="Admin could not open">
          <DeferredPage component={adminRoute.Component} label="admin" routeKey={pathname} figure="ring" />
        </ErrorBoundary>
      ),
    },
    {
      element: <LaunchGate />,
      children: [{
        element: <BlockRecoveryContext.Provider value><Layout /></BlockRecoveryContext.Provider>,
        children: [
          { index: true, element: <Home /> },
          ...publicRoutes.map(({ path, Component, label, shape }) => ({
            path, element: <DeferredPage component={Component} shape={shape} label={label}
              recover={path === '*' || /^(schedule|speakers|sponsors|updates|pitch|tickets?|registration|attendees)(\/|$)/.test(path)}
              routeKey={(path === 'schedule/mine' || path === 'tickets/mine' || path === 'ticket/claim') && pathname} />,
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
  const { eventConfig, features } = useEventConfig();
  const readSource =
    searchParams.get('preview') === '1' && isAdmin ? 'draft' : 'published';

  return (
    <ContentProvider readSource={readSource} pathname={pathname} search={search} publicTools={IS_DEMO || features.webmcpPublic === true}
      languageNeedsSchedule={features.schedule && mayHaveSpanish(eventConfig)}>
      <FieldVitals />
      {children}
    </ContentProvider>
  );
}

export default function App() {
  const { pathname, search } = useLocation();
  return (
    <EventConfigProvider pathname={pathname} search={search}>
      <AuthProvider>
        <ProfileProvider>
          <ContentGate>
            <PublicLanguageProvider>
              <ToastProvider>
                <ScrollReset />
                <ProfileSetupRedirect />
                <RouteTitle />
                <AppRoutes />
              </ToastProvider>
            </PublicLanguageProvider>
          </ContentGate>
        </ProfileProvider>
      </AuthProvider>
    </EventConfigProvider>
  );
}
