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
//   profileConfirmed  whether the server confirmed `profile`, rather than
//                    the local cache.
//   profileReady     this uid has received an existing profile from the
//                    server. Keeps its own schedule readable offline;
//                    resets on identity change or a missing profile.
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

const EMPTY_ACCOUNT = Object.freeze({ uid: null, profile: null, seeded: false, confirmed: false, ready: false });

export function ProfileProvider({ children }) {
  const { user, isAdmin } = useAuth();
  const uid = user?.uid ?? null;
  // The account document, kept WITH the uid it was read for. `profile` and
  // every verdict below are derived from it in render, so an account switch
  // hides the previous account's document in the very render that brings
  // the new uid, before the effect below has run (issue #788). A
  // document for any other uid reads as "not seeded yet".
  const [account, setAccount] = useState(EMPTY_ACCOUNT);

  useEffect(() => {
    setAccount(EMPTY_ACCOUNT);
    if (!uid) return undefined;
    let current = true;
    const unsubscribe = subscribeOwnProfile(
      uid,
      (next) => {
        // A callback that lands after this subscription ended must not
        // overwrite the next account's document. A new document is not
        // confirmed until the server says so.
        if (current) setAccount((prev) => ({ uid, profile: next, seeded: next != null, confirmed: false,
          ready: next != null && prev.uid === uid && prev.ready }));
      },
      (confirmed) => {
        if (current) setAccount((prev) => {
          if (prev.uid !== uid) return prev;
          const ready = prev.ready || (confirmed && prev.seeded);
          return prev.confirmed !== confirmed || prev.ready !== ready ? { ...prev, confirmed, ready } : prev;
        });
      },
    );
    return () => {
      current = false;
      unsubscribe();
    };
  }, [uid]);

  const own = uid && account.uid === uid ? account : EMPTY_ACCOUNT;
  const profile = own.profile;
  const seeded = own.seeded;
  const profileConfirmed = own.confirmed;
  const profileReady = own.ready;

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
      // Whether the server confirmed `profile` (not a local cache answer).
      // The private attendee feed opens only on a confirmed grant.
      profileConfirmed,
      profileReady,
      saveProfile,
    };
  }, [uid, profile, seeded, profileConfirmed, profileReady, isAdmin, saveProfile]);

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
