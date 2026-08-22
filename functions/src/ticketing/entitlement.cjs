'use strict';

/**
 * Entitlement recomputation and the ticket trigger that drives it
 * (spec §3.4, issue #32).
 *
 * `packages/shared/src/registration.cjs` owns the VOCABULARY — the four
 * statuses, the transition table (`isValidTransition`), and the
 * `entitled = hasValidTicket || approvalSource == 'admin'` formula
 * (`computeEntitlement`). This module is the ORCHESTRATION: the one place
 * that reads both grant sources for a uid, applies those two functions, and
 * writes `users/{uid}.registrationStatus` / `.approvalSource`.
 *
 * Two properties the spec insists on, and how they are obtained here:
 *
 *   1. **Revocation recomputes over the whole set, never reacts to one
 *      ticket** (§3.4). A user can hold several claimed tickets — a group
 *      order, a replacement, a workshop add-on — so "a ticket became
 *      refunded" is a reason to recompute, not a revocation condition. The
 *      recomputation therefore never looks at the ticket that woke it; it
 *      queries every ticket claimed by the uid.
 *
 *   2. **An explicit admin approval survives every ticket refund** (§3.4).
 *      `approvalSource == 'admin'` makes `entitled` true on its own, so no
 *      ticket change can ever move an admin-approved attendee to `revoked`.
 *      That is enforced by the shared formula, not by a branch here.
 *
 * The trigger is a wake-up, not data (same contract as
 * `users/projection.cjs`): `onTicketWritten` takes only the affected uid(s)
 * from the event and re-reads the live ticket set and account document
 * inside a transaction. Out-of-order and replayed deliveries therefore
 * converge — the last writer is by definition the one that read the newest
 * state — and `retry: true` is safe because a run that computes no change
 * writes nothing.
 */

const { isValidTransition, computeEntitlement } = require('shared/registration');
const {
  internals: { TICKETS },
} = require('./index.cjs');

const USERS = 'users';

/** The ticket status that confers entitlement (§3.3 TicketRecord, §3.4). */
const VALID = 'valid';

/**
 * "We do not know yet" (§3.3): a ticket the provider has not fully
 * described, and the bucket every unrecognized provider status normalizes
 * into (`sync.cjs` normalizeTicket).
 */
const UNDECIDED = 'pending_info';

/**
 * The uid(s) whose entitlement one ticket write can have changed.
 *
 * BOTH images matter. A claim that moves (an organizer re-assigning a
 * ticket) or clears (an account deleted, a mis-claim undone) leaves the
 * PREVIOUS holder with one fewer claimed ticket, and nothing else will ever
 * wake a recomputation for them — the ticket no longer names them.
 *
 * @param {{ claimedByUid?: unknown } | null | undefined} before
 * @param {{ claimedByUid?: unknown } | null | undefined} after
 * @returns {string[]} unique, non-empty uids
 */
function affectedUids(before, after) {
  const uids = new Set();
  for (const image of [before, after]) {
    const uid = image?.claimedByUid;
    if (typeof uid === 'string' && uid.length > 0) uids.add(uid);
  }
  return [...uids];
}

/**
 * Recompute one account's registration state from both grant sources
 * (spec §3.4), transactionally and idempotently.
 *
 * The algorithm, exactly as §3.4 states it:
 *
 *     hasValidTicket = tickets.where('claimedByUid','==',uid)
 *                             .where('status','==','valid') is non-empty
 *     hasAdminGrant  = users/{uid}.approvalSource == 'admin'
 *     entitled       = hasValidTicket || hasAdminGrant
 *
 * `entitled === false` is the ONLY thing that may move a `ticketed` or
 * `approved` user to `revoked`, and every edge it writes is checked against
 * the shared transition table first, so this module can never invent a
 * transition the table does not have. Three consequences worth naming,
 * because each is a rule read straight off that table:
 *
 *   • `pending` never becomes `revoked` — there is no such edge. An account
 *     that never held a ticket simply stays `pending`.
 *   • `revoked` is terminal here. `revoked → approved` exists only under
 *     `admin_reapproval`, so a later ticket sync can never undo an admin
 *     revocation (§3.4: "An admin revocation is explicit and separate …  so
 *     it is never undone by a later ticket sync").
 *   • Auto-approval writes `approvalSource: 'ticket'`, NEVER `'admin'`:
 *     only an explicit organizer decision may survive a refund.
 *
 * ONE deliberate departure from a literal reading, and it is a narrowing:
 * when the user is not entitled but still holds a `pending_info` ticket, the
 * account is HELD at its current state instead of being revoked.
 * `pending_info` is §3.3's explicit "we do not know yet" bucket (it is also
 * where every unrecognized provider status lands), `revoked` is terminal for
 * this function by the rule above, and the claim path marks an account
 * `ticketed` the moment a ticket is claimed — whatever its status — so
 * revoking on ignorance would strand a brand-new claimant of a
 * not-yet-described ticket in a state only an admin could leave. Revocation
 * here waits for evidence (`refunded`/`cancelled`, or no claimed ticket at
 * all), never absence of it.
 *
 * @param {{ db: object, uid: string, getConfig?: () => Promise<object>,
 *           now?: () => Date }} deps
 * @returns {Promise<{ uid: string, action: 'updated'|'unchanged'|'held'|'missing',
 *                     registrationStatus: string|null, approvalSource: string|null }>}
 */
async function recomputeEntitlement({ db, uid, getConfig, now = () => new Date() }) {
  if (typeof uid !== 'string' || uid.length === 0) {
    return { uid: '', action: 'missing', registrationStatus: null, approvalSource: null };
  }

  // Read the feature flag OUTSIDE the transaction, as the claim path does
  // (registration.cjs applyTicketClaimToUser): `config/features` is a
  // cached read, it does not fire this trigger, and it can only ever widen
  // access — a stale read cannot revoke anybody.
  const config = typeof getConfig === 'function' ? await getConfig() : null;
  const autoApprove = config?.features?.autoApproveTicketHolders === true;

  const userRef = db.collection(USERS).doc(uid);
  const claimed = db.collection(TICKETS).where('claimedByUid', '==', uid);
  // Two `limit(1)` existence probes rather than a scan of the user's whole
  // ticket set: both are served by the one composite index this query shape
  // needs (firestore.indexes.json, tickets: claimedByUid + status), and the
  // answer either way is a boolean.
  const validQuery = claimed.where('status', '==', VALID).limit(1);
  const undecidedQuery = claimed.where('status', '==', UNDECIDED).limit(1);

  return db.runTransaction(async (tx) => {
    // Reads first, all inside the transaction: the account document and the
    // ticket set have to be seen at one consistent instant, or a concurrent
    // claim could be counted by neither this run nor the one it races.
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) {
      return { uid, action: 'missing', registrationStatus: null, approvalSource: null };
    }
    const validSnap = await tx.get(validQuery);
    const data = userSnap.data() || {};
    const current = data.registrationStatus ?? null;
    const approvalSource = data.approvalSource ?? null;

    const hasValidTicket = validSnap.empty === true ? false : validSnap.size > 0;
    const entitled = computeEntitlement({ hasValidTicket, approvalSource });

    let next = current;
    let nextSource = approvalSource;

    if (entitled) {
      // A claimed ticket is what makes a pending account `ticketed`; the
      // flag is what may then carry it to `approved` (§3.4 table).
      if (hasValidTicket && isValidTransition(current, 'ticketed', 'ticket_claimed')) {
        next = 'ticketed';
      }
      if (hasValidTicket && autoApprove && isValidTransition(next, 'approved', 'auto_approve')) {
        next = 'approved';
        nextSource = 'ticket';
      }
    } else {
      const undecidedSnap = await tx.get(undecidedQuery);
      const hasUndecidedTicket = undecidedSnap.empty === true ? false : undecidedSnap.size > 0;
      if (hasUndecidedTicket) {
        return { uid, action: 'held', registrationStatus: current, approvalSource };
      }
      if (isValidTransition(current, 'revoked', 'entitlement_lost')) {
        next = 'revoked';
        // The grant that is gone stops being recorded. `approvalSource` says
        // which source GRANTED access (§3.4); with no grant left there is
        // none to name. This can only ever clear a `'ticket'` source —
        // `'admin'` makes `entitled` true, so this branch is unreachable for
        // an admin-approved account.
        nextSource = null;
      }
    }

    if (next === current && nextSource === approvalSource) {
      return { uid, action: 'unchanged', registrationStatus: current, approvalSource };
    }
    tx.set(
      userRef,
      { registrationStatus: next, approvalSource: nextSource, updatedAt: now() },
      { merge: true },
    );
    return { uid, action: 'updated', registrationStatus: next, approvalSource: nextSource };
  });
}

/**
 * Core of the `onTicketWritten` trigger, driven directly by tests with a
 * fake db.
 *
 * The event carries only WHO to recompute; every value is re-read inside
 * `recomputeEntitlement`'s transaction. A replayed delivery therefore
 * recomputes the same answer and writes nothing, which is what makes
 * `retry: true` safe.
 *
 * Failures are rethrown, not swallowed: a recomputation that did not happen
 * leaves an account's access wrong, and the retry is the recovery.
 *
 * @param {{ db: object, getConfig?: () => Promise<object>, now?: () => Date,
 *           log?: { error: Function } }} deps
 * @returns {(change: { before?: object|null, after?: object|null }) =>
 *   Promise<{ recomputed: Array<object> }>}
 */
function createOnTicketWritten({ db, getConfig, now = () => new Date(), log = console }) {
  return async function onTicketWritten({ before = null, after = null } = {}) {
    const uids = affectedUids(before, after);
    const recomputed = [];
    for (const uid of uids) {
      try {
        recomputed.push(await recomputeEntitlement({ db, uid, getConfig, now }));
      } catch (err) {
        // Name the account before rethrowing: the retry is automatic, but an
        // operator reading logs needs to know whose entitlement is stale.
        log.error(`onTicketWritten: recompute failed for ${uid}`, err);
        throw err;
      }
    }
    return { recomputed };
  };
}

/** Deployable exports (spec §1.3 ticketing/): onTicketWritten. */
function buildHandlers() {
  const { onDocumentWritten } = require('firebase-functions/v2/firestore');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';

  return {
    onTicketWritten: onDocumentWritten({
      region,
      // Same crash-recovery model as the projection triggers: a dropped
      // delivery would leave an account entitled after a refund (or shut out
      // after a claim), and the recomputation is idempotent by construction.
      retry: true,
      document: 'tickets/{externalId}',
    }, async (event) => {
      const { getDb } = require('../core/firestore.cjs');
      const { getEventConfig } = require('../core/config.cjs');
      const db = getDb();
      const before = event.data?.before;
      const after = event.data?.after;
      // The snapshots are used ONLY to identify the affected accounts — the
      // handler re-reads every value it acts on.
      await createOnTicketWritten({ db, getConfig: () => getEventConfig({ db }) })({
        before: before && before.exists ? before.data() : null,
        after: after && after.exists ? after.data() : null,
      });
    }),
  };
}

module.exports = {
  recomputeEntitlement,
  createOnTicketWritten,
  get handlers() {
    return buildHandlers();
  },
  internals: { affectedUids, USERS, VALID, UNDECIDED },
};
