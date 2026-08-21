'use strict';

/**
 * users → users_public projection (spec §4.1, §4.5, issue #17).
 *
 * `syncUserPublic` is a Firestore onWrite trigger over `users/{uid}`. It
 * maintains `users_public/{uid}`, the only attendee document any client
 * may read about somebody else — the read rules in firestore.rules branch
 * on its `profileVisibility`, and everything not on
 * PUBLIC_PROFILE_FIELDS (email, registrationStatus, approvalSource, role)
 * stays behind the server-only `users` doc. `refreshUserPublicBadges`
 * re-runs that projection for every account when config/badges changes, so
 * removed badges do not stay readable until each user edits their profile.
 *
 * One direction only: nothing ever writes `users` from `users_public`, so
 * there is no cycle (§4.3 applies the same rule to speakers).
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

const USERS = 'users';
const USERS_PUBLIC = 'users_public';
const BADGES_CONFIG = 'badges';
const REFRESH_CONCURRENCY = 25;

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
 * The event payload is NOT the input. Trigger deliveries are unordered and
 * may be retried, so projecting the `after` snapshot an event carries can
 * republish a stale state — a public→private edit whose older (public)
 * delivery lands last would put the profile back on the open web and leave
 * it there. Every run therefore re-reads `users/{uid}` inside a
 * transaction and projects whatever is current, with the projection write
 * in the same transaction: the event is a wake-up, not data. Out-of-order
 * and duplicate deliveries then converge on the same document, and the
 * last writer is by definition the one that read the newest source.
 *
 * @param {{ db: object, getBadgesConfig?: (tx: object) => Promise<object|null>,
 *           failClosedOnConfigError?: boolean,
 *           now?: () => Date, log?: { error: Function } }} deps
 * @returns {(change: { uid: string }) =>
 *   Promise<{ action: 'deleted'|'written'|'unchanged' }>}
 */
function createSyncUserPublic({
  db,
  getBadgesConfig,
  failClosedOnConfigError = true,
  now = () => new Date(),
  log = console,
}) {
  const badgesRef = db.collection('config').doc(BADGES_CONFIG);
  const readBadgesConfig = getBadgesConfig ?? (async (tx) => {
    const snap = await tx.get(badgesRef);
    return snap.exists ? snap.data() : null;
  });

  return async function syncUserPublic({ uid }) {
    if (typeof uid !== 'string' || uid.length === 0) {
      log.error('syncUserPublic called without a uid');
      return { action: 'unchanged' };
    }

    const userRef = db.collection(USERS).doc(uid);
    const publicRef = db.collection(USERS_PUBLIC).doc(uid);

    return db.runTransaction(async (tx) => {
      let badgesConfig = null;
      try {
        // Read config/badges in the projection transaction. Config trigger
        // deliveries can arrive out of order, so an event snapshot or cached
        // config could let an older delivery restore a removed badge.
        badgesConfig = await readBadgesConfig(tx);
      } catch (err) {
        if (!failClosedOnConfigError) throw err;
        // Fail closed on badges only: an unreadable config/badges must not
        // publish an unvalidated badge set, and must not stop the rest of
        // the profile (display name, visibility) from being projected.
        log.error('syncUserPublic: config/badges unavailable; projecting no badges', err);
      }
      const [userSnap, publicSnap] = await Promise.all([tx.get(userRef), tx.get(publicRef)]);

      // The account is gone: its public projection must go with it. A
      // delete of an already-absent doc is a no-op in Firestore, so this
      // needs no existence check.
      if (!userSnap.exists) {
        tx.delete(publicRef);
        return { action: 'deleted' };
      }

      const payload = buildPublicProfile(userSnap.data(), badgesConfig);
      if (publicSnap.exists && sameProjection(stripStamps(publicSnap.data()), payload)) {
        return { action: 'unchanged' };
      }
      tx.set(publicRef, { ...payload, uid, updatedAt: now() });
      return { action: 'written' };
    });
  };
}

/**
 * Re-run the current projection for every account after config/badges
 * changes. listDocuments returns references only; each bounded group then
 * reads the account, public projection, and CURRENT badge config through
 * createSyncUserPublic's transaction. A failed group rejects the trigger,
 * whose retry is safe because unchanged projections do not write.
 *
 * @param {{ db: object, syncUserPublic?: (change: { uid: string }) => Promise<object>,
 *           concurrency?: number, log?: { error: Function } }} deps
 * @returns {() => Promise<{ scanned: number }>}
 */
function createRefreshUserPublicBadges({
  db,
  syncUserPublic = createSyncUserPublic({ db, failClosedOnConfigError: false }),
  concurrency = REFRESH_CONCURRENCY,
  log = console,
}) {
  return async function refreshUserPublicBadges() {
    const refs = await db.collection(USERS).listDocuments();
    const failures = [];
    for (let start = 0; start < refs.length; start += concurrency) {
      const group = refs.slice(start, start + concurrency);
      const results = await Promise.allSettled(
        group.map((ref) => syncUserPublic({ uid: ref.id })),
      );
      for (const result of results) {
        if (result.status === 'rejected') failures.push(result.reason);
      }
    }
    if (failures.length > 0) {
      log.error(`refreshUserPublicBadges: ${failures.length} projection(s) failed`);
      throw new Error(`Could not refresh ${failures.length} public profile projection(s).`, {
        cause: failures[0],
      });
    }
    return { scanned: refs.length };
  };
}

/** Drop the fields the projection stamps rather than derives. */
function stripStamps(data) {
  if (!data || typeof data !== 'object') return data;
  const { updatedAt: _updatedAt, uid: _uid, ...rest } = data;
  return rest;
}

/** Deployable exports (spec §1.3 users/): syncUserPublic and badge refresh. */
function buildHandlers() {
  const { onDocumentWritten } = require('firebase-functions/v2/firestore');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';

  return {
    syncUserPublic: onDocumentWritten({
      region,
      document: 'users/{uid}',
    }, async (event) => {
      const { getDb } = require('../core/firestore.cjs');
      const db = getDb();
      const handler = createSyncUserPublic({ db });
      // The event's snapshots are deliberately unused — see
      // createSyncUserPublic: the handler re-reads the source document.
      await handler({ uid: event.params.uid });
    }),
    refreshUserPublicBadges: onDocumentWritten({
      region,
      retry: true,
      timeoutSeconds: 540,
      document: 'config/badges',
    }, async () => {
      const { getDb } = require('../core/firestore.cjs');
      const db = getDb();
      await createRefreshUserPublicBadges({ db })();
    }),
  };
}

module.exports = {
  createSyncUserPublic,
  createRefreshUserPublicBadges,
  get handlers() {
    return buildHandlers();
  },
  internals: {
    sameProjection,
    USERS,
    USERS_PUBLIC,
    BADGES_CONFIG,
    REFRESH_CONCURRENCY,
  },
};
