const VIEWS = Object.freeze([
  { id: 'attendee', label: 'Attendee', to: '/dashboard' },
  { id: 'speaker', label: 'Speaker', to: '/speaker/dashboard' },
  { id: 'admin', label: 'Admin', to: '/admin' },
]);

// These are UI destinations. Server rules and endpoint gates still decide access.
export function accountViews({ signedIn, profile, speakerEligible, admin }) {
  if (!signedIn) return [];
  const registered = ['approved', 'ticketed'].includes(profile?.registrationStatus);
  const attendee = registered || (!speakerEligible && !admin);
  return VIEWS.filter((view) => (
    (view.id === 'attendee' && attendee)
    || (view.id === 'speaker' && speakerEligible)
    || (view.id === 'admin' && admin)
  ));
}

export function viewForPath(pathname) {
  if (/^\/admin(?:\/|$)/i.test(pathname)) return 'admin';
  if (/^\/speaker(?:\/|$)/i.test(pathname)) return 'speaker';
  if (/^\/(?:dashboard|profile)(?:\/|$)/i.test(pathname)) return 'attendee';
  return null;
}

const sessionKey = (uid) => `eventrunner.accountView:${uid}`;

export function readSessionView(uid) {
  if (!uid) return null;
  try {
    return sessionStorage.getItem(sessionKey(uid));
  } catch {
    return null;
  }
}

export function saveSessionView(uid, view) {
  if (!uid) return;
  try {
    sessionStorage.setItem(sessionKey(uid), view);
  } catch {
    // Navigation still works when browser storage is unavailable.
  }
}
