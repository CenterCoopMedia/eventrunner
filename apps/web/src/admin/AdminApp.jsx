// Admin area root — everything under /admin lives inside this one subtree, so
// App.jsx carries a single route for it (`<Route path="admin/*">`).
//
// Gating (client side, convenience only — functions/src/core/auth.cjs
// requireAdmin and firestore.rules are the enforcement):
//   • auth still loading → a loading state, never a flash of denial;
//   • signed out        → redirect to /signin, remembering where they were;
//   • signed in, not an admin → a plain denial, no retry affordance.
// "Admin" is exactly what AuthContext's isAdmin reports: a probe read of an
// admin-only drafts collection, decided by firestore.rules isAdmin(), which
// is the same config/bootstrap.adminEmails + verified-email test the server's
// requireAdmin applies.
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import AdminLayout from './AdminLayout.jsx';
import AdminPagesList from './pages/AdminPagesList.jsx';
import AdminPageEditor from './pages/AdminPageEditor.jsx';

export function AdminGate({ children }) {
  const { user, isAdmin, loading } = useAuth();
  const location = useLocation();

  if (loading) {
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
  if (!isAdmin) {
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
