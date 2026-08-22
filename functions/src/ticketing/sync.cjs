'use strict';

/**
 * The sync queue and the ticket upsert (spec §3.3 steps 3–4, §4.2).
 *
 * `ticket_sync_queue` is the ONLY queue in the system (§10 question 9, and
 * CONTRIBUTING.md says so). It exists for one reason: the ticketing
 * provider's own read APIs are eventually consistent, so an order that a
 * webhook announces is frequently not yet readable — `fetchOrder()` comes
 * back with `complete: false` and placeholder attendees. The reference
 * implementation skipped those attendees and dropped the order silently;
 * here the row stays until it succeeds, and exhausting the attempt cap
 * pages an operator.
 *
 * Crash safety, in order:
 *   1. LEASE FIRST. The attempt counter and the next `readyAt` are written
 *      BEFORE `fetchOrder()` is called. A container that dies mid-fetch
 *      therefore resumes with the attempt spent — a poison order cannot
 *      spin forever — and a concurrent drain sees a row that is not ready.
 *   2. The queue row is deleted only AFTER the tickets are upserted. A
 *      crash between the two replays the upsert, which is idempotent
 *      (`tickets/{externalId}` is keyed by the provider's own dedup key).
 *   3. An exhausted row is never deleted. It is the forensic record of the
 *      order that could not be read, and the operator alert points at it.
 */

const {
  internals: { TICKETS, SYNC_QUEUE, QUEUE_PENDING, QUEUE_EXHAUSTED, TICKET_STATUSES, safeDocId },
} = require('./index.cjs');

/** Attempt cap before an operator is paged (spec §3.3 step 3). */
const MAX_ATTEMPTS = 6;

/** Exponential backoff, anchored on the 2-minute drain interval (§3.3). */
const BASE_BACKOFF_MS = 2 * 60 * 1000;
const MAX_BACKOFF_MS = 60 * 60 * 1000;

/** Rows one drain touches. Bounded so a backlog cannot exceed the run's timeout. */
const DRAIN_LIMIT = 25;

/** Pages one manual full sync will walk before it reports itself truncated. */
const MAX_SYNC_PAGES = 50;

/** @param {number} attempts 1-based @returns {number} ms */
function backoffMsFor(attempts) {
  const n = Math.max(1, Number.isFinite(attempts) ? attempts : 1);
  return Math.min(BASE_BACKOFF_MS * 2 ** (n - 1), MAX_BACKOFF_MS);
}

/** @param {unknown} value @returns {number} ms since epoch, or NaN */
function toMillis(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (value && typeof value.toDate === 'function') return value.toDate().getTime();
  if (typeof value === 'string') return Date.parse(value);
  return NaN;
}

/**
 * Normalize one provider TicketRecord into the `tickets/{externalId}`
 * shape (§3.3, §4.2). Returns null for a record with no usable dedup key —
 * a ticket we cannot key is a ticket we cannot upsert idempotently, and
 * writing it under a generated id would create the duplicate class this
 * collection exists to remove.
 *
 * An unrecognized `status` becomes `pending_info` rather than being
 * dropped: `pending_info` is exactly the "we do not know yet" bucket
 * (§3.3), and it confers no entitlement (§3.4 counts only `valid`), so the
 * conservative mapping is also the safe one.
 *
 * @param {object} record @param {string} providerName
 * @returns {object|null}
 */
function normalizeTicket(record, providerName) {
  const externalId = safeDocId(record?.externalId);
  if (!externalId) return null;
  const email = typeof record?.email === 'string' ? record.email.trim().toLowerCase() : '';
  const quantity = Number.isInteger(record?.quantity) && record.quantity > 0 ? record.quantity : 1;
  const status = TICKET_STATUSES.includes(record?.status) ? record.status : 'pending_info';
  const str = (v) => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : null);
  return {
    externalId,
    orderId: str(record?.orderId),
    email: email || null,
    firstName: str(record?.firstName),
    lastName: str(record?.lastName),
    ticketClass: str(record?.ticketClass),
    quantity,
    purchasedAt: str(record?.purchasedAt),
    status,
    provider: providerName,
    raw: record?.raw && typeof record.raw === 'object' ? record.raw : null,
  };
}

/**
 * Upsert one ticket. Idempotent by construction and claim-preserving: the
 * claim fields (`claimedByUid`, `claimedAt`, `claimPromptSentAt`) are
 * initialized only when the document is created, so a re-sync of an
 * already-claimed ticket can never unclaim it. `createdAt` survives for
 * the same reason.
 *
 * The read and the write are one transaction so that a concurrent claim
 * (registration.cjs) either happens entirely before or entirely after this
 * write — Firestore aborts and re-runs the loser.
 *
 * @param {{ db: object, ticket: object, now?: () => Date }} deps
 * @returns {Promise<{ action: 'created'|'updated' }>}
 */
async function upsertTicket({ db, ticket, now = () => new Date() }) {
  const ref = db.collection(TICKETS).doc(ticket.externalId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const at = now();
    if (!snap.exists) {
      tx.set(ref, {
        ...ticket,
        claimedByUid: null,
        claimedAt: null,
        claimPromptSentAt: null,
        createdAt: at,
        updatedAt: at,
      });
      return { action: 'created' };
    }
    tx.set(ref, { ...ticket, updatedAt: at }, { merge: true });
    return { action: 'updated' };
  });
}

/**
 * Upsert a provider's ticket list. Unkeyable records are counted and
 * skipped, never guessed at.
 *
 * @param {{ db: object, tickets: object[], providerName: string,
 *           now?: () => Date, log?: Pick<Console,'warn'> }} deps
 * @returns {Promise<{ created: number, updated: number, skipped: number }>}
 */
async function upsertTickets({ db, tickets, providerName, now = () => new Date(), log = console }) {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const record of Array.isArray(tickets) ? tickets : []) {
    const normalized = normalizeTicket(record, providerName);
    if (!normalized) {
      skipped += 1;
      log.warn('ticketing: skipped a ticket with no usable externalId');
      continue;
    }
    const { action } = await upsertTicket({ db, ticket: normalized, now });
    if (action === 'created') created += 1;
    else updated += 1;
  }
  return { created, updated, skipped };
}

/**
 * Mark a queue row exhausted and page the operator (§3.3 step 3). The row
 * is kept: "placeholder-data orders alert instead of vanishing" is the
 * whole point, and an operator needs the row to see what was lost.
 */
async function exhaustRow({ db, orderId, attempts, reason, notifyOperator, now, log }) {
  const at = now();
  await db.collection(SYNC_QUEUE).doc(orderId).set({
    status: QUEUE_EXHAUSTED,
    attempts,
    exhaustedAt: at,
    lastError: reason,
    updatedAt: at,
  }, { merge: true });

  if (typeof notifyOperator === 'function') {
    try {
      await notifyOperator({
        kind: 'error',
        title: `ticket sync gave up on order ${orderId}`,
        summary:
          `${attempts} attempts failed to read a complete order from the ticketing provider ` +
          `(${reason}). The order is parked in ${SYNC_QUEUE}/${orderId}; nobody has been ` +
          'registered from it.',
        fields: { orderId, attempts: String(attempts), reason },
        dedupeKey: `ticket-sync-exhausted:${orderId}`,
      });
    } catch (err) {
      // Alerting must never turn a drain into a failed run.
      log.warn('ticketing: operator notify failed', err);
    }
  }
}

/**
 * Drain the sync queue once. Scheduled every 2 minutes (§3.3 step 3).
 *
 * @param {{ db: object, provider: object,
 *           notifyOperator?: (e: object) => Promise<object>,
 *           now?: () => Date, limit?: number, log?: Pick<Console,'warn'|'error'> }} deps
 * @returns {Promise<{ scanned: number, completed: number, retried: number,
 *                     exhausted: number, skipped: number }>}
 */
async function drainTicketSyncQueue({
  db,
  provider,
  notifyOperator,
  now = () => new Date(),
  limit = DRAIN_LIMIT,
  log = console,
}) {
  const nowMs = now().getTime();
  // `status == pending` ordered by readyAt: the ready rows are a prefix of
  // that ordering, so an over-read plus an in-memory cutoff is exact, and
  // it keeps the query to one composite index (firestore.indexes.json).
  const snap = await db.collection(SYNC_QUEUE)
    .where('status', '==', QUEUE_PENDING)
    .orderBy('readyAt')
    .limit(limit)
    .get();

  const summary = { scanned: 0, completed: 0, retried: 0, exhausted: 0, skipped: 0 };

  for (const doc of snap.docs) {
    const row = doc.data() || {};
    const readyAtMs = toMillis(row.readyAt);
    // An unparseable readyAt is treated as ready: a row that cannot be
    // scheduled must still be worked, not stranded.
    if (Number.isFinite(readyAtMs) && readyAtMs > nowMs) continue;

    const orderId = safeDocId(doc.id);
    if (!orderId) {
      summary.skipped += 1;
      continue;
    }
    summary.scanned += 1;

    const attempts = (Number.isInteger(row.attempts) ? row.attempts : 0) + 1;
    const at = now();
    // Lease first (see the module doc): the attempt is spent before the
    // provider is called, so a crash cannot buy an unbounded retry.
    await doc.ref.set({
      attempts,
      readyAt: new Date(at.getTime() + backoffMsFor(attempts)),
      lastAttemptAt: at,
      updatedAt: at,
    }, { merge: true });

    let order = null;
    try {
      order = await provider.fetchOrder(orderId);
    } catch (err) {
      const reason = `fetchOrder failed: ${String(err?.message || err)}`;
      log.warn(`ticketing: ${reason}`);
      if (attempts >= MAX_ATTEMPTS) {
        await exhaustRow({ db, orderId, attempts, reason, notifyOperator, now, log });
        summary.exhausted += 1;
      } else {
        summary.retried += 1;
      }
      continue;
    }

    // Wrong-event orders are not our work and must not occupy the queue.
    // Same rule as the webhook's wrong-event branch (§3.3): one configured
    // event id, compared in one place per surface.
    if (provider.externalEventId && order?.externalEventId &&
        order.externalEventId !== provider.externalEventId) {
      log.warn(`ticketing: dropped order ${orderId} for a different event`);
      await doc.ref.delete();
      summary.skipped += 1;
      continue;
    }

    if (order?.complete !== true) {
      // The provider says the attendee data is not populated yet — the
      // exact case the queue exists for. The backoff is already written.
      if (attempts >= MAX_ATTEMPTS) {
        await exhaustRow({
          db, orderId, attempts, reason: 'order never became complete', notifyOperator, now, log,
        });
        summary.exhausted += 1;
      } else {
        summary.retried += 1;
      }
      continue;
    }

    await upsertTickets({ db, tickets: order.tickets, providerName: provider.name, now, log });
    // Only now: the row is the only durable record that this order still
    // needs work.
    await doc.ref.delete();
    summary.completed += 1;
  }

  return summary;
}

/**
 * Manual/admin-triggered full sync (spec §1.3 `ticketingSync`). Walks
 * `listTickets()` and upserts every page. Deliberately NOT a queue write:
 * the queue is for orders a webhook announced before the provider could
 * serve them; a full sync reads what the provider already has.
 *
 * Bounded by MAX_SYNC_PAGES so a provider that returns a non-terminating
 * page cursor cannot spin the function until its timeout.
 *
 * @param {{ db: object, provider: object, since?: string,
 *           now?: () => Date, log?: object }} deps
 */
async function runFullSync({ db, provider, since, now = () => new Date(), log = console }) {
  const totals = { created: 0, updated: 0, skipped: 0, pages: 0, truncated: false };
  let pageToken;
  for (let page = 0; page < MAX_SYNC_PAGES; page += 1) {
    const result = await provider.listTickets({ since, pageToken });
    totals.pages += 1;
    const counts = await upsertTickets({
      db, tickets: result?.tickets, providerName: provider.name, now, log,
    });
    totals.created += counts.created;
    totals.updated += counts.updated;
    totals.skipped += counts.skipped;
    pageToken = result?.nextPageToken || null;
    if (!pageToken) return totals;
  }
  totals.truncated = true;
  log.warn(`ticketing: full sync stopped after ${MAX_SYNC_PAGES} pages`);
  return totals;
}

/**
 * Admin-gated HTTP handler for `ticketingSync`.
 *
 * @param {{ db: object, provider: object, auth: object,
 *           getConfig: () => Promise<object>, now?: () => Date }} deps
 */
function createTicketingSyncHandler({ db, provider, auth, getConfig, now, log = console }) {
  const { requireAdmin } = require('../core/auth.cjs');
  return async function ticketingSync(req, res) {
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
    const since = typeof req.body?.since === 'string' && req.body.since.trim()
      ? req.body.since.trim()
      : undefined;
    try {
      const totals = await runFullSync({ db, provider, since, now, log });
      res.status(200).json({ ok: true, ...totals });
    } catch (err) {
      log.error('ticketing: full sync failed', err);
      res.status(502).json({
        error: { code: 'provider-error', message: 'The ticketing provider could not be read.' },
      });
    }
  };
}

/**
 * Deployable exports (spec §1.3): ticketingSync, processTicketSyncQueue.
 *
 * The scheduled drain follows cleanupExpiredAuthChallenges's conventions
 * (auth/otp.cjs): onSchedule, region from EVENT_FIREBASE_REGION, and every
 * dependency required inside the callback so deploy analysis never touches
 * firebase-admin.
 */
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const { onSchedule } = require('firebase-functions/v2/scheduler');
  const { defineSecret } = require('firebase-functions/params');
  const { ticketingSecretNames } = require('./providers/index.cjs');

  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  const secretNames = new Set(ticketingSecretNames(process.env));
  // The drain fires an OperatorEvent on exhaustion, so the webhook sink's
  // secrets have to be readable from inside it (same reasoning as
  // auth/otp.cjs's send path).
  if ((process.env.EVENT_OPERATOR_NOTIFIER || '').trim() === 'webhook') {
    secretNames.add('OPERATOR_WEBHOOK_URL');
    secretNames.add('OPERATOR_WEBHOOK_SECRET');
  }
  const secrets = [...secretNames].map(defineSecret);

  const withCors = (handler) => async (req, res) => {
    const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
    const handled = applyCors(req, res, {
      allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS),
    });
    if (handled) return;
    await handler(req, res);
  };

  return {
    ticketingSync: onRequest({ region, secrets }, withCors(async (req, res) => {
      const { buildTicketingDeps } = require('./index.cjs');
      await createTicketingSyncHandler(buildTicketingDeps())(req, res);
    })),
    processTicketSyncQueue: onSchedule(
      { region, schedule: 'every 2 minutes', secrets },
      async () => {
        const { buildTicketingDeps } = require('./index.cjs');
        const { db, provider, notifyOperator } = buildTicketingDeps();
        await drainTicketSyncQueue({ db, provider, notifyOperator });
      },
    ),
  };
}

module.exports = {
  drainTicketSyncQueue,
  runFullSync,
  createTicketingSyncHandler,
  upsertTicket,
  upsertTickets,
  get handlers() {
    return buildHandlers();
  },
  internals: {
    normalizeTicket,
    backoffMsFor,
    toMillis,
    exhaustRow,
    MAX_ATTEMPTS,
    BASE_BACKOFF_MS,
    MAX_BACKOFF_MS,
    DRAIN_LIMIT,
    MAX_SYNC_PAGES,
  },
};
