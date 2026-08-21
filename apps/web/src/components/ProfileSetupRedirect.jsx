// Routes a freshly signed-in attendee into the profile setup flow once —
// and only once (issue #17 review finding).
//
// `needsProfileSetup` was computed but nothing acted on it, so a new account
// only reached /profile by guessing the URL. The rules here keep it a nudge
// rather than a trap:
//
//   • It fires only from the two post-sign-in landing spots, '/' and
//     '/signin'. A deep link (a session someone opened from a schedule
//     link) is never hijacked.
//   • It fires at most once per mount, tracked by a ref — someone who
//     navigates away from /profile without finishing is not dragged back.
//   • It waits for status 'ready': during 'pending-account' there is
//     nothing to complete yet.
//
// ProfileSidebar carries the standing invitation for everyone this skips.
import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useProfile } from '../contexts/ProfileContext.jsx';

const LANDING_PATHS = ['/', '/signin'];

export default function ProfileSetupRedirect() {
  const { status, needsProfileSetup } = useProfile();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const redirected = useRef(false);

  useEffect(() => {
    if (redirected.current) return;
    if (status !== 'ready' || !needsProfileSetup) return;
    if (!LANDING_PATHS.includes(pathname)) return;
    redirected.current = true;
    navigate('/profile', { replace: true });
  }, [status, needsProfileSetup, pathname, navigate]);

  return null;
}
