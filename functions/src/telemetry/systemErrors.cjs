'use strict';

/**
 * Durable error telemetry core (spec §9, issue #10).
 *
 * `system_errors/{id}` — server-only (`firestore.rules`: allow read, write:
 * if false). Rows: { kind, message, stack, url, userAgent, context,
 * ipHash, resolved, alertedAt, createdAt }. `kind` mirrors the
 * `auth_challenges` convention of a forward-compatible discriminator
 * ('client-error' today; 'template-override-invalid' is the shape
 * functions/src/auth/otp.cjs already writes inline).
 *
 * Two responsibilities, deliberately split from the alert path:
 *
 *  - `logError` persists one row. If the write itself fails, a Firestore
 *    trigger can never fire for a doc that never committed — so this is
 *    the one path that notifies the operator directly, inline, as a
 *    fallback (spec §9: "persist-fail inline fallback retained").
 *  - `onSystemErrorCreated` (the normal path) reacts to a successfully
 *    committed doc and posts one `OperatorEvent`, gated by the `alertedAt`
 *    field so a retried trigger delivery (Cloud Functions v2 triggers are
 *    at-least-once) alerts exactly once per doc.
 */

const crypto = require('node:crypto');

/**
 * Persist one system_errors row. Never throws to the caller — a telemetry
 * write must not become the reason a request handler 500s.
 *
 * @param {{
 *   db: FirebaseFirestore.Firestore,
 *   kind: string,
 *   message: string,
 *   stack?: string|null,
 *   url?: string|null,
 *   userAgent?: string|null,
 *   context?: string|null,
 *   ipHash?: string|null,
 *   notifyOperator?: (event: object) => Promise<object>,
 *   now?: () => number,
 *   log?: Pick<Console, 'error'>,
 * }} args
 * @returns {Promise<{ id: string|null, persisted: boolean }>}
 */
async function logError({
  db,
  kind,
  message,
  stack = null,
  url = null,
  userAgent = null,
  context = null,
  ipHash = null,
  notifyOperator,
  now = Date.now,
  log = console,
}) {
  const row = {
    kind,
    message,
    stack,
    url,
    userAgent,
    context,
    ipHash,
    resolved: false,
    alertedAt: null,
    createdAt: new Date(now()),
  };
  try {
    const ref = await db.collection('system_errors').add(row);
    return { id: ref.id, persisted: true };
  } catch (err) {
    log.error('system_errors write failed', err);
    if (notifyOperator) {
      // Best-effort, and the notifier itself never throws (spec §3.2) — this
      // is a fallback, not a second point of failure.
      await notifyOperator({
        kind: 'error',
        title: `system_errors write failed (${kind})`,
        summary: String(err?.message || err),
        dedupeKey: `system-errors-persist-fail:${kind}`,
      });
    }
    return { id: null, persisted: false };
  }
}

/**
 * Atomically claim the alert for one system_errors doc: read-check-set
 * inside a transaction so two concurrent (or retried) trigger deliveries
 * cannot both observe `alertedAt: null` and both notify. Returns false for
 * a doc that no longer exists (deleted between create and trigger) or that
 * is already claimed.
 *
 * @param {{ db: FirebaseFirestore.Firestore, ref: FirebaseFirestore.DocumentReference,
 *           now?: () => number }} args
 * @returns {Promise<boolean>}
 */
async function claimAlert({ db, ref, now = Date.now }) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    if (snap.data().alertedAt) return false;
    tx.update(ref, { alertedAt: new Date(now()) });
    return true;
  });
}

/**
 * Handle one system_errors creation: claim the alert, then notify. Takes
 * the doc id/data/ref directly (rather than a firebase-functions Event
 * object) so tests drive it with plain fakes.
 *
 * @param {{
 *   db: FirebaseFirestore.Firestore,
 *   ref: FirebaseFirestore.DocumentReference,
 *   data: object,
 *   notifyOperator: (event: object) => Promise<object>,
 *   now?: () => number,
 * }} args
 * @returns {Promise<{ delivered: boolean, sink?: string, reason?: string }>}
 */
async function handleSystemErrorCreated({ db, ref, data, notifyOperator, now = Date.now }) {
  const claimed = await claimAlert({ db, ref, now });
  if (!claimed) return { delivered: false, reason: 'already-alerted' };

  const kind = typeof data?.kind === 'string' && data.kind ? data.kind : 'unknown';
  const message = typeof data?.message === 'string' && data.message ? data.message : '(no message)';
  // Collapses repeats of the *same underlying* error into the notifier's
  // 5-minute dedupe window, even though each gets its own alertedAt-gated
  // doc — the alertedAt gate stops a retried delivery from double-alerting
  // on ONE doc, this stops a burst of near-identical docs from paging twice.
  const contentHash = crypto.createHash('sha256').update(`${kind}:${message}`, 'utf8').digest('hex').slice(0, 16);

  const result = await notifyOperator({
    kind: 'error',
    title: `system error: ${kind}`,
    summary: message,
    fields: {
      ...(data?.url ? { url: data.url } : {}),
      ...(data?.userAgent ? { userAgent: data.userAgent } : {}),
    },
    errorId: ref.id,
    dedupeKey: `system-error:${kind}:${contentHash}`,
  });
  return { delivered: result.delivered, sink: result.sink };
}

/** Deployable exports (spec §1.3): onSystemErrorCreated. */
function buildHandlers() {
  const { onDocumentCreated } = require('firebase-functions/v2/firestore');

  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  const secrets = [];
  if ((process.env.EVENT_OPERATOR_NOTIFIER || '').trim() === 'webhook') {
    const { defineSecret } = require('firebase-functions/params');
    secrets.push(defineSecret('OPERATOR_WEBHOOK_URL'), defineSecret('OPERATOR_WEBHOOK_SECRET'));
  }

  return {
    onSystemErrorCreated: onDocumentCreated({ document: 'system_errors/{id}', region, secrets }, async (event) => {
      const snap = event.data;
      if (!snap) return; // deleted before the handler ran; nothing to alert on
      const { getDb } = require('../core/firestore.cjs');
      const { getEventConfig } = require('../core/config.cjs');
      const { createOperatorNotifier } = require('../notify/operator.cjs');
      const db = getDb();
      const getConfig = () => getEventConfig({ db });
      const notifier = createOperatorNotifier({ env: process.env, getConfig });
      await handleSystemErrorCreated({ db, ref: snap.ref, data: snap.data(), notifyOperator: notifier.notify });
    }),
  };
}

module.exports = {
  logError,
  claimAlert,
  handleSystemErrorCreated,
  get handlers() {
    return buildHandlers();
  },
};
