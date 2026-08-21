'use strict';

/**
 * Account lifecycle for `users/{uid}` (spec §3.4, §4.1, issue #17).
 *
 *   onUserCreated           auth onCreate — seeds the account document with
 *                           the server-owned defaults: registrationStatus
 *                           'pending' (the only entry state in the §3.4
 *                           table), speakerId null, and the default
 *                           profile visibility.
 *   onUserDeleted           auth onDelete — removes the account document, so
 *                           a deleted sign-in does not leave an unreachable
 *                           profile listed in the directory forever.
 *   maintainProfileComplete users onWrite — recomputes the derived
 *                           `profileComplete` flag.
 *
 * `users` is `allow create: if false` for clients (firestore.rules): the
 * account document is created here, on the server, so no client can hand
 * itself a registrationStatus or a speakerId at creation time. The profile
 * setup flow in apps/web *updates* this document; it never creates it.
 *
 * The auth trigger is the one hook both sign-in paths share — Google popup
 * sign-in never reaches a function of ours, so seeding from the OTP
 * handler would leave Google accounts without a document.
 */

const {
  DEFAULT_PROFILE_VISIBILITY,
  isProfileComplete,
} = require('shared/profile');

const USERS = 'users';
const USERS_PUBLIC = 'users_public';

/**
 * The server-owned shape of a brand-new account (spec §3.4).
 * Pure — no db, no clock beyond the injected `now`.
 *
 * @param {{ uid: string, email?: string|null, displayName?: string|null }} authUser
 * @param {Date} now
 * @returns {object} the users/{uid} document
 */
function buildNewUserDoc(authUser, now) {
  const email = typeof authUser?.email === 'string' ? authUser.email.trim().toLowerCase() : null;
  const displayName = typeof authUser?.displayName === 'string' ? authUser.displayName.trim() : '';
  return {
    uid: authUser.uid,
    email,
    // Seeded from the identity provider when it supplied one, so a Google
    // sign-in lands with a usable name; the owner can change it in the
    // profile flow. Never guessed from the email local part.
    displayName,
    pronouns: '',
    bio: '',
    organization: '',
    jobTitle: '',
    photoPath: null,
    socialHandles: {},
    badges: [],
    profileVisibility: DEFAULT_PROFILE_VISIBILITY,
    profileComplete: false,
    // Server-owned from here down (spec §3.4): the client rules deny every
    // one of these fields on self-update.
    registrationStatus: 'pending',
    approvalSource: null,
    speakerId: null,
    role: 'attendee',
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Core of the auth onCreate trigger.
 *
 * Uses create(), not set(): if a document already exists for the uid (a
 * retried trigger delivery, or an account re-created against a
 * hand-seeded document) the existing record — which may already carry an
 * approval — must win over a fresh `pending` default. ALREADY_EXISTS is
 * therefore success, not an error.
 *
 * @param {{ db: object, now?: () => Date, log?: { error: Function } }} deps
 * @returns {(authUser: { uid: string, email?: string|null, displayName?: string|null })
 *   => Promise<{ created: boolean }>}
 */
function createOnUserCreated({ db, now = () => new Date(), log = console }) {
  return async function onUserCreated(authUser) {
    if (!authUser || typeof authUser.uid !== 'string' || authUser.uid.length === 0) {
      log.error('onUserCreated called without a uid');
      return { created: false };
    }
    try {
      await db.collection(USERS).doc(authUser.uid).create(buildNewUserDoc(authUser, now()));
      return { created: true };
    } catch (err) {
      if (err && (err.code === 6 || err.code === 'already-exists')) {
        return { created: false };
      }
      throw err;
    }
  };
}

/**
 * Core of the auth onDelete trigger.
 *
 * A deleted Firebase Auth account whose `users/{uid}` document survives is
 * a profile nobody can sign in to, edit, or remove — and its `users_public`
 * projection stays readable in the directory forever. Deleting the account
 * document is enough in the normal case: syncUserPublic sees the delete and
 * removes the projection. When there is no account document to delete (a
 * sign-in that never seeded, or a document already removed), no projection
 * trigger will fire, so the projection is removed here directly — that is
 * the one case where this module writes users_public.
 *
 * @param {{ db: object, log?: { error: Function } }} deps
 * @returns {(authUser: { uid: string }) => Promise<{ deleted: boolean }>}
 */
function createOnUserDeleted({ db, log = console }) {
  return async function onUserDeleted(authUser) {
    const uid = authUser && typeof authUser.uid === 'string' ? authUser.uid : '';
    if (uid.length === 0) {
      log.error('onUserDeleted called without a uid');
      return { deleted: false };
    }
    const userRef = db.collection(USERS).doc(uid);
    const existing = await userRef.get();
    if (existing.exists) {
      await userRef.delete();
      return { deleted: true };
    }
    await db.collection(USERS_PUBLIC).doc(uid).delete();
    return { deleted: false };
  };
}

/**
 * Core of the derived-field trigger: `users.profileComplete` mirrors
 * isProfileComplete() over the fields the owner does control.
 *
 * Loop-safe by construction — it writes only when the stored flag differs
 * from the computed one, so the write it makes cannot trigger another
 * write.
 *
 * @param {{ db: object, log?: { error: Function } }} deps
 * @returns {(change: { uid: string, after: object|null }) =>
 *   Promise<{ action: 'written'|'unchanged' }>}
 */
function createMaintainProfileComplete({ db, log = console }) {
  return async function maintainProfileComplete({ uid, after }) {
    if (typeof uid !== 'string' || uid.length === 0) {
      log.error('maintainProfileComplete called without a uid');
      return { action: 'unchanged' };
    }
    if (after == null) return { action: 'unchanged' }; // account deleted
    const computed = isProfileComplete(after);
    if (after.profileComplete === computed) return { action: 'unchanged' };
    await db.collection(USERS).doc(uid).update({ profileComplete: computed });
    return { action: 'written' };
  };
}

/** Deployable exports (spec §1.3 users/): onUserCreated, onUserDeleted,
 * maintainProfileComplete. */
function buildHandlers() {
  // Auth background triggers have no v2 equivalent (v2 offers only the
  // blocking identity functions, which run inside the sign-in request and
  // fail it on error). Seeding an account document must never be able to
  // block a sign-in, so this stays a v1 background trigger.
  const functionsV1 = require('firebase-functions/v1');
  const { onDocumentWritten } = require('firebase-functions/v2/firestore');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';

  // failurePolicy: retry on error. Clients cannot create their own account
  // document (firestore.rules), so a single transient failure here would
  // otherwise leave an account that can never be seeded — permanently
  // stuck at "setting up your account". Retries are safe by construction:
  // onUserCreated uses create() and treats ALREADY_EXISTS as success, and
  // onUserDeleted's deletes are idempotent.
  const retryOnFailure = { failurePolicy: true };

  return {
    onUserCreated: functionsV1
      .runWith(retryOnFailure)
      .region(region)
      .auth.user()
      .onCreate(async (authUser) => {
        const { getDb } = require('../core/firestore.cjs');
        await createOnUserCreated({ db: getDb() })({
          uid: authUser.uid,
          email: authUser.email,
          displayName: authUser.displayName,
        });
      }),
    onUserDeleted: functionsV1
      .runWith(retryOnFailure)
      .region(region)
      .auth.user()
      .onDelete(async (authUser) => {
        const { getDb } = require('../core/firestore.cjs');
        await createOnUserDeleted({ db: getDb() })({ uid: authUser.uid });
      }),
    maintainProfileComplete: onDocumentWritten(
      { region, document: 'users/{uid}' },
      async (event) => {
        const { getDb } = require('../core/firestore.cjs');
        const after = event.data?.after;
        await createMaintainProfileComplete({ db: getDb() })({
          uid: event.params.uid,
          after: after && after.exists ? after.data() : null,
        });
      },
    ),
  };
}

module.exports = {
  buildNewUserDoc,
  createOnUserCreated,
  createOnUserDeleted,
  createMaintainProfileComplete,
  get handlers() {
    return buildHandlers();
  },
  internals: { USERS, USERS_PUBLIC },
};
