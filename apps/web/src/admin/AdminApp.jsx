// Admin area root — everything under /admin lives inside this one subtree, so
// App.jsx carries a single route for it (`<Route path="admin/*">`).
//
// Gating (client side, convenience only — functions/src/core/auth.cjs
// requireAdmin and firestore.rules are the enforcement):
//   • auth still loading → a loading state, never a flash of denial;
//   • signed out        → redirect to /signin, remembering where they were;
//   • signed in, not an admin → a plain denial, no retry affordance.
// "Admin" is exactly what AuthContext's admin probe reports: a read of an
// admin-only drafts collection, decided by firestore.rules isAdmin(), which
// is the same config/bootstrap + verified-email test the server's
// requireAdmin applies. Its tri-state (adminStatus) is what keeps the gate
// from answering before the probe has. Which TIER the admin holds is
// AdminLayout's concern: each docket item declares the tier it needs, and
// the layout hides the rest and refuses their routes (issue #186).
import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { AdminEmptyState, AdminLoadingState } from './components/adminChrome.jsx';
import AdminLayout from './AdminLayout.jsx';
import AdminPagesList from './pages/AdminPagesList.jsx';
import AdminPageEditor from './pages/AdminPageEditor.jsx';
import AdminSpeakersList from './pages/AdminSpeakersList.jsx';
import AdminSpeakerEditor from './pages/AdminSpeakerEditor.jsx';
import AdminContentPages from './pages/AdminContentPages.jsx';
import AdminContentSections from './pages/AdminContentSections.jsx';
import AdminContentSection from './pages/AdminContentSection.jsx';
import AdminFeatureSettings from './pages/AdminFeatureSettings.jsx';
import AdminBadgeSettings from './pages/AdminBadgeSettings.jsx';
import AdminMedia from './pages/AdminMedia.jsx';
import AdminLiveUpdates from './pages/AdminLiveUpdates.jsx';
import AdminFeedback from './pages/AdminFeedback.jsx';
import AdminSystemErrors from './pages/AdminSystemErrors.jsx';
import AdminTicketing from './pages/AdminTicketing.jsx';
import AdminAccess from './pages/AdminAccess.jsx';
import AdminWebMcpRegistration from '../webmcp/AdminWebMcpRegistration.jsx';

// The overview is the page the admin opens on (issue #179). Lazy like the
// sessions list, so its figures and panels stay out of the admin entry chunk
// (scripts/ci/bundle-budget.json).
const AdminOverview = lazy(() => import('./pages/AdminOverview.jsx'));
const AdminSessionsList = lazy(() => import('./pages/AdminSessionsList.jsx'));
const AdminSessionEditor = lazy(() => import('./pages/AdminSessionEditor.jsx'));
// Event settings is the largest page in this area — the whole config/event
// form plus the venue editor, which now carries the map panel and its
// markers. Statically imported it rode into the admin entry chunk that every
// other admin screen waits on, and the venue map pushed that chunk past the
// deferred ceiling (scripts/ci/bundle-budget.json). It is one screen behind
// one link, exactly like the session editor above, so it is loaded when
// somebody asks for it.
const AdminEventSettings = lazy(() => import('./pages/AdminEventSettings.jsx'));
// The block editor carries a form for every block type, and each new type
// (the fact and the quote, design wave 2) added its fields to the entry
// chunk. It opens from one link in a section list, so it loads the same way.
const AdminContentBlockEditor = lazy(() => import('./pages/AdminContentBlockEditor.jsx'));
// Branding is the largest page left in the entry chunk (the style picker,
// the option groups and the preview frame), and only an operator opens it.
const AdminBranding = lazy(() => import('./pages/AdminBranding.jsx'));
// The email log carries the preview frame and its document builder; it is
// one screen behind one link, so it waits for somebody to ask for it.
const AdminEmailLog = lazy(() => import('./pages/AdminEmailLog.jsx'));
// Attendees gained the export, the record panel, and the account delete
// (issues 184 and 185), and with them it pushed the entry chunk past the
// same ceiling. One screen behind one link, loaded the same way.
const AdminAttendees = lazy(() => import('./pages/AdminAttendees.jsx'));
// Change requests (issue #188): one screen behind one link, so it stays out
// of the entry chunk the same way.
const AdminChangeRequests = lazy(() => import('./pages/AdminChangeRequests.jsx'));
// Materials gained the table, the archive and the coverage panel (issue
// 189). One screen behind one link, loaded the same way.
const AdminMaterialsTab = lazy(() => import('./pages/AdminMaterialsTab.jsx'));
// The organizations list and editor (issue #192) load the same way.
const AdminOrganizationsList = lazy(() => import('./pages/AdminOrganizationsList.jsx'));
const AdminOrganizationEditor = lazy(() => import('./pages/AdminOrganizationEditor.jsx'));
// The updates list and editor (issue #190), loaded the same way.
const AdminUpdatesList = lazy(() => import('./pages/AdminUpdatesList.jsx'));
const AdminUpdateEditor = lazy(() => import('./pages/AdminUpdateEditor.jsx'));
// Version history (issue #195): the record list and one record's versions,
// with their formatters, load when somebody opens them.
const AdminVersionRecords = lazy(() => import('./pages/AdminVersionRecords.jsx'));
const AdminVersionHistory = lazy(() => import('./pages/AdminVersionHistory.jsx'));
// Unpublished changes (issue #196): its tables and publish runs load on
// demand; only the count and the banner that read it live in this chunk.
const AdminUnpublishedChanges = lazy(() => import('./pages/AdminUnpublishedChanges.jsx'));
// The timeline list and editor (issue #194) load the same way.
const AdminTimelineList = lazy(() => import('./pages/AdminTimelineList.jsx'));
const AdminTimelineEditor = lazy(() => import('./pages/AdminTimelineEditor.jsx'));

function DeferredAdminPage({ children, label }) {
  return <Suspense fallback={<AdminLoadingState label={`Loading ${label}…`} />}>{children}</Suspense>;
}

export function AdminGate({ children }) {
  const { user, adminStatus, loading } = useAuth();
  const location = useLocation();

  // Two waits, not one: `loading` is the auth handshake, and it finishes
  // BEFORE the admin probe answers. Rendering the denial in that gap would
  // flash "you don't have admin access" at every admin on every load.
  if (loading || (user && adminStatus === 'unknown')) {
    return (
      <div className="admin-room min-h-screen bg-admin-ground font-admin-ui text-admin-ink">
        <div className="mx-auto w-full max-w-3xl px-md py-lg">
          <AdminLoadingState label="Checking your access…" />
        </div>
      </div>
    );
  }
  if (!user) {
    // `from` records where they were headed. The sign-in page currently lands
    // everyone on the home page after a successful sign-in; carrying the
    // origin costs nothing and is what a "return to where you were" pass
    // would read.
    return (
      <Navigate
        to="/signin"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }
  if (adminStatus !== 'admin') {
    return (
      <div className="admin-room min-h-screen bg-admin-ground font-admin-ui text-admin-ink">
        <div className="mx-auto w-full max-w-3xl px-md py-lg">
          <AdminEmptyState
            title="You don’t have admin access"
            description="This area is limited to the event’s administrators. If you think that’s wrong, ask an organizer to add your address to the admin list."
          />
        </div>
      </div>
    );
  }
  return children;
}

export default function AdminApp() {
  return (
    <AdminGate>
      <AdminWebMcpRegistration />
      <Routes>
        <Route element={<AdminLayout />}>
          <Route index element={<Navigate to="overview" replace />} />
          <Route
            path="overview"
            element={<DeferredAdminPage label="overview"><AdminOverview /></DeferredAdminPage>}
          />
          <Route path="pages" element={<AdminPagesList />} />
          <Route path="pages/new" element={<AdminPageEditor mode="create" />} />
          <Route path="pages/:pageId" element={<AdminPageEditor mode="edit" />} />
          <Route
            path="sessions"
            element={<DeferredAdminPage label="sessions"><AdminSessionsList /></DeferredAdminPage>}
          />
          <Route
            path="sessions/new/session"
            element={<DeferredAdminPage label="session"><AdminSessionEditor mode="create" /></DeferredAdminPage>}
          />
          <Route
            path="sessions/:sessionId"
            element={<DeferredAdminPage label="session"><AdminSessionEditor mode="edit" /></DeferredAdminPage>}
          />
          <Route
            path="organizations"
            element={<DeferredAdminPage label="organizations"><AdminOrganizationsList /></DeferredAdminPage>}
          />
          {/* Two parts, 'new/organization': a document id holds no slash, so
              no organization, a legacy one included, can own this address. A
              single segment such as 'new' or '_new' is a valid id. */}
          <Route
            path="organizations/new/organization"
            element={<DeferredAdminPage label="organization"><AdminOrganizationEditor mode="create" /></DeferredAdminPage>}
          />
          <Route
            path="organizations/:organizationId"
            element={<DeferredAdminPage label="organization"><AdminOrganizationEditor mode="edit" /></DeferredAdminPage>}
          />
          <Route
            path="timeline"
            element={<DeferredAdminPage label="timeline"><AdminTimelineList /></DeferredAdminPage>}
          />
          {/* Two segments, so no entry id can shadow the create form, as
              sessions/new/session. */}
          <Route
            path="timeline/new/entry"
            element={<DeferredAdminPage label="entry"><AdminTimelineEditor mode="create" /></DeferredAdminPage>}
          />
          <Route
            path="timeline/:entryId"
            element={<DeferredAdminPage label="entry"><AdminTimelineEditor mode="edit" /></DeferredAdminPage>}
          />
          <Route path="speakers" element={<AdminSpeakersList />} />
          <Route path="speakers/new" element={<AdminSpeakerEditor mode="create" />} />
          <Route path="speakers/:speakerId" element={<AdminSpeakerEditor mode="edit" />} />
          <Route
            path="updates"
            element={<DeferredAdminPage label="updates"><AdminUpdatesList /></DeferredAdminPage>}
          />
          {/* 'new/update', not 'new': `new` is a valid update id, and the
              edit route for it would always open this creation form. */}
          <Route
            path="updates/new/update"
            element={<DeferredAdminPage label="update"><AdminUpdateEditor mode="create" /></DeferredAdminPage>}
          />
          <Route
            path="updates/:updateId"
            element={<DeferredAdminPage label="update"><AdminUpdateEditor mode="edit" /></DeferredAdminPage>}
          />
          <Route path="content" element={<AdminContentPages />} />
          <Route path="content/:pageId" element={<AdminContentSections />} />
          <Route path="content/:pageId/:sectionId" element={<AdminContentSection />} />
          {/* '_new', not 'new': a cmsContent field id may legitimately BE
              'new' (SECTION_FIELD_RE only requires an alnum first
              character), which would collide with a static 'new' segment —
              the edit route for that real field would then always resolve
              to this blank creation form instead, making the field
              uneditable. A leading underscore can never be a valid field
              id (the regex requires an alnum first character), so this
              route can never collide with one. */}
          <Route
            path="content/:pageId/:sectionId/_new"
            element={<DeferredAdminPage label="the block editor"><AdminContentBlockEditor mode="create" /></DeferredAdminPage>}
          />
          <Route
            path="content/:pageId/:sectionId/:field"
            element={<DeferredAdminPage label="the block editor"><AdminContentBlockEditor mode="edit" /></DeferredAdminPage>}
          />
          <Route
            path="settings"
            element={
              <DeferredAdminPage label="event settings">
                <AdminEventSettings />
              </DeferredAdminPage>
            }
          />
          <Route path="features" element={<AdminFeatureSettings />} />
          <Route path="badges" element={<AdminBadgeSettings />} />
          <Route path="branding" element={<DeferredAdminPage label="branding"><AdminBranding /></DeferredAdminPage>} />
          <Route path="media" element={<AdminMedia />} />
          <Route
            path="materials"
            element={<DeferredAdminPage label="materials"><AdminMaterialsTab /></DeferredAdminPage>}
          />
          <Route
            path="versions"
            element={<DeferredAdminPage label="version history"><AdminVersionRecords /></DeferredAdminPage>}
          />
          <Route
            path="versions/:collection/:docId"
            element={<DeferredAdminPage label="version history"><AdminVersionHistory /></DeferredAdminPage>}
          />
          <Route
            path="unpublished"
            element={<DeferredAdminPage label="unpublished changes"><AdminUnpublishedChanges /></DeferredAdminPage>}
          />
          <Route
            path="attendees"
            element={<DeferredAdminPage label="attendees"><AdminAttendees /></DeferredAdminPage>}
          />
          <Route path="ticketing" element={<AdminTicketing />} />
          <Route path="live-updates" element={<AdminLiveUpdates />} />
          <Route path="feedback" element={<AdminFeedback />} />
          <Route
            path="email-log"
            element={<DeferredAdminPage label="the email log"><AdminEmailLog /></DeferredAdminPage>}
          />
          <Route
            path="change-requests"
            element={<DeferredAdminPage label="change requests"><AdminChangeRequests /></DeferredAdminPage>}
          />
          <Route path="system-errors" element={<AdminSystemErrors />} />
          <Route path="access" element={<AdminAccess />} />
          <Route
            path="*"
            element={
              <AdminEmptyState
                title="Admin page not found"
                description="That admin screen doesn’t exist. Pick a section from the docket."
              />
            }
          />
        </Route>
      </Routes>
    </AdminGate>
  );
}
