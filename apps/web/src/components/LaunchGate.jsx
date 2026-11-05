// Holds a new site's public pages behind its coming-soon page until the
// team first publishes (lib/launchSource.js). Signed-in staff and admins
// see the real site, with a note that visitors do not yet. The pages a
// visitor acts on — signing in, pitching a session, tickets and
// registration, a speaker's invitation, an account — stay open, because a
// link the organizers sent must work before the site is announced.
import { Link, Outlet, useLocation } from 'react-router';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useComingSoon } from '../lib/launchSource.js';
import ComingSoon from './ComingSoon.jsx';

const OPEN_PREFIXES = Object.freeze([
  'signin', 'pitch', 'tickets', 'ticket', 'registration', 'speaker', 'profile', 'dashboard',
  // What those pages link to: the legal pages, and a speaker's resources.
  'privacy', 'terms', 'guidelines', 'travel',
]);

/** Whether a path is one of the pages that stay open while the site is coming soon. */
export function staysOpen(pathname) {
  const first = String(pathname ?? '').split('/').filter(Boolean)[0] ?? '';
  return OPEN_PREFIXES.includes(first);
}

export default function LaunchGate() {
  const comingSoon = useComingSoon();
  const { isAdmin } = useAuth();
  const { pathname } = useLocation();
  if (!comingSoon) return <Outlet />;
  if (isAdmin) {
    return (
      <>
        <p role="note" className="no-print border-b-hairline border-b-rule-hairline bg-surface-alt px-md py-xs text-center font-data text-caption text-text-primary">
          Visitors see a coming-soon page until you publish from the{' '}
          <Link to="/admin" className="underline underline-offset-2">admin</Link>.
        </p>
        <Outlet />
      </>
    );
  }
  return staysOpen(pathname) ? <Outlet /> : <ComingSoon />;
}
