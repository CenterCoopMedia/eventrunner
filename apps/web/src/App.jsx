// App shell: the provider nesting from spec §2.4 —
// EventConfigProvider (outermost) > AuthProvider > ProfileProvider >
// ContentProvider > ToastProvider > routes. ProfileProvider sits directly
// inside AuthProvider because it subscribes to the signed-in user's own
// users/{uid} document (issue #17).
// The Router wraps everything in main.jsx (tests use MemoryRouter), so
// ContentProvider can later read search params via hooks.
import { Suspense, lazy } from 'react';
import { Route, Routes, useSearchParams } from 'react-router-dom';
import { EventConfigProvider } from './contexts/EventConfigContext.jsx';
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx';
import { ContentProvider } from './contexts/ContentContext.jsx';
import { ProfileProvider } from './contexts/ProfileContext.jsx';
import { ToastProvider } from './contexts/ToastContext.jsx';
import Layout from './components/Layout.jsx';
import ProfileSetupRedirect from './components/ProfileSetupRedirect.jsx';
import RouteTitle from './components/RouteTitle.jsx';
import ScrollReset from './components/ScrollReset.jsx';
import Home from './pages/Home.jsx';
import Login from './pages/Login.jsx';
import LoadingState from './components/LoadingState.jsx';
import ChunkErrorBoundary from './components/ChunkErrorBoundary.jsx';
import DeferredPage from './components/DeferredPage.jsx';
import { clearReloadFlag } from './lib/chunkReload.js';
import { SPECIMEN_ENABLED, SPECIMEN_PATH } from './pages/specimen/specimenRoute.js';

// Code-split the admin CMS out of the public bundle (issue #95): AdminApp
// and everything under src/admin/pages pull in the entire content-editing
// surface, which ordinary visitors never touch. Loading it lazily keeps that
// weight out of the chunk every visitor downloads on first paint.
// A load that succeeds spends the one-reload budget in lib/chunkReload.js, so
// the next deploy this tab lives through gets its own single recovery reload.
const AdminApp = lazy(() => import('./admin/AdminApp.jsx').then((module) => {
  clearReloadFlag();
  return module;
}));

function lazyPage(importer) {
  return lazy(() =>
    importer().then((module) => {
      clearReloadFlag();
      return module;
    }),
  );
}

const Schedule = lazyPage(() => import('./pages/Schedule.jsx'));
const SessionDetail = lazyPage(() => import('./pages/SessionDetail.jsx'));
const MySchedule = lazyPage(() => import('./pages/MySchedule.jsx'));
const SharedSchedule = lazyPage(() => import('./pages/SharedSchedule.jsx'));
const Speakers = lazyPage(() => import('./pages/Speakers.jsx'));
const SpeakerDetail = lazyPage(() => import('./pages/SpeakerDetail.jsx'));
const Sponsors = lazyPage(() => import('./pages/Sponsors.jsx'));
const Updates = lazyPage(() => import('./pages/Updates.jsx'));
const UpdateDetail = lazyPage(() => import('./pages/UpdateDetail.jsx'));
const ContentPage = lazyPage(() => import('./pages/ContentPage.jsx'));
const SpeakerAccept = lazyPage(() => import('./pages/SpeakerAccept.jsx'));
const SpeakerProfile = lazyPage(() => import('./pages/SpeakerProfile.jsx'));
const TicketClaim = lazyPage(() => import('./pages/TicketClaim.jsx'));
const Profile = lazyPage(() => import('./pages/Profile.jsx'));
const Attendees = lazyPage(() => import('./pages/Attendees.jsx'));
const AttendeeProfile = lazyPage(() => import('./pages/AttendeeProfile.jsx'));
const Dashboard = lazyPage(() => import('./pages/Dashboard.jsx'));

// The specimen book (design vocabulary expansion, §7): every device in
// every state, for review. It ships in the static demo and in a development
// server and nowhere else. SPECIMEN_ENABLED is an expression over two build
// constants, so a client production build folds this whole ternary to null
// and Rollup never emits the chunk.
const SpecimenPage = SPECIMEN_ENABLED
  ? lazyPage(() => import('./pages/specimen/Specimen.jsx'))
  : null;

export function AppRoutes() {
  return (
    <Routes>
      {/* The whole authenticated admin area lives under this one subtree —
          it brings its own shell, gate, and nested routes (admin/AdminApp).
          It sits ABOVE the Layout branch because the admin area brings its
          own chrome, and its 'admin' segment is reserved in
          shared/routing so a generic cmsPages path can never claim it. */}
      <Route
        path="admin/*"
        element={
          // The boundary sits OUTSIDE Suspense: a rejected dynamic import
          // surfaces as a thrown error at the lazy boundary, not as a
          // fallback, so a boundary inside Suspense would never see it.
          <ChunkErrorBoundary>
            <Suspense fallback={<LoadingState label="Loading admin…" />}>
              <AdminApp />
            </Suspense>
          </ChunkErrorBoundary>
        }
      />
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="schedule" element={<DeferredPage component={Schedule} label="schedule" />} />
        <Route path="schedule/mine" element={<DeferredPage component={MySchedule} label="your schedule" />} />
        {/* A shared personal schedule (issue #173): reads the projection of
            issue #172 — never users_public — and answers denial as privacy.
            It sits under the reserved `schedule` segment, beside /mine. */}
        <Route path="schedule/user/:uid" element={<DeferredPage component={SharedSchedule} label="shared schedule" />} />
        <Route path="schedule/:sessionId" element={<DeferredPage component={SessionDetail} label="session" />} />
        <Route path="speakers" element={<DeferredPage component={Speakers} label="speakers" />} />
        <Route path="speakers/:slug" element={<DeferredPage component={SpeakerDetail} label="speaker" />} />
        <Route path="sponsors" element={<DeferredPage component={Sponsors} label="sponsors" />} />
        <Route path="updates" element={<DeferredPage component={Updates} label="updates" />} />
        <Route path="updates/:id" element={<DeferredPage component={UpdateDetail} label="update" />} />
        <Route path="signin" element={<Login />} />
        {/* Speaker invite acceptance (issue #21). Singular `speaker`, and
            reserved in shared/routing alongside the plural directory route:
            every invitation email ever sent links here, so a generic
            cmsPages path must never be able to claim the segment. */}
        <Route path="speaker/accept" element={<DeferredPage component={SpeakerAccept} label="speaker invitation" />} />
        {/* The speaker profile wizard (issue #22): self-service editing of
            the caller's own speakers/{id} record, distinct from /profile
            (the attendee users/{uid} record). Sits under the same reserved
            `speaker` segment as speaker/accept, and speaker.accepted's CTA
            (functions/src/email/templates/speaker.accepted.cjs) links
            straight here. */}
        <Route path="speaker/profile" element={<DeferredPage component={SpeakerProfile} label="speaker profile" />} />
        {/* Self-service ticket claim (issue #33): every `ticket.claim_prompt`
            CTA (manual.cjs, eventbrite.cjs getRegistrationPrompt) links
            here. `ticket` is reserved in shared/routing alongside `speaker`,
            for the same reason — mail already sent with this link must
            keep working. */}
        <Route path="ticket/claim" element={<DeferredPage component={TicketClaim} label="ticket claim" />} />
        <Route path="profile" element={<DeferredPage component={Profile} label="profile" />} />
        {/* The signed-in attendee's home (issue #168): one place that shows
            their status, their sessions, and the event's resources. `dashboard`
            is reserved in shared/routing, so a generic cmsPages path can never
            claim the segment. */}
        <Route path="dashboard" element={<DeferredPage component={Dashboard} label="dashboard" />} />
        <Route path="attendees" element={<DeferredPage component={Attendees} label="attendees" />} />
        <Route path="attendees/:uid" element={<DeferredPage component={AttendeeProfile} label="attendee" />} />
        {SpecimenPage ? (
          <Route
            path={SPECIMEN_PATH}
            element={<DeferredPage component={SpecimenPage} label="specimen book" />}
          />
        ) : null}
        {/* Generic cmsPages route by their own root-level `path`
            (issue #52) — this catch-all matches whatever the system
            routes above didn't, and ContentPage looks the current
            location up against visible pages by full path, falling
            through to NotFound itself when nothing matches. It MUST
            stay the LAST route: react-router matches routes in order,
            and "*" matches everything. */}
        <Route path="*" element={<DeferredPage component={ContentPage} label="page" />} />
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
              {/* Beside the router, not inside a page: every route change
                  decides where the reader lands — the top of the new page,
                  or the element its fragment names, which React Router
                  resolves for nobody on a client navigation, and which on
                  these lazy routes does not exist yet when the navigation
                  happens (M7 issue 6). ContentPage's own filter reset is a
                  page's state and is left alone. */}
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
