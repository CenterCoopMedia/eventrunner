// App shell: the provider nesting from spec §2.4 —
// EventConfigProvider (outermost) > AuthProvider > ContentProvider >
// ToastProvider > routes. The Router wraps everything in main.jsx (tests use
// MemoryRouter), so ContentProvider can later read search params via hooks.
import { Route, Routes, useSearchParams } from 'react-router-dom';
import { EventConfigProvider } from './contexts/EventConfigContext.jsx';
import { AuthProvider } from './contexts/AuthContext.jsx';
import { ContentProvider } from './contexts/ContentContext.jsx';
import { ToastProvider } from './contexts/ToastContext.jsx';
import Layout from './components/Layout.jsx';
import Home from './pages/Home.jsx';
import Schedule from './pages/Schedule.jsx';
import Speakers from './pages/Speakers.jsx';
import Sponsors from './pages/Sponsors.jsx';
import ContentPage from './pages/ContentPage.jsx';
import SignIn from './pages/SignIn.jsx';
import NotFound from './pages/NotFound.jsx';

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="schedule" element={<Schedule />} />
        <Route path="speakers" element={<Speakers />} />
        <Route path="sponsors" element={<Sponsors />} />
        <Route path="p/:slug" element={<ContentPage />} />
        <Route path="signin" element={<SignIn />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  // ?preview=1 is convenience only — firestore.rules decide who may actually
  // read the *_drafts collections (spec §2.4).
  const [searchParams] = useSearchParams();
  const readSource = searchParams.get('preview') === '1' ? 'draft' : 'published';

  return (
    <EventConfigProvider>
      <AuthProvider>
        <ContentProvider readSource={readSource}>
          <ToastProvider>
            <AppRoutes />
          </ToastProvider>
        </ContentProvider>
      </AuthProvider>
    </EventConfigProvider>
  );
}
