'use strict';

/**
 * users → users_public projection (spec §4.1, §4.5, issue #17).
 *
 * `syncUserPublic` is a Firestore onWrite trigger over `users/{uid}`. It
 * maintains `users_public/{uid}`, the only attendee document any client
 * may read about somebody else — the read rules in firestore.rules branch
 * on its `profileVisibility`, and everything not on
 * PUBLIC_PROFILE_FIELDS (email, registrationStatus, approvalSource, role)
 * stays behind the server-only `users` doc.
 *
 * One direction only: nothing ever writes `users` from `users_public`, so
 * there is no cycle and no reconciliation job (§4.3 applies the same rule
 * to speakers).
 *
 * Badge-set intersection (§4.5): rules cannot check list membership
 * against config/badges, so this trigger is where an unconfigured or
 * over-cap badge id stops being public — `users_public.badges` is
 * rewritten to the intersection with the configured set rather than
 * copied.
 *
 * Idempotent and self-limiting: a write that leaves the projection
 * byte-identical (a `lastSeenAt` touch, a registrationStatus change —
 * private, so not projected) writes nothing, so trigger retries and
 * unrelated account churn do not amplify into writes.
 */

const { buildPublicProfile } = require('shared/profile');

const USERS_PUBLIC = 'users_public';

/** Shallow-equal over the projection payload (values are scalars, string
 * arrays, and a flat socialHandles map). */
function sameProjection(a, b) {
  if (!a || !b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const left = a[key];
    const right = b[key];
    if (Array.isArray(left) || Array.isArray(right)) {
      if (!Array.isArray(left) || !Array.isArray(right)) return false;
      if (left.length !== right.length) return false;
      if (left.some((v, i) => v !== right[i])) return false;
      continue;
    }
    if (left && right && typeof left === 'object' && typeof right === 'object') {
      if (!sameProjection(left, right)) return false;
      continue;
    }
    if (left !== right) return false;
  }
  return true;
}

/**
 * Core of the trigger, driven directly by tests with a fake db.
 *
 * The projection is a function of the AFTER state alone — the previous
 * state is not a parameter, so a replayed or out-of-order delivery
 * converges on the same document rather than on a diff of two snapshots.
 *
 * @param {{ db: object, getConfig: () => Promise<{ badges: object|null }>,
 *           now?: () => Date, log?: { error: Function } }} deps
 * @returns {(change: { uid: string, after: object|null }) =>
 *   Promise<{ action: 'deleted'|'written'|'unchanged' }>}
 */
function createSyncUserPublic({ db, getConfig, now = () => new Date(), log = console }) {
  return async function syncUserPublic({ uid, after }) {
    if (typeof uid !== 'string' || uid.length === 0) {
      log.error('syncUserPublic called without a uid');
      return { action: 'unchanged' };
    }
    const ref = db.collection(USERS_PUBLIC).doc(uid);

    // The account is gone: its public projection must go with it. A
    // delete of an already-absent doc is a no-op in Firestore, so this
    // needs no existence check.
    if (after == null) {
      await ref.delete();
      return { action: 'deleted' };
    }

    let badgesConfig = null;
    try {
      badgesConfig = (await getConfig()).badges;
    } catch (err) {
      // Fail closed on badges only: an unreadable config/badges must not
      // publish an unvalidated badge set, and must not stop the rest of
      // the profile (display name, visibility) from being projected —
      // the visibility field is what the read rules depend on.
      log.error('syncUserPublic: config/badges unavailable; projecting no badges', err);
    }

    const payload = buildPublicProfile(after, badgesConfig);
    const existing = await ref.get();
    if (existing.exists && sameProjection(stripStamps(existing.data()), payload)) {
      return { action: 'unchanged' };
    }
    await ref.set({ ...payload, uid, updatedAt: now() });
    return { action: 'written' };
  };
}

/** Drop the fields the projection stamps rather than derives. */
function stripStamps(data) {
  if (!data || typeof data !== 'object') return data;
  const { updatedAt: _updatedAt, uid: _uid, ...rest } = data;
  return rest;
}

/** Deployable exports (spec §1.3 users/): syncUserPublic. */
function buildHandlers() {
  const { onDocumentWritten } = require('firebase-functions/v2/firestore');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';

  return {
    syncUserPublic: onDocumentWritten({ region, document: 'users/{uid}' }, async (event) => {
      const { getDb } = require('../core/firestore.cjs');
      const { getEventConfig } = require('../core/config.cjs');
      const db = getDb();
      const handler = createSyncUserPublic({
        db,
        getConfig: () => getEventConfig({ db }),
      });
      const after = event.data?.after;
      await handler({
        uid: event.params.uid,
        after: after && after.exists ? after.data() : null,
      });
    }),
  };
}

module.exports = {
  createSyncUserPublic,
  get handlers() {
    return buildHandlers();
  },
  internals: { sameProjection, USERS_PUBLIC },
};
