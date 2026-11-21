// Admin area root — everything under /admin lives inside this one subtree, so
// App.jsx carries a single route for it (`<Route path="admin/*">`).
//
// Gating (client side, convenience only — functions/src/core/auth.cjs
// requireAdmin and firestore.rules are the enforcement):
//   • auth still loading → a loading state, never a flash of denial;
//   • signed out        → redirect to /signin, remembering where they were;
//   • access check fails → explain the failed check and let the user retry;
//   • signed in, not an admin → a plain denial, no retry affordance.
// "Admin" is exactly what AuthContext's admin probe reports: a read of an
// admin-only drafts collection, decided by firestore.rules isAdmin(), which
// is the same config/bootstrap + verified-email test the server's
// requireAdmin applies. Its tri-state (adminStatus) is what keeps the gate
// from answering before the probe has. Which TIER the admin holds is
// AdminLayout's concern: each docket item declares the tier it needs, and
// the layout hides the rest and refuses their routes (issue #186).
import { Fragment, Suspense, useContext, useEffect, useState } from 'react';
import { lazyPage as lazy } from '../lib/routePage.jsx';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import { clearReloadFlag } from '../lib/chunkReload.js';
import { RouteLoadingContext, RouteLoadingReady, useRouteLoadingAttempt } from '../lib/routeLoading.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { AdminEmptyState, AdminLoadingState } from './components/adminChrome.jsx';
import { secondaryButtonClass } from './components/formControls.jsx';
import AdminLayout, { AdminRecoveryReadyContext } from './AdminLayout.jsx';
import ErrorBoundary from '../components/ErrorBoundary.jsx';
import AdminSpeakersList from './pages/AdminSpeakersList.jsx';
import AdminSpeakerEditor from './pages/AdminSpeakerEditor.jsx';
import AdminContentSections from './pages/AdminContentSections.jsx';
import AdminFeatureSettings from './pages/AdminFeatureSettings.jsx';
import AdminLiveUpdates from './pages/AdminLiveUpdates.jsx';
import AdminFeedback from './pages/AdminFeedback.jsx';
import AdminSystemErrors from './pages/AdminSystemErrors.jsx';
import AdminAccess from './pages/AdminAccess.jsx';
import AdminWebMcpRegistration from '../webmcp/AdminWebMcpRegistration.jsx';

// The overview is the page the admin opens on (issue #179). Lazy like the
// sessions list, so its figures and panels stay out of the admin entry chunk
// (scripts/ci/bundle-budget.json).
const AdminSessionPitches = lazy(() => import('./pages/AdminSessionPitches.jsx'), 'AdminSessionPitches');
const AdminPagesList = lazy(() => import('./pages/AdminPagesList.jsx'), 'AdminPagesList');
const AdminPageEditor = lazy(() => import('./pages/AdminPageEditor.jsx'), 'AdminPageEditor');
const AdminNavigationLinkEditor = lazy(() => import('./pages/AdminNavigationLinkEditor.jsx'), 'AdminNavigationLinkEditor');
const AdminWebAddress = lazy(() => import('./pages/AdminWebAddress.jsx'), 'AdminWebAddress');
const AdminSessionPitch = lazy(() => import('./pages/AdminSessionPitch.jsx'), 'AdminSessionPitch');
const AdminPitchSettings = lazy(() => import('./pages/AdminPitchSettings.jsx'), 'AdminPitchSettings');
const AdminRegistrationForm = lazy(() => import('./pages/AdminRegistrationForm.jsx'), 'AdminRegistrationForm');
const AdminBadgeSettings = lazy(() => import('./pages/AdminBadgeSettings.jsx'), 'AdminBadgeSettings');
const AdminPitchImport = lazy(() => import('./pages/AdminPitchImport.jsx'), 'AdminPitchImport');
const AdminSpeakerReminders = lazy(() => import('./pages/AdminSpeakerReminders.jsx'), 'AdminSpeakerReminders');
// Scheduled reminders (issue #518): one screen behind one link.
const AdminReminderSchedules = lazy(() => import('./pages/AdminReminderSchedules.jsx'), 'AdminReminderSchedules');
const AdminSpeakerMail = lazy(() => import('./pages/AdminSpeakerMail.jsx'), 'AdminSpeakerMail');
const AdminOverview = lazy(() => import('./pages/AdminOverview.jsx'), 'AdminOverview');
const AdminSetup = lazy(() => import('./pages/AdminSetup.jsx'), 'AdminSetup');
const AdminSessionsList = lazy(() => import('./pages/AdminSessionsList.jsx'), 'AdminSessionsList');
const AdminSessionEditor = lazy(() => import('./pages/AdminSessionEditor.jsx'), 'AdminSessionEditor');
// Event settings is the largest page in this area — the whole config/event
// form plus the venue editor, which now carries the map panel and its
// markers. Statically imported it rode into the admin entry chunk that every
// other admin screen waits on, and the venue map pushed that chunk past the
// deferred ceiling (scripts/ci/bundle-budget.json). It is one screen behind
// one link, exactly like the session editor above, so it is loaded when
// somebody asks for it.
const AdminEventSettings = lazy(() => import('./pages/AdminEventSettings.jsx'), 'AdminEventSettings');
// Lazy, as the other large pages: with its sync and account actions the page
// put the admin entry chunk over the lazy-chunk budget.
const AdminTicketing = lazy(() => import('./pages/AdminTicketing.jsx'), 'AdminTicketing');
const AdminContentSection = lazy(() => import('./pages/AdminContentSection.jsx'), 'AdminContentSection');
const AdminMedia = lazy(() => import('./pages/AdminMedia.jsx'), 'AdminMedia');
// The block editor carries a form for every block type, and each new type
// (the fact and the quote, design wave 2) added its fields to the entry
// chunk. It opens from one link in a section list, so it loads the same way.
const AdminContentBlockEditor = lazy(() => import('./pages/AdminContentBlockEditor.jsx'), 'AdminContentBlockEditor');
const AdminContentPages = lazy(() => import('./pages/AdminContentPages.jsx'), 'AdminContentPages');
// Branding is the largest page left in the entry chunk (the style picker,
// the option groups and the preview frame), and only an operator opens it.
const AdminBranding = lazy(() => import('./pages/AdminBranding.jsx'), 'AdminBranding');
// Data export (issue #329) is one link in the System group.
const AdminDataExport = lazy(() => import('./pages/AdminDataExport.jsx'), 'AdminDataExport');
// The email log carries the preview frame and its document builder; it is
// one screen behind one link, so it waits for somebody to ask for it.
const AdminEmailLog = lazy(() => import('./pages/AdminEmailLog.jsx'), 'AdminEmailLog');
// Attendees gained the export, the record panel, and the account delete
// (issues 184 and 185), and with them it pushed the entry chunk past the
// same ceiling. One screen behind one link, loaded the same way.
const AdminAttendees = lazy(() => import('./pages/AdminAttendees.jsx'), 'AdminAttendees');
// Change requests (issue #188): one screen behind one link, so it stays out
// of the entry chunk the same way.
const AdminChangeRequests = lazy(() => import('./pages/AdminChangeRequests.jsx'), 'AdminChangeRequests');
const AdminFeedModeration = lazy(() => import('./pages/AdminFeedModeration.jsx'), 'AdminFeedModeration');
// Materials gained the table, the archive and the coverage panel (issue
// 189). One screen behind one link, loaded the same way.
const AdminMaterialsTab = lazy(() => import('./pages/AdminMaterialsTab.jsx'), 'AdminMaterialsTab');
// The organizations list and editor (issue #192) load the same way.
const AdminOrganizationsList = lazy(() => import('./pages/AdminOrganizationsList.jsx'), 'AdminOrganizationsList');
const AdminOrganizationEditor = lazy(() => import('./pages/AdminOrganizationEditor.jsx'), 'AdminOrganizationEditor');
// Import records (speakers, sessions and organizations from a CSV): one
// screen behind one link, loaded the same way.
const AdminRecordImport = lazy(() => import('./pages/AdminRecordImport.jsx'), 'AdminRecordImport');
// The updates list and editor (issue #190), loaded the same way.
const AdminUpdatesList = lazy(() => import('./pages/AdminUpdatesList.jsx'), 'AdminUpdatesList');
const AdminUpdateEditor = lazy(() => import('./pages/AdminUpdateEditor.jsx'), 'AdminUpdateEditor');
// Version history (issue #195): the record list and one record's versions,
// with their formatters, load when somebody opens them.
const AdminVersionRecords = lazy(() => import('./pages/AdminVersionRecords.jsx'), 'AdminVersionRecords');
const AdminVersionHistory = lazy(() => import('./pages/AdminVersionHistory.jsx'), 'AdminVersionHistory');
// Unpublished changes (issue #196): its tables and publish runs load on
// demand; only the count and the banner that read it live in this chunk.
const AdminUnpublishedChanges = lazy(() => import('./pages/AdminUnpublishedChanges.jsx'), 'AdminUnpublishedChanges');
// The timeline list and editor (issue #194) load the same way.
const AdminTimelineList = lazy(() => import('./pages/AdminTimelineList.jsx'), 'AdminTimelineList');
const AdminTimelineEditor = lazy(() => import('./pages/AdminTimelineEditor.jsx'), 'AdminTimelineEditor');
// Invoices (issue #208): the list, the editor and the settings page load
// when somebody opens them, the same way.
const AdminInvoicesList = lazy(() => import('./pages/AdminInvoicesList.jsx'), 'AdminInvoicesList');
const AdminInvoiceEditor = lazy(() => import('./pages/AdminInvoiceEditor.jsx'), 'AdminInvoiceEditor');
const AdminInvoiceSettings = lazy(() => import('./pages/AdminInvoiceSettings.jsx'), 'AdminInvoiceSettings');
// Announcements (issues #202, #203): the banner editor, the email composer,
// its saved messages and its send history load when somebody opens them.
const AdminAnnouncements = lazy(() => import('./pages/AdminAnnouncements.jsx'), 'AdminAnnouncements');

function DeferredAdminPage({ children, label }) {
  const routeAttempt = useRouteLoadingAttempt();
  return (
    <Suspense fallback={<AdminLoadingState label={`Loading ${label}…`} routeAttempt={routeAttempt} />}>
      <RouteLoadingReady>{children}</RouteLoadingReady>
    </Suspense>
  );
}

// A static leaf can re-arm recovery after its children commit and the shell's
// required tour code succeeds. Pending or failed code keeps the reload attempt.
function StaticAdminPage({ children }) {
  const { key } = useLocation();
  const ready = useContext(AdminRecoveryReadyContext);
  useRouteLoadingAttempt(true);
  useEffect(() => { if (ready) clearReloadFlag(); }, [key, ready]);
  return children;
}

function AdminPageBoundary() {
  const attempt = useRouteLoadingAttempt();
  return (
    <ErrorBoundary appearance="admin" title="This admin page could not be shown"
      onFailure={() => { if (attempt) attempt.settled = true; }}>
      <Outlet />
    </ErrorBoundary>
  );
}

function RecordRoute({ children }) {
  const { pathname } = useLocation();
  return <Fragment key={pathname}>{children}</Fragment>;
}

export function AdminGate({ children }) {
  const { user, adminStatus, adminCheckFailed, loading, refreshAdminStatus } = useAuth();
  const location = useLocation();
  const checkingAccess = loading || (user && adminStatus === 'unknown');
  const routeAttempt = useRouteLoadingAttempt(!checkingAccess && (!user || adminStatus !== 'admin'));

  // Two waits, not one: `loading` is the auth handshake, and it finishes
  // BEFORE the admin probe answers. Rendering the denial in that gap would
  // flash "you don't have admin access" at every admin on every load.
  if (checkingAccess) {
    return (
      <div className="admin-room min-h-screen min-h-svh bg-admin-ground font-admin-ui text-admin-ink">
        <div className="w-full px-md py-lg">
          <AdminLoadingState label="Checking your access…" routeAttempt={routeAttempt} />
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
      <div className="admin-room min-h-screen min-h-svh bg-admin-ground font-admin-ui text-admin-ink">
        <div className="w-full px-md py-lg">
          {adminCheckFailed ? (
            <AdminEmptyState
              title="We could not check your admin access"
              description="Check your connection and try again."
              action={<button type="button" className={secondaryButtonClass} onClick={refreshAdminStatus}>Check again</button>}
            />
          ) : (
            <AdminEmptyState
              title="You don’t have admin access"
              description="This area is limited to the event’s administrators. If you think that’s wrong, ask an organizer to add your address to the admin list."
            />
          )}
        </div>
      </div>
    );
  }
  return children;
}

export default function AdminApp({ routeAttempt }) {
  const { pathname } = useLocation();
  // The admin index redirects lead into the same pending navigation.
  const key = pathname.replace(/^\/admin(?:\/(reminders))?\/?$/, (_, reminders) =>
    reminders ? '/admin/reminders/scheduled' : '/admin/overview');
  const [route, setRoute] = useState(() => ({ key, attempt: routeAttempt }));
  if (route.key !== key) setRoute({ key, attempt: routeAttempt });
  const page = (
    <AdminGate>
      <AdminWebMcpRegistration />
      <Routes>
        <Route element={<AdminLayout />}>
          <Route element={<AdminPageBoundary />}>
          <Route index element={<Navigate to="overview" replace />} />
          <Route
            path="overview"
            element={<DeferredAdminPage label="overview"><AdminOverview /></DeferredAdminPage>}
          />
          <Route
            path="setup"
            element={<DeferredAdminPage label="setup steps"><AdminSetup /></DeferredAdminPage>}
          />
          <Route
            path="setup/:stepSlug"
            element={<DeferredAdminPage label="setup steps"><AdminSetup /></DeferredAdminPage>}
          />
          <Route path="pitches" element={<DeferredAdminPage label="session pitches"><AdminSessionPitches /></DeferredAdminPage>} />
          <Route path="pitches/settings" element={<DeferredAdminPage label="pitch call settings"><AdminPitchSettings /></DeferredAdminPage>} />
          <Route path="pitches/import" element={<DeferredAdminPage label="pitch import"><AdminPitchImport /></DeferredAdminPage>} />
          <Route path="pitches/:pitchId" element={<DeferredAdminPage label="session pitch"><AdminSessionPitch /></DeferredAdminPage>} />
          <Route path="pages" element={<DeferredAdminPage label="pages"><AdminPagesList /></DeferredAdminPage>} />
          <Route path="pages/new" element={<DeferredAdminPage label="page editor"><AdminPageEditor mode="create" /></DeferredAdminPage>} />
          <Route path="pages/links/:linkId" element={<DeferredAdminPage label="navigation link editor"><AdminNavigationLinkEditor /></DeferredAdminPage>} />
          <Route path="pages/:pageId" element={<DeferredAdminPage label="page editor"><AdminPageEditor mode="edit" /></DeferredAdminPage>} />
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
          <Route path="speakers" element={<StaticAdminPage><AdminSpeakersList /></StaticAdminPage>} />
          <Route path="speakers/new" element={<StaticAdminPage><RecordRoute><AdminSpeakerEditor mode="create" /></RecordRoute></StaticAdminPage>} />
          {/* Two segments, so no speaker id can shadow it: an id holds no slash. */}
          <Route
            path="speakers/reminders/send"
            element={<DeferredAdminPage label="speaker reminders"><AdminSpeakerReminders /></DeferredAdminPage>}
          />
          <Route
            path="speakers/mail/wording"
            element={<DeferredAdminPage label="speaker email wording"><AdminSpeakerMail /></DeferredAdminPage>}
          />
          <Route path="speakers/:speakerId" element={<StaticAdminPage><RecordRoute><AdminSpeakerEditor mode="edit" /></RecordRoute></StaticAdminPage>} />
          {/* The rail links to the section; the attendee schedule (#518)
              joins the same page, so the section opens on it. */}
          <Route path="reminders" element={<Navigate to="scheduled" replace />} />
          <Route
            path="reminders/scheduled"
            element={<DeferredAdminPage label="scheduled reminders"><AdminReminderSchedules /></DeferredAdminPage>}
          />
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
          <Route path="content" element={<DeferredAdminPage label="content"><AdminContentPages /></DeferredAdminPage>} />
          <Route path="content/:pageId" element={<StaticAdminPage><AdminContentSections /></StaticAdminPage>} />
          <Route path="content/:pageId/:sectionId" element={<DeferredAdminPage label="section content"><RecordRoute><AdminContentSection /></RecordRoute></DeferredAdminPage>} />
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
            element={<DeferredAdminPage label="the block editor"><RecordRoute><AdminContentBlockEditor mode="create" /></RecordRoute></DeferredAdminPage>}
          />
          <Route
            path="content/:pageId/:sectionId/:field"
            element={<DeferredAdminPage label="the block editor"><RecordRoute><AdminContentBlockEditor mode="edit" /></RecordRoute></DeferredAdminPage>}
          />
          <Route
            path="settings"
            element={
              <DeferredAdminPage label="event settings">
                <AdminEventSettings />
              </DeferredAdminPage>
            }
          />
          <Route path="features" element={<StaticAdminPage><AdminFeatureSettings /></StaticAdminPage>} />
          <Route path="badges" element={<DeferredAdminPage label="badges"><AdminBadgeSettings /></DeferredAdminPage>} />
          <Route path="registration-form" element={<DeferredAdminPage label="registration form"><AdminRegistrationForm /></DeferredAdminPage>} />
          <Route path="branding" element={<DeferredAdminPage label="branding"><AdminBranding /></DeferredAdminPage>} />
          <Route path="media" element={<DeferredAdminPage label="the media library"><AdminMedia /></DeferredAdminPage>} />
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
          <Route
            path="ticketing"
            element={<DeferredAdminPage label="ticketing"><AdminTicketing /></DeferredAdminPage>}
          />
          <Route
            path="invoices"
            element={<DeferredAdminPage label="invoices"><AdminInvoicesList /></DeferredAdminPage>}
          />
          {/* Two segments, as sessions/new/session. An invoice id starts
              with inv_, so neither this nor 'settings' can be an id. */}
          <Route
            path="invoices/new/invoice"
            element={<DeferredAdminPage label="invoice"><AdminInvoiceEditor mode="create" /></DeferredAdminPage>}
          />
          <Route
            path="invoices/settings"
            element={<DeferredAdminPage label="invoice settings"><AdminInvoiceSettings /></DeferredAdminPage>}
          />
          <Route
            path="invoices/:invoiceId"
            element={<DeferredAdminPage label="invoice"><AdminInvoiceEditor mode="edit" /></DeferredAdminPage>}
          />
          <Route
            path="import"
            element={<DeferredAdminPage label="the record import"><AdminRecordImport /></DeferredAdminPage>}
          />
          <Route path="live-updates" element={<StaticAdminPage><AdminLiveUpdates /></StaticAdminPage>} />
          <Route
            path="announcements"
            element={<DeferredAdminPage label="announcements"><AdminAnnouncements /></DeferredAdminPage>}
          />
          <Route path="feedback" element={<StaticAdminPage><AdminFeedback /></StaticAdminPage>} />
          <Route
            path="feed-moderation"
            element={<DeferredAdminPage label="feed moderation"><AdminFeedModeration /></DeferredAdminPage>}
          />
          <Route
            path="email-log"
            element={<DeferredAdminPage label="the email log"><AdminEmailLog /></DeferredAdminPage>}
          />
          <Route
            path="change-requests"
            element={<DeferredAdminPage label="change requests"><AdminChangeRequests /></DeferredAdminPage>}
          />
          <Route
            path="data-export"
            element={<DeferredAdminPage label="data export"><AdminDataExport /></DeferredAdminPage>}
          />
          <Route path="system-errors" element={<StaticAdminPage><AdminSystemErrors /></StaticAdminPage>} />
          <Route path="access" element={<StaticAdminPage><AdminAccess /></StaticAdminPage>} />
          <Route path="web-address" element={<DeferredAdminPage label="web address"><AdminWebAddress /></DeferredAdminPage>} />
          <Route
            path="*"
            element={
              <StaticAdminPage><AdminEmptyState
                title="Admin page not found"
                description="That admin screen doesn’t exist. Pick a section from the docket."
              /></StaticAdminPage>
            }
          />
          </Route>
        </Route>
      </Routes>
    </AdminGate>
  );
  return <RouteLoadingContext.Provider value={route.attempt}>{page}</RouteLoadingContext.Provider>;
}
