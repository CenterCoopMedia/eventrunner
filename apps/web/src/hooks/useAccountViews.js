import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useProfile } from '../contexts/ProfileContext.jsx';
import { isSpeakerDashboardEligible } from '../lib/speakerDashboardEligibility.js';
import { accountViews, viewForPath, readSessionView, saveSessionView } from '../lib/accountViews.js';

function useSpeakerDashboardEligibility({
  authLoading,
  user,
  accountStatus,
  speakerId,
  navigationKey,
}) {
  const identity = !authLoading && user && accountStatus === 'ready' && speakerId
    ? JSON.stringify([user.uid, speakerId])
    : null;
  const [result, setResult] = useState({ identity: null, eligible: false });

  useEffect(() => {
    let current = true;
    const storeResult = (eligible) => {
      setResult((previous) => (
        previous.identity === identity && previous.eligible === eligible
          ? previous
          : { identity, eligible }
      ));
    };
    if (!identity) {
      storeResult(false);
      return () => {
        current = false;
      };
    }

    // speakerProfileApi carries the authenticated endpoint client and media
    // helpers. Load it only for a linked account so the public shell's first
    // bundle does not pay for a speaker-only read.
    import('../lib/speakerProfileApi.js')
      .then(({ getOwnSpeakerProfile }) => getOwnSpeakerProfile({ user, speakerId }))
      .then(
        (speaker) => {
          if (current) storeResult(isSpeakerDashboardEligible(speaker));
        },
        () => {
          if (current) storeResult(false);
        },
      );

    return () => {
      current = false;
    };
  }, [identity, navigationKey, speakerId, user]);

  return result.identity === identity && result.eligible;
}

export default function useAccountViews({ refreshOnNavigation = true } = {}) {
  const { user, loading: authLoading, adminStatus } = useAuth();
  const { profile, status: accountStatus } = useProfile();
  const { pathname, key: navigationKey } = useLocation();
  const speakerDashboardEligible = useSpeakerDashboardEligibility({
    authLoading, user, accountStatus, speakerId: profile?.speakerId, navigationKey: refreshOnNavigation ? navigationKey : null,
  });
  const views = accountViews({
    signedIn: Boolean(user) && !authLoading,
    profile,
    speakerEligible: speakerDashboardEligible,
    admin: adminStatus === 'admin',
  });
  const routeView = viewForPath(pathname);
  const savedView = readSessionView(user?.uid);
  const current = views.find((view) => view.id === routeView)
    ?? views.find((view) => view.id === savedView)
    ?? views.find((view) => view.id === 'speaker')
    ?? views[0];

  // A deep link chooses its own view. Never redirect it to a stored choice.
  useEffect(() => {
    if (views.some((view) => view.id === routeView)) saveSessionView(user?.uid, routeView);
  }, [user?.uid, routeView, views]);

  return { views, current, select: (id) => saveSessionView(user?.uid, id) };
}
