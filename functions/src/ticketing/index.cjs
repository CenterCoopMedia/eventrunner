'use strict';

/**
 * Ticketing registry (spec §1.3 `ticketing/index.cjs`).
 *
 * Three jobs, and no request handling beyond the last one:
 *   1. Re-export the provider registry (`providers/index.cjs`) so nothing
 *      outside this module ever names an adapter file.
 *   2. Own the collection names and the document-id discipline every
 *      ticketing write shares — provider-supplied strings become Firestore
 *      document ids here, so they are validated in exactly one place.
 *   3. `getTicketingStatus` — the operator-facing answer to "is ticketing
 *      wired up", read by scripts/lib/readiness.cjs's remedy line and by
 *      scripts/register-ticketing-webhook.cjs.
 */

const {
  getTicketingProvider,
  ticketingSecretNames,
  providerNameSupportsWebhooks,
  assertProviderContract,
  PROVIDER_NAMES,
} = require('./providers/index.cjs');

/** The three ticketing collections (spec §4.1). No others exist. */
const TICKETS = 'tickets';
const WEBHOOK_DELIVERIES = 'ticket_webhook_deliveries';
const SYNC_QUEUE = 'ticket_sync_queue';

/** Queue row lifecycle: `pending` is drained, `exhausted` is kept for forensics. */
const QUEUE_PENDING = 'pending';
const QUEUE_EXHAUSTED = 'exhausted';

/** Ticket statuses (§3.3 TicketRecord). Anything else normalizes to pending_info. */
const TICKET_STATUSES = ['valid', 'refunded', 'cancelled', 'pending_info'];

/**
 * Firestore document ids are limited to 1500 bytes, may not contain `/`,
 * and may not be `.` or `..`. Provider-supplied identifiers (delivery ids,
 * order ids, attendee ids) become document ids throughout this module, so
 * every one is checked before it is used — an unchecked `../` would let a
 * provider payload address a different collection path entirely.
 *
 * The 200-character cap is ours, not Firestore's: no real provider id is
 * longer, and a bounded id keeps an unauthenticated endpoint's write size
 * bounded too.
 *
 * @param {unknown} value @returns {boolean}
 */
function isSafeDocId(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 200) return false;
  if (trimmed === '.' || trimmed === '..') return false;
  if (trimmed.includes('/')) return false;
  // Control characters would round-trip badly through logs and REST paths.
  // eslint-disable-next-line no-control-regex
  return !/[\u0000-\u001f\u007f]/.test(trimmed);
}

/** @param {unknown} value @returns {string|null} the trimmed id, or null */
function safeDocId(value) {
  return isSafeDocId(value) ? value.trim() : null;
}

/** Cap on how many queue rows a status read counts before it says "at least". */
const STATUS_SCAN_LIMIT = 100;

/**
 * Operator-facing ticketing status (spec §3.3, §5.1.1).
 *
 * `webhookSupported` is the CAPABILITY test — `typeof
 * provider.registerWebhook === 'function'` — never "the provider is not
 * none". For `manual` and `none` this reports `webhookSupported: false`
 * and no registration warning at all, because a mandatory provisioning
 * step neither can satisfy would be permanently unmet (§3.3).
 *
 * `webhookRegisteredAt` mirrors `config/providers.ticketing`, which is
 * what readiness.cjs's ticketing row reads — one source, two readers.
 *
 * @param {{ db: object, provider: object, getConfig: () => Promise<object>,
 *           now?: () => Date }} deps
 * @returns {Promise<object>}
 */
async function readTicketingStatus({ db, provider, getConfig, now = () => new Date() }) {
  const config = await getConfig();
  const configured = config?.providers?.ticketing || {};

  const pendingSnap = await db.collection(SYNC_QUEUE)
    .where('status', '==', QUEUE_PENDING)
    .limit(STATUS_SCAN_LIMIT + 1)
    .get();
  const exhaustedSnap = await db.collection(SYNC_QUEUE)
    .where('status', '==', QUEUE_EXHAUSTED)
    .limit(STATUS_SCAN_LIMIT + 1)
    .get();

  const pendingRows = pendingSnap.docs.slice(0, STATUS_SCAN_LIMIT).map((d) => d.data());
  const readyAtMs = pendingRows
    .map((row) => (row?.readyAt instanceof Date ? row.readyAt.getTime() : Date.parse(row?.readyAt)))
    .filter((ms) => Number.isFinite(ms));

  const lastDeliverySnap = await db.collection(WEBHOOK_DELIVERIES)
    .orderBy('receivedAt', 'desc')
    .limit(1)
    .get();
  const lastDelivery = lastDeliverySnap.docs[0]?.data() || null;

  const toIso = (value) => {
    if (value instanceof Date) return value.toISOString();
    return typeof value === 'string' && value ? value : null;
  };

  return {
    provider: provider.name,
    externalEventId: provider.externalEventId ?? null,
    // Capability, not enablement (§3.3).
    webhookSupported: typeof provider.registerWebhook === 'function',
    webhookRegisteredAt: toIso(configured.webhookRegisteredAt),
    webhookId: typeof configured.webhookId === 'string' ? configured.webhookId : null,
    lastDeliveryAt: toIso(lastDelivery?.receivedAt),
    queue: {
      pending: Math.min(pendingSnap.size, STATUS_SCAN_LIMIT),
      pendingCapped: pendingSnap.size > STATUS_SCAN_LIMIT,
      exhausted: Math.min(exhaustedSnap.size, STATUS_SCAN_LIMIT),
      exhaustedCapped: exhaustedSnap.size > STATUS_SCAN_LIMIT,
      oldestReadyAt: readyAtMs.length > 0 ? new Date(Math.min(...readyAtMs)).toISOString() : null,
    },
    checkedAt: now().toISOString(),
  };
}

/**
 * Admin-gated HTTP handler around readTicketingStatus.
 *
 * @param {{ db: object, provider: object, auth: object,
 *           getConfig: () => Promise<object>, now?: () => Date }} deps
 */
function createGetTicketingStatusHandler({ db, provider, auth, getConfig, now }) {
  const { requireAdmin } = require('../core/auth.cjs');
  return async function getTicketingStatus(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.set('Allow', 'GET, POST');
      res.status(405).json({ error: { code: 'method-not-allowed', message: 'Use GET or POST.' } });
      return;
    }
    const verdict = await requireAdmin({ auth, getConfig }, req);
    if (!verdict.ok) {
      res.status(verdict.status).json({ error: { code: verdict.code, message: verdict.message } });
      return;
    }
    res.status(200).json(await readTicketingStatus({ db, provider, getConfig, now }));
  };
}

/**
 * Shared runtime wiring for every ticketing function. Required lazily so
 * that requiring this module (in tests, or at deploy analysis time) never
 * touches firebase-admin.
 *
 * @returns {{ db: object, provider: object, getConfig: () => Promise<object>,
 *             notifyOperator: (e: object) => Promise<object>, auth: object }}
 */
function buildTicketingDeps() {
  const { getDb } = require('../core/firestore.cjs');
  const { getEventConfig } = require('../core/config.cjs');
  const { createOperatorNotifier } = require('../notify/operator.cjs');
  const { createEmailCore } = require('../email/send.cjs');
  const { getEmailProvider } = require('../email/providers/index.cjs');
  const { getAuth } = require('firebase-admin/auth');

  const db = getDb();
  const getConfig = () => getEventConfig({ db });
  const emailCore = createEmailCore({ db, provider: getEmailProvider({ env: process.env }), getConfig });
  const notifier = createOperatorNotifier({
    env: process.env,
    getConfig,
    sendEmail: emailCore.send,
  });
  return {
    db,
    provider: getTicketingProvider({ env: process.env }),
    getConfig,
    notifyOperator: notifier.notify,
    auth: getAuth(),
  };
}

/** Deployable exports (spec §1.3): getTicketingStatus. */
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const { defineSecret } = require('firebase-functions/params');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  const secrets = ticketingSecretNames(process.env).map(defineSecret);

  const withCors = (handler) => async (req, res) => {
    const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
    const handled = applyCors(req, res, {
      allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS),
      methods: ['GET', 'POST'],
    });
    if (handled) return;
    await handler(req, res);
  };

  return {
    getTicketingStatus: onRequest({ region, secrets }, withCors(async (req, res) => {
      await createGetTicketingStatusHandler(buildTicketingDeps())(req, res);
    })),
  };
}

module.exports = {
  // Provider registry (re-exported: nothing outside this module names an
  // adapter file).
  getTicketingProvider,
  ticketingSecretNames,
  providerNameSupportsWebhooks,
  assertProviderContract,
  PROVIDER_NAMES,

  readTicketingStatus,
  createGetTicketingStatusHandler,
  buildTicketingDeps,
  get handlers() {
    return buildHandlers();
  },
  internals: {
    isSafeDocId,
    safeDocId,
    TICKETS,
    WEBHOOK_DELIVERIES,
    SYNC_QUEUE,
    QUEUE_PENDING,
    QUEUE_EXHAUSTED,
    TICKET_STATUSES,
    STATUS_SCAN_LIMIT,
  },
};
