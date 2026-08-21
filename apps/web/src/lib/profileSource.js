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
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { SELF_EDITABLE_PROFILE_FIELDS } from 'shared/profile';
import { db } from '../firebase.js';
import { subscribeWithRetry } from './retrySubscription.js';

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
 * @param {string} uid
 * @param {(profile: object | null) => void} onNext
 * @returns {() => void} unsubscribe
 */
export function subscribeOwnProfile(uid, onNext) {
  return subscribeWithRetry(
    (onError) =>
      onSnapshot(
        doc(db, USERS, uid),
        (snapshot) => {
          onNext(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
        },
        onError,
      ),
    (error) => {
      console.warn('own profile subscription failed; retrying.', error);
    },
  );
}

/**
 * Write the account owner's editable profile fields.
 *
 * Only SELF_EDITABLE_PROFILE_FIELDS are sent: the rules reject a write that
 * touches anything else, so filtering here turns a caller mistake into a
 * dropped field instead of a rejected save.
 *
 * `updatedAt` is stamped here, with serverTimestamp() rather than the
 * browser clock, and this is its ONLY writer — the same single-writer rule
 * `profileComplete` follows in the trigger. The rules type-check it as a
 * timestamp, so a client cannot backdate its own profile.
 *
 * @param {string} uid
 * @param {object} fields
 * @returns {Promise<void>}
 */
export function saveOwnProfile(uid, fields) {
  const payload = {};
  for (const key of SELF_EDITABLE_PROFILE_FIELDS) {
    if (key === 'updatedAt') continue;
    if (fields != null && Object.prototype.hasOwnProperty.call(fields, key)) {
      payload[key] = fields[key];
    }
  }
  payload.updatedAt = serverTimestamp();
  return updateDoc(doc(db, USERS, uid), payload);
}

/**
 * Subscribe to the attendee directory.
 *
 * @param {{ includeAttendeesOnly: boolean }} options
 * @param {(profiles: Array<object>) => void} onNext
 * @param {(error: unknown) => void} [onFail] called on every listener error,
 *   so the page can show "the directory is unavailable" instead of an empty
 *   directory that looks like nobody signed up.
 * @returns {() => void} unsubscribe
 */
export function subscribeDirectory({ includeAttendeesOnly }, onNext, onFail) {
  const target = includeAttendeesOnly
    ? query(
        collection(db, USERS_PUBLIC),
        where('profileVisibility', 'in', ['public', 'attendees_only']),
      )
    : query(collection(db, USERS_PUBLIC), where('profileVisibility', '==', 'public'));
  return subscribeWithRetry(
    (onError) =>
      onSnapshot(
        target,
        (snapshot) => {
          onNext(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
        },
        onError,
      ),
    (error) => {
      console.warn('attendee directory subscription failed; retrying.', error);
      onFail?.(error);
    },
  );
}

/**
 * Read one public profile. Resolves null both for a profile that does not
 * exist and for one the rules refuse — the page must not distinguish them,
 * or it becomes an oracle for "this person has a private profile".
 *
 * @param {string} uid
 * @returns {Promise<object | null>}
 */
export async function fetchPublicProfile(uid) {
  try {
    const snapshot = await getDoc(doc(db, USERS_PUBLIC, uid));
    return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
  } catch (error) {
    console.warn('public profile read failed.', error);
    return null;
  }
}
