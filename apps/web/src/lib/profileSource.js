// Attendee profile + directory Firestore access (spec §3.4, issue #17).
//
// The one seam between the profile UI and Firebase: ProfileProvider and the
// directory pages import this module, tests mock it, and no page holds a
// Firestore type.
//
// Two collections, two very different rules (firestore.rules):
//   • users/{uid}      — the account. Self-read and a self-update limited to
//                        the profile field allowlist; speakerId and
//                        registrationStatus are server-owned and denied here,
//                        which is why saveOwnProfile filters its payload
//                        instead of passing whatever a caller hands it.
//   • users_public/{uid} — the trigger-maintained projection, the only doc a
//                        client may read about somebody else.
//
// The directory query's visibility filter is load-bearing, not a nicety: a
// Firestore list succeeds only if every returned document satisfies a read
// rule, so asking for documents the requester may not read fails the whole
// query rather than dropping rows. `includeAttendeesOnly` therefore mirrors
// the requester's own access — the rules, not this filter, are the boundary.
import { SELF_EDITABLE_PROFILE_FIELDS, validateProfileBounds } from 'shared/profile';
import { loadFirebase, subscribeToFirebase } from './firebaseLoader.js';
import {
  afterServerConfirms,
  SERVER_CONFIRMATION,
  subscribeWithFallback,
  subscribeWithRetry,
} from './retrySubscription.js';
import { IS_DEMO } from './demoMode.js';
import { demoAttendees } from './demoCommunity.js';

const USERS = 'users';
const USERS_PUBLIC = 'users_public';

/**
 * Subscribe to the signed-in user's own account document.
 *
 * onNext(null) means "no account document yet" — the auth trigger seeds it
 * moments after first sign-in, so the profile flow shows a waiting state
 * rather than an error. A listener error fails soft the same way and
 * re-attaches after a delay (subscribeWithRetry).
 *
 * `onConfirmed` (optional) is told, after each snapshot, whether the server
 * confirmed it (true) or it came from the local cache (false). With it the
 * listener asks for metadata changes, so a cached answer the server merely
 * confirms is reported. The private attendee feed (issue #788) opens only
 * on a server-confirmed grant.
 *
 * @param {string} uid
 * @param {(profile: object | null) => void} onNext
 * @param {(confirmed: boolean) => void} [onConfirmed]
 * @returns {() => void} unsubscribe
 */
export function subscribeOwnProfile(uid, onNext, onConfirmed) {
  return subscribeToFirebase(({ db, doc, onSnapshot }) => {
    const ref = doc(db, USERS, uid);
    const next = (snapshot) => {
      onNext(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
      onConfirmed?.(snapshot.metadata?.fromCache === false);
    };
    return subscribeWithRetry(
      (onError) =>
        onConfirmed
          ? onSnapshot(ref, { includeMetadataChanges: true }, next, onError)
          : onSnapshot(ref, next, onError),
      (error) => {
        console.warn('own profile subscription failed; retrying.', error);
      },
    );
  });
}

/**
 * Prepare the account owner's editable profile fields.
 *
 * Only SELF_EDITABLE_PROFILE_FIELDS are sent: the rules reject a write that
 * touches anything else, so filtering here turns a caller mistake into a
 * dropped field instead of a rejected save.
 *
 * @param {object} fields
 * @returns {object}
 */
export function ownProfileFields(fields) {
  const payload = {};
  for (const key of SELF_EDITABLE_PROFILE_FIELDS) {
    if (key === 'updatedAt') continue;
    if (fields != null && Object.prototype.hasOwnProperty.call(fields, key)) {
      payload[key] = fields[key];
    }
  }
  validateProfileBounds(payload);
  return payload;
}

export function saveOwnProfile(uid, fields) {
  const payload = ownProfileFields(fields);
  return loadFirebase().then(({ db, serverTimestamp, updateDoc, doc }) => {
    payload.updatedAt = serverTimestamp();
    return updateDoc(doc(db, USERS, uid), payload);
  });
}

/**
 * Subscribe to the attendee directory.
 *
 * @param {{ includeAttendeesOnly: boolean }} options
 * @param {(profiles: Array<object> | null) => void} onNext null clears the
 *   refused full snapshot while waiting for the public directory.
 * @param {(error: unknown) => void} [onFail] called on every listener error,
 *   so the page can show "the directory is unavailable" instead of an empty
 *   directory that looks like nobody signed up.
 * @returns {() => void} unsubscribe
 */
export function subscribeDirectory({ includeAttendeesOnly }, onNext, onFail) {
  if (IS_DEMO) {
    onNext(demoAttendees);
    return () => {};
  }
  return subscribeToFirebase(({ db, collection, limit, onSnapshot, query, where }) => {
    const fullDirectory = (...constraints) => query(
      collection(db, USERS_PUBLIC),
      where('profileVisibility', 'in', ['public', 'attendees_only']),
      ...constraints,
    );
    const publicDirectory = query(collection(db, USERS_PUBLIC), where('profileVisibility', '==', 'public'));
    const emit = (snapshot) => {
      const { docs, metadata } = snapshot;
      if (docs.length === 0 && metadata?.fromCache) return;
      onNext(docs.map((d) => ({ id: d.id, ...d.data() })));
    };

    function attach(target, onSnapshotNext, onSnapshotError) {
      let active = true;
      const next = (snapshot) => {
        if (active) onSnapshotNext(snapshot);
      };
      const fail = (error) => {
        if (!active) return;
        active = false;
        onSnapshotError(error);
      };
      const detach = onSnapshot(target, SERVER_CONFIRMATION, next, fail);
      return () => {
        active = false;
        detach();
      };
    }

    // The full directory waits for the server (afterServerConfirms).
    const listen = (target, onRefused = null) => subscribeWithRetry(
      (onError) => attach(target, onRefused ? afterServerConfirms(emit) : emit, onError),
      (error) => {
        if (onRefused && error?.code === 'permission-denied') {
          onNext(null);
          onRefused();
          return;
        }
        console.warn('attendee directory subscription failed; retrying.', error);
        onFail?.(error);
      },
    );
    if (!includeAttendeesOnly) return listen(publicDirectory);
    // After a ticket resource policy is published, an approved attendee whose
    // grant lacks `directory` may read only public profiles (issue 1004). The
    // grant is server-private, so a refused full directory shows the public
    // profiles until the full query is allowed again.
    return subscribeWithFallback({
      wide: (onRefused) => listen(fullDirectory(), onRefused),
      narrow: () => listen(publicDirectory),
      probe: (onAllowed, onError) => attach(fullDirectory(limit(1)), onAllowed, onError),
    });
  }, onFail);
}

/**
 * Read one public profile. Resolves null both for a profile that does not
 * exist and for one the rules refuse — the page must not distinguish them,
 * or it becomes an oracle for "this person has a private profile". Other
 * failures reject so a recheck can keep the last server-confirmed profile.
 *
 * @param {string} uid
 * @returns {Promise<object | null>}
 */
export async function fetchPublicProfile(uid) {
  if (IS_DEMO) return demoAttendees.find((profile) => profile.id === uid) ?? null;
  try {
    // From the server only: a profile cached for an earlier account in this
    // tab must not reach a reader the rules refuse (issue 1004).
    const { db, doc, getDocFromServer } = await loadFirebase();
    const snapshot = await getDocFromServer(doc(db, USERS_PUBLIC, uid));
    return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
  } catch (error) {
    if (error?.code === 'permission-denied' || error?.code === 'unauthenticated') return null;
    console.warn('public profile read failed.', error);
    throw error;
  }
}
