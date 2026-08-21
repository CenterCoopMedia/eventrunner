// ProfileProvider — the signed-in user's own account document (spec §3.4,
// issue #17). Sits inside AuthProvider: it subscribes to users/{uid} for the
// signed-in user and holds nothing at all when signed out.
//
// What it exposes and why:
//   profile          the users/{uid} doc, or null when signed out / not
//                    seeded yet.
//   status           'signed-out' | 'pending-account' | 'ready'.
//                    'pending-account' is the gap between first sign-in and
//                    the auth trigger seeding the document — a normal state
//                    of a few seconds, not an error.
//   attendeeAccess   hasAttendeeAccess() from packages/shared, the SAME
//                    predicate the server uses. UI convenience only: the
//                    Firestore rules are the authorization boundary, and
//                    this flag only decides which directory query the client
//                    asks for (a wrong guess fails the query, it does not
//                    leak a profile).
//   needsProfileSetup  true once the account exists but has no display name
//                    or visibility choice yet — what routes the first
//                    sign-in into the profile flow.
//   saveProfile      writes the self-editable fields only.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { hasAttendeeAccess } from 'shared/registration';
import { isProfileComplete } from 'shared/profile';
import { useAuth } from './AuthContext.jsx';
import { saveOwnProfile, subscribeOwnProfile } from '../lib/profileSource.js';

const ProfileContext = createContext(null);

export function ProfileProvider({ children }) {
  const { user, isAdmin } = useAuth();
  const uid = user?.uid ?? null;
  const [profile, setProfile] = useState(null);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    setProfile(null);
    setSeeded(false);
    if (!uid) return undefined;
    return subscribeOwnProfile(uid, (next) => {
      setProfile(next);
      setSeeded(next != null);
    });
  }, [uid]);

  const saveProfile = useCallback(
    (fields) => {
      if (!uid) {
        return Promise.reject(new Error('Sign in before saving a profile.'));
      }
      return saveOwnProfile(uid, fields);
    },
    [uid],
  );

  const value = useMemo(() => {
    const status = !uid ? 'signed-out' : seeded ? 'ready' : 'pending-account';
    return {
      uid,
      profile,
      status,
      // isAdmin comes from AuthContext's rules probe, so an admin who is not
      // an attendee still sees the directory the rules already let them read.
      attendeeAccess: hasAttendeeAccess(
        profile ? { ...profile, role: isAdmin ? 'admin' : profile.role } : null,
      ) || (Boolean(uid) && isAdmin),
      needsProfileSetup: status === 'ready' && !isProfileComplete(profile),
      saveProfile,
    };
  }, [uid, profile, seeded, isAdmin, saveProfile]);

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) {
    throw new Error('useProfile must be used inside <ProfileProvider>.');
  }
  return ctx;
}

export default ProfileContext;
