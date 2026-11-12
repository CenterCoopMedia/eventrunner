// The Router wraps the providers in main.jsx (tests use MemoryRouter).
// ProfileProvider subscribes to the signed-in account inside AuthProvider.
import { useEffect } from 'react';
import { useRoutes, useSearchParams } from 'react-router';
import { EventConfigProvider } from './contexts/EventConfigContext.jsx';
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
import { routePage } from './lib/routePage.jsx';
import { installRoutePrefetch } from './lib/routePrefetch.js';
import { IS_DEMO } from './lib/demoMode.js';

// The route table is needed only beyond home or after explicit link intent.
// Loading only the table must not re-arm recovery for a page that keeps
// failing after a reload. The final route owns that reset when it mounts.
const routedPages = routePage(() => import('./routes.jsx'), { resetReloadBudget: false });
const RoutedPages = routedPages.Component;
function AdminPages() {
  return <RoutedPages admin />;
}
function prefetchPath(pathname) {
  routedPages.prefetch().then((module) => module?.prefetchPath(pathname));
}

export function AppRoutes() {
  useEffect(() => installRoutePrefetch(document, prefetchPath, { hashRouter: IS_DEMO }), []);
  return useRoutes([
    {
      path: 'admin/*',
      element: (
        <ErrorBoundary appearance="admin" title="Admin could not open">
          <DeferredPage component={AdminPages} label="admin" />
        </ErrorBoundary>
      ),
    },
    {
      element: <LaunchGate />,
      children: [{
        element: <Layout />,
        children: [
          { index: true, element: <Home /> },
          { path: '*', element: <DeferredPage component={RoutedPages} label="page" /> },
        ],
      }],
    },
  ]);
}

// Signing out with ?preview=1 must also stop draft reads. Firestore rules
// enforce access; this gate selects which source ContentProvider requests.
function ContentGate({ children }) {
  const [searchParams] = useSearchParams();
  const { isAdmin } = useAuth();
  const readSource =
    searchParams.get('preview') === '1' && isAdmin ? 'draft' : 'published';

  return <ContentProvider readSource={readSource}>{children}</ContentProvider>;
}

export default function App() {
  return (
    <EventConfigProvider>
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
