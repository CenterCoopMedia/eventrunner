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
// is the same config/bootstrap.adminEmails + verified-email test the server's
// requireAdmin applies. Its tri-state (adminStatus) is what keeps the gate
// from answering before the probe has.
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import AdminLayout from './AdminLayout.jsx';
import AdminPagesList from './pages/AdminPagesList.jsx';
import AdminPageEditor from './pages/AdminPageEditor.jsx';
import AdminSpeakersList from './pages/AdminSpeakersList.jsx';
import AdminSpeakerEditor from './pages/AdminSpeakerEditor.jsx';
import AdminContentPages from './pages/AdminContentPages.jsx';
import AdminContentSections from './pages/AdminContentSections.jsx';
import AdminContentSection from './pages/AdminContentSection.jsx';
import AdminContentBlockEditor from './pages/AdminContentBlockEditor.jsx';
import AdminEventSettings from './pages/AdminEventSettings.jsx';
import AdminFeatureSettings from './pages/AdminFeatureSettings.jsx';
import AdminBadgeSettings from './pages/AdminBadgeSettings.jsx';
import AdminBranding from './pages/AdminBranding.jsx';
import AdminMedia from './pages/AdminMedia.jsx';
import AdminMaterialsTab from './pages/AdminMaterialsTab.jsx';
import AdminAttendees from './pages/AdminAttendees.jsx';
import AdminLiveUpdates from './pages/AdminLiveUpdates.jsx';
import AdminFeedback from './pages/AdminFeedback.jsx';
import AdminSystemErrors from './pages/AdminSystemErrors.jsx';

export function AdminGate({ children }) {
  const { user, adminStatus, loading } = useAuth();
  const location = useLocation();

  // Two waits, not one: `loading` is the auth handshake, and it finishes
  // BEFORE the admin probe answers. Rendering the denial in that gap would
  // flash "you don't have admin access" at every admin on every load.
  if (loading || (user && adminStatus === 'unknown')) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-12">
        <LoadingState label="Checking your access…" />
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
      <div className="mx-auto w-full max-w-3xl px-4 py-12">
        <EmptyState
          title="You don’t have admin access"
          description="This area is limited to the event's administrators. If you think that's wrong, ask an organizer to add your address to the admin list."
        />
      </div>
    );
  }
  return children;
}

export default function AdminApp() {
  return (
    <AdminGate>
      <Routes>
        <Route element={<AdminLayout />}>
          <Route index element={<Navigate to="pages" replace />} />
          <Route path="pages" element={<AdminPagesList />} />
          <Route path="pages/new" element={<AdminPageEditor mode="create" />} />
          <Route path="pages/:pageId" element={<AdminPageEditor mode="edit" />} />
          <Route path="speakers" element={<AdminSpeakersList />} />
          <Route path="speakers/new" element={<AdminSpeakerEditor mode="create" />} />
          <Route path="speakers/:speakerId" element={<AdminSpeakerEditor mode="edit" />} />
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
            element={<AdminContentBlockEditor mode="create" />}
          />
          <Route
            path="content/:pageId/:sectionId/:field"
            element={<AdminContentBlockEditor mode="edit" />}
          />
          <Route path="settings" element={<AdminEventSettings />} />
          <Route path="features" element={<AdminFeatureSettings />} />
          <Route path="badges" element={<AdminBadgeSettings />} />
          <Route path="branding" element={<AdminBranding />} />
          <Route path="media" element={<AdminMedia />} />
          <Route path="materials" element={<AdminMaterialsTab />} />
          <Route path="attendees" element={<AdminAttendees />} />
          <Route path="live-updates" element={<AdminLiveUpdates />} />
          <Route path="feedback" element={<AdminFeedback />} />
          <Route path="system-errors" element={<AdminSystemErrors />} />
          <Route
            path="*"
            element={
              <EmptyState
                title="Admin page not found"
                description="That admin screen doesn’t exist. Use the tabs above."
              />
            }
          />
        </Route>
      </Routes>
    </AdminGate>
  );
}
