'use strict';

/**
 * Ticketing → registration orchestration (spec §1.3 `registration.cjs`,
 * §3.3 step 4, §3.4).
 *
 * Two entry points, one claim path:
 *   • `ticketingVerifyOrder` — the attendee's self-service claim ("I have
 *     order 1234"). The reference implementation's `verifyEventbriteOrder`
 *     lived here and rejected any order belonging to a different event;
 *     that rule survives, expressed once against `provider.externalEventId`
 *     (§3.3).
 *   • `createUserFromTicket` — the organizer's path: turn a ticket nobody
 *     has claimed into an account, then claim it for that account.
 *
 * The claim itself is ONE single-document transaction on
 * `tickets/{externalId}` — the whole point of collapsing the matched and
 * unmatched collections into one (§4.2). There is no cross-collection
 * claim and no drift class for a reconciliation script to detect.
 *
 * Provider-specific behavior stays in the adapters: this module never
 * parses a provider payload, only the normalized TicketRecord shape.
 */

const { isValidTransition } = require('shared/registration');
const {
  internals: { TICKETS, safeDocId },
} = require('./index.cjs');
const { upsertTickets } = require('./sync.cjs');

const USERS = 'users';

/** Longest order number this endpoint will look up. */
const MAX_ORDER_NUMBER_LEN = 128;

/**
 * Advance `users/{uid}` for a freshly claimed ticket (§3.4).
 *
 * `pending → ticketed` on a claim; `ticketed → approved` only when
 * `config/features.autoApproveTicketHolders` is on, and then with
 * `approvalSource: 'ticket'` — never `'admin'`, because only an explicit
 * organizer decision may survive a later refund (§3.4).
 *
 * Every edge is checked against the shared transition table so the server
 * and the frontend cannot disagree about what the state machine allows.
 *
 * @param {{ db: object, uid: string, getConfig?: () => Promise<object>,
 *           now?: () => Date }} deps
 * @returns {Promise<{ registrationStatus: string|null, changed: boolean }>}
 */
async function applyTicketClaimToUser({ db, uid, getConfig, now = () => new Date() }) {
  const config = typeof getConfig === 'function' ? await getConfig() : null;
  const autoApprove = config?.features?.autoApproveTicketHolders === true;
  const ref = db.collection(USERS).doc(uid);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { registrationStatus: null, changed: false };
    const current = snap.data()?.registrationStatus ?? null;

    let next = current;
    const patch = { updatedAt: now() };
    if (isValidTransition(current, 'ticketed', 'ticket_claimed')) {
      next = 'ticketed';
    }
    if (autoApprove && isValidTransition(next, 'approved', 'auto_approve')) {
      next = 'approved';
      patch.approvalSource = 'ticket';
    }
    if (next === current) return { registrationStatus: current, changed: false };

    patch.registrationStatus = next;
    tx.set(ref, patch, { merge: true });
    return { registrationStatus: next, changed: true };
  });
}

/**
 * Claim one ticket for one uid, atomically.
 *
 * Refusals are values, not exceptions: a ticket already claimed by
 * somebody else is an ordinary outcome of a mistyped order number, not an
 * error condition.
 *
 * @param {{ db: object, externalId: string, uid: string, email?: string|null,
 *           now?: () => Date }} deps
 * @returns {Promise<{ claimed: boolean, reason?: string }>}
 */
async function claimTicket({ db, externalId, uid, email = null, now = () => new Date() }) {
  const id = safeDocId(externalId);
  if (!id) return { claimed: false, reason: 'invalid_id' };
  const ref = db.collection(TICKETS).doc(id);
  const wanted = typeof email === 'string' ? email.trim().toLowerCase() : null;

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { claimed: false, reason: 'not_found' };
    const data = snap.data() || {};
    if (data.claimedByUid === uid) return { claimed: false, reason: 'already_mine' };
    if (data.claimedByUid) return { claimed: false, reason: 'claimed_by_other' };
    // The address is the identity link between a ticket and an account,
    // so a claim for a different address is refused even when the caller
    // knows the order number.
    if (wanted && typeof data.email === 'string' && data.email.toLowerCase() !== wanted) {
      return { claimed: false, reason: 'email_mismatch' };
    }
    const at = now();
    tx.set(ref, { claimedByUid: uid, claimedAt: at, updatedAt: at }, { merge: true });
    return { claimed: true };
  });
}

/**
 * Claim a set of tickets for a uid and advance the account's registration
 * state once, at the end (§3.4 recomputes over the whole set, never per
 * ticket).
 *
 * @param {{ db: object, uid: string, email?: string|null, externalIds: string[],
 *           getConfig?: () => Promise<object>, now?: () => Date }} deps
 */
async function claimTicketsForUser({ db, uid, email = null, externalIds, getConfig, now = () => new Date() }) {
  const claimed = [];
  const refused = [];
  for (const externalId of Array.isArray(externalIds) ? externalIds : []) {
    const result = await claimTicket({ db, externalId, uid, email, now });
    if (result.claimed) claimed.push(externalId);
    else refused.push({ externalId, reason: result.reason });
  }
  const state = claimed.length > 0
    ? await applyTicketClaimToUser({ db, uid, getConfig, now })
    : { registrationStatus: null, changed: false };
  return { claimed, refused, ...state };
}

/**
 * Read an order from the provider for a self-service claim.
 *
 * `lookupByOrderNumber` is the optional, purpose-built call (§3.3) — the
 * manual adapter implements it as an exact match against imported rows.
 * Providers without it fall back to `fetchOrder`, whose result also
 * carries the event id the wrong-event rule needs.
 *
 * @returns {Promise<{ tickets: object[] } | { rejected: string }>}
 */
async function lookupOrder({ provider, orderNumber, email }) {
  if (typeof provider.lookupByOrderNumber === 'function') {
    const tickets = await provider.lookupByOrderNumber(orderNumber, email);
    if (!Array.isArray(tickets) || tickets.length === 0) return { rejected: 'not_found' };
    return { tickets };
  }
  const order = await provider.fetchOrder(orderNumber);
  if (!order) return { rejected: 'not_found' };
  // The reference implementation's one durable rule: an order for another
  // event is not a ticket to this one, however valid it looks (§3.3).
  if (provider.externalEventId && order.externalEventId !== provider.externalEventId) {
    return { rejected: 'wrong_event' };
  }
  if (!Array.isArray(order.tickets) || order.tickets.length === 0) return { rejected: 'not_found' };
  return { tickets: order.tickets };
}

/**
 * `ticketingVerifyOrder` — attendee self-service claim.
 *
 * Requires a signed-in caller with a VERIFIED email: the address is what
 * binds a ticket to an account, so an unverified one would let anybody
 * claim a stranger's ticket by typing their address at sign-up.
 *
 * Every failure — unknown order, another event's order, a ticket
 * belonging to a different address, an already-claimed ticket — returns
 * the SAME 404. An endpoint that distinguished them would answer "does
 * order 1234 exist" and "whose address is on it" for any signed-in
 * caller.
 *
 * @param {{ db: object, provider: object, auth: object,
 *           getConfig: () => Promise<object>, now?: () => Date, log?: object }} deps
 */
function createTicketingVerifyOrderHandler({ db, provider, auth, getConfig, now = () => new Date(), log = console }) {
  const { verifyAuthToken } = require('../core/auth.cjs');
  const notFound = { error: { code: 'not-found', message: 'No ticket matches that order number.' } };

  return async function ticketingVerifyOrder(req, res) {
    if (req.method !== 'POST') {
      res.set('Allow', 'POST');
      res.status(405).json({ error: { code: 'method-not-allowed', message: 'Use POST.' } });
      return;
    }
    const decoded = await verifyAuthToken({ auth }, req);
    if (!decoded?.uid) {
      res.status(401).json({ error: { code: 'unauthorized', message: 'Authentication required.' } });
      return;
    }
    const email = typeof decoded.email === 'string' ? decoded.email.trim().toLowerCase() : '';
    if (!email || decoded.email_verified !== true) {
      res.status(403).json({
        error: { code: 'forbidden', message: 'Verify your email address before claiming a ticket.' },
      });
      return;
    }

    const orderNumber = typeof req.body?.orderNumber === 'string' ? req.body.orderNumber.trim() : '';
    if (!orderNumber || orderNumber.length > MAX_ORDER_NUMBER_LEN) {
      res.status(400).json({ error: { code: 'bad-request', message: 'orderNumber is required.' } });
      return;
    }

    let found = null;
    try {
      found = await lookupOrder({ provider, orderNumber, email });
    } catch (err) {
      log.error('ticketing: order lookup failed', err);
      res.status(502).json({
        error: { code: 'provider-error', message: 'The ticketing provider could not be reached.' },
      });
      return;
    }
    if (found.rejected) {
      res.status(404).json(notFound);
      return;
    }

    // Persist what the provider returned before claiming it: the claim is
    // a write to `tickets/{externalId}`, so the document has to exist, and
    // storing it is also how a later sync recognizes the ticket.
    await upsertTickets({ db, tickets: found.tickets, providerName: provider.name, now, log });

    const mine = found.tickets
      .filter((t) => typeof t?.email === 'string' && t.email.trim().toLowerCase() === email)
      .map((t) => t.externalId);
    if (mine.length === 0) {
      res.status(404).json(notFound);
      return;
    }

    const result = await claimTicketsForUser({
      db, uid: decoded.uid, email, externalIds: mine, getConfig, now,
    });
    if (result.claimed.length === 0) {
      // Already claimed (by this account or another): the same answer, for
      // the same no-oracle reason.
      res.status(404).json(notFound);
      return;
    }
    res.status(200).json({
      ok: true,
      claimed: result.claimed.length,
      registrationStatus: result.registrationStatus,
    });
  };
}

/**
 * `createUserFromTicket` — organizer path. Creates (or reuses) the account
 * for a ticket's email address and claims the ticket for it.
 *
 * `users/{uid}` is seeded with the SAME document the auth onCreate trigger
 * writes (users/lifecycle.cjs `buildNewUserDoc`), through create(), so the
 * two paths cannot produce different accounts and whichever runs second is
 * a no-op.
 *
 * @param {{ db: object, auth: object, getConfig: () => Promise<object>,
 *           now?: () => Date, log?: object }} deps
 */
function createCreateUserFromTicketHandler({ db, auth, getConfig, now = () => new Date(), log = console }) {
  const { requireAdmin } = require('../core/auth.cjs');
  const { buildNewUserDoc } = require('../users/lifecycle.cjs');

  return async function createUserFromTicket(req, res) {
    if (req.method !== 'POST') {
      res.set('Allow', 'POST');
      res.status(405).json({ error: { code: 'method-not-allowed', message: 'Use POST.' } });
      return;
    }
    const verdict = await requireAdmin({ auth, getConfig }, req);
    if (!verdict.ok) {
      res.status(verdict.status).json({ error: { code: verdict.code, message: verdict.message } });
      return;
    }

    const externalId = safeDocId(req.body?.externalId);
    if (!externalId) {
      res.status(400).json({ error: { code: 'bad-request', message: 'externalId is required.' } });
      return;
    }

    const snap = await db.collection(TICKETS).doc(externalId).get();
    if (!snap.exists) {
      res.status(404).json({ error: { code: 'not-found', message: 'No such ticket.' } });
      return;
    }
    const ticket = snap.data() || {};
    if (ticket.claimedByUid) {
      res.status(200).json({ ok: true, uid: ticket.claimedByUid, created: false, alreadyClaimed: true });
      return;
    }
    const email = typeof ticket.email === 'string' ? ticket.email.trim().toLowerCase() : '';
    if (!email) {
      res.status(422).json({
        error: { code: 'unprocessable', message: 'That ticket carries no email address.' },
      });
      return;
    }

    let user = null;
    let created = false;
    try {
      user = await auth.getUserByEmail(email);
    } catch {
      // Not found (or an unusable record): create the account. A failure
      // here is a real error and propagates below.
      user = await auth.createUser({
        email,
        displayName: [ticket.firstName, ticket.lastName].filter(Boolean).join(' ') || undefined,
      });
      created = true;
    }

    try {
      await db.collection(USERS).doc(user.uid).create(
        buildNewUserDoc({ uid: user.uid, email, displayName: user.displayName || null }, now()),
      );
    } catch (err) {
      // The auth trigger got there first: exactly the intended outcome.
      if (!(err?.code === 6 || err?.code === 'already-exists' ||
            /ALREADY_EXISTS/i.test(String(err?.message || '')))) {
        throw err;
      }
    }

    const result = await claimTicketsForUser({
      db, uid: user.uid, email, externalIds: [externalId], getConfig, now,
    });
    if (result.claimed.length === 0) {
      log.warn(`ticketing: could not claim ${externalId} for ${user.uid}: ${result.refused[0]?.reason}`);
      res.status(409).json({
        error: { code: 'conflict', message: 'That ticket could not be claimed for this account.' },
      });
      return;
    }
    res.status(200).json({
      ok: true,
      uid: user.uid,
      created,
      registrationStatus: result.registrationStatus,
    });
  };
}

/** Deployable exports (spec §1.3): ticketingVerifyOrder, createUserFromTicket. */
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const { defineSecret } = require('firebase-functions/params');
  const { ticketingSecretNames } = require('./providers/index.cjs');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  const secrets = ticketingSecretNames(process.env).map(defineSecret);

  const withCors = (handler) => async (req, res) => {
    const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
    const handled = applyCors(req, res, {
      allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS),
    });
    if (handled) return;
    await handler(req, res);
  };

  return {
    ticketingVerifyOrder: onRequest({ region, secrets }, withCors(async (req, res) => {
      const { buildTicketingDeps } = require('./index.cjs');
      await createTicketingVerifyOrderHandler(buildTicketingDeps())(req, res);
    })),
    createUserFromTicket: onRequest({ region, secrets }, withCors(async (req, res) => {
      const { buildTicketingDeps } = require('./index.cjs');
      const { db, getConfig, auth } = buildTicketingDeps();
      await createCreateUserFromTicketHandler({ db, getConfig, auth })(req, res);
    })),
  };
}

module.exports = {
  createTicketingVerifyOrderHandler,
  createCreateUserFromTicketHandler,
  claimTicket,
  claimTicketsForUser,
  applyTicketClaimToUser,
  get handlers() {
    return buildHandlers();
  },
  internals: { lookupOrder, MAX_ORDER_NUMBER_LEN, USERS },
};
