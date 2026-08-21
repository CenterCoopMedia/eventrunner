// App shell: the provider nesting from spec §2.4 —
// EventConfigProvider (outermost) > AuthProvider > ProfileProvider >
// ContentProvider > ToastProvider > routes. ProfileProvider sits directly
// inside AuthProvider because it subscribes to the signed-in user's own
// users/{uid} document (issue #17).
// The Router wraps everything in main.jsx (tests use MemoryRouter), so
// ContentProvider can later read search params via hooks.
import { Route, Routes, useSearchParams } from 'react-router-dom';
import { EventConfigProvider } from './contexts/EventConfigContext.jsx';
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx';
import { ContentProvider } from './contexts/ContentContext.jsx';
import { ProfileProvider } from './contexts/ProfileContext.jsx';
import { ToastProvider } from './contexts/ToastContext.jsx';
import Layout from './components/Layout.jsx';
import ProfileSetupRedirect from './components/ProfileSetupRedirect.jsx';
import Home from './pages/Home.jsx';
import Schedule from './pages/Schedule.jsx';
import SessionDetail from './pages/SessionDetail.jsx';
import MySchedule from './pages/MySchedule.jsx';
import Speakers from './pages/Speakers.jsx';
import Sponsors from './pages/Sponsors.jsx';
import ContentPage from './pages/ContentPage.jsx';
import Login from './pages/Login.jsx';
import Profile from './pages/Profile.jsx';
import Attendees from './pages/Attendees.jsx';
import AttendeeProfile from './pages/AttendeeProfile.jsx';

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="schedule" element={<Schedule />} />
        <Route path="schedule/mine" element={<MySchedule />} />
        <Route path="schedule/:sessionId" element={<SessionDetail />} />
        <Route path="speakers" element={<Speakers />} />
        <Route path="sponsors" element={<Sponsors />} />
        <Route path="signin" element={<Login />} />
        <Route path="profile" element={<Profile />} />
        <Route path="attendees" element={<Attendees />} />
        <Route path="attendees/:uid" element={<AttendeeProfile />} />
        {/* Generic cmsPages route by their own root-level `path`
            (issue #52) — this catch-all matches whatever the system
            routes above didn't, and ContentPage looks the current
            location up against visible pages by full path, falling
            through to NotFound itself when nothing matches. It MUST
            stay the LAST route: react-router matches routes in order,
            and "*" matches everything. */}
        <Route path="*" element={<ContentPage />} />
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
        <ProfileProvider>
          <ContentGate>
            <ToastProvider>
              <ProfileSetupRedirect />
              <AppRoutes />
            </ToastProvider>
          </ContentGate>
        </ProfileProvider>
      </AuthProvider>
    </EventConfigProvider>
  );
}
