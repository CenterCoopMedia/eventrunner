// App shell: the provider nesting from spec §2.4 —
// EventConfigProvider (outermost) > AuthProvider > ContentProvider >
// ToastProvider > routes. The Router wraps everything in main.jsx (tests use
// MemoryRouter), so ContentProvider can later read search params via hooks.
import { Route, Routes, useSearchParams } from 'react-router-dom';
import { EventConfigProvider } from './contexts/EventConfigContext.jsx';
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx';
import { ContentProvider } from './contexts/ContentContext.jsx';
import { ToastProvider } from './contexts/ToastContext.jsx';
import Layout from './components/Layout.jsx';
import Home from './pages/Home.jsx';
import Schedule from './pages/Schedule.jsx';
import Speakers from './pages/Speakers.jsx';
import Sponsors from './pages/Sponsors.jsx';
import ContentPage from './pages/ContentPage.jsx';
import Login from './pages/Login.jsx';
import NotFound from './pages/NotFound.jsx';
import AdminApp from './admin/AdminApp.jsx';

export function AppRoutes() {
  return (
    <Routes>
      {/* The whole authenticated admin area lives under this one subtree —
          it brings its own shell, gate, and nested routes (admin/AdminApp). */}
      <Route path="admin/*" element={<AdminApp />} />
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="schedule" element={<Schedule />} />
        <Route path="speakers" element={<Speakers />} />
        <Route path="sponsors" element={<Sponsors />} />
        <Route path="p/:slug" element={<ContentPage />} />
        <Route path="signin" element={<Login />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

// ?preview=1 alone must not be enough to select the draft read source: an
// admin who signs out with ?preview=1 still in the URL (a bookmarked/shared
// link, a stale tab) must not keep seeing draft overlays. isAdmin gates it —
// firestore.rules are still the real authorization boundary underneath, this
// is only which collection ContentProvider *asks* for. Needs to live inside
// AuthProvider, so it's a separate component rather than inline in App().
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
        <ContentGate>
          <ToastProvider>
            <AppRoutes />
          </ToastProvider>
        </ContentGate>
      </AuthProvider>
    </EventConfigProvider>
  );
}
