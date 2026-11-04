'use strict';

/**
 * consoleFeeWebhook (ADR 0007, amendment 2026-11-04): the only thing that
 * counts an event fee as paid. Stripe calls it, so it has no sign-in and no
 * CORS. It trusts a delivery only after the signature check on the raw
 * body.
 *
 * `console_fee_events/{sessionId}` is the claim: one transaction reads it,
 * creates it and applies the outcome, so a repeated event does nothing. A
 * paid session that fails a check is claimed too, with its reason. The
 * money has moved, so operators get a notice with the ids to refund from;
 * a retry could not change the answer. The claim outlives the request, so
 * a payment on a deleted request still leaves its record.
 *
 * Mail and the build start run after the commit. Their failures are logged
 * and shown to operators and never undo the payment.
 */

const { sendError } = require('./http.cjs');
const { validOrgId } = require('./access.cjs');
const { AWAITING_PAYMENT } = require('./applications.cjs');
const { notifyOperators, notifyOwners } = require('./applicationStatus.cjs');

const COLLECTION = 'console_fee_events';
// Far more than one event needs, small enough to refuse junk before any check.
const MAX_BODY_BYTES = 128 * 1024;
const BY_PAYMENT = 'payment';

/** Why this paid session does not approve this request, or null when it does. */
function paymentProblem(app, session, orgId) {
  if (!app) return 'request-missing';
  if (app.orgId !== orgId) return 'wrong-organization';
  if (app.status !== AWAITING_PAYMENT) return 'wrong-status';
  const charged = app.feeCheckout;
  if (!charged || charged.sessionId !== session.id) return 'not-current-session';
  if (session.amount_total !== charged.amount || String(session.currency).toLowerCase() !== charged.currency) return 'amount-mismatch';
  return null;
}

function paymentIntentId(session) {
  const intent = session.payment_intent;
  if (typeof intent === 'string') return intent;
  return intent?.id || null;
}

/**
 * Claim the session and apply the outcome.
 * @returns {Promise<{ problem: string|null, eventName: string }|null>} null for a repeat
 */
function claimSession({ db, now, startBuild }, event, session, { appId, orgId }) {
  const at = new Date(now());
  const claim = db.collection(COLLECTION).doc(session.id);
  const ref = validOrgId(appId) ? db.collection('applications').doc(appId) : null;
  return db.runTransaction(async (tx) => {
    if ((await tx.get(claim)).exists) return null;
    const snap = ref ? await tx.get(ref) : null;
    const app = snap?.exists ? snap.data() : null;
    const problem = paymentProblem(app, session, orgId);
    const intent = paymentIntentId(session);
    tx.create(claim, {
      eventId: event.id,
      sessionId: session.id,
      paymentIntentId: intent,
      appId: appId || null,
      orgId: orgId || null,
      amount: session.amount_total ?? null,
      currency: session.currency ?? null,
      outcome: problem || 'approved',
      at,
    });
    if (problem && app) {
      tx.update(ref, { feeProblem: { code: problem, sessionId: session.id, paymentIntentId: intent, at }, updatedAt: at });
    } else if (!problem) {
      tx.update(ref, {
        status: 'approved',
        payment: {
          sessionId: session.id,
          paymentIntentId: intent,
          amount: session.amount_total,
          currency: app.feeCheckout.currency,
          paidAt: at,
          eventId: event.id,
        },
        // Pending until the start returns, so a crash in between shows too.
        ...(typeof startBuild === 'function' ? { buildStart: { state: 'pending', at } } : {}),
        updatedAt: at,
        updatedBy: BY_PAYMENT,
        history: [...(Array.isArray(app.history) ? app.history : []), { status: 'approved', at, by: BY_PAYMENT, note: null }],
      });
    }
    return { problem, eventName: app?.frozen?.event?.name || '' };
  });
}

/** Run a step after the commit. A failure is logged and the next step still runs. */
async function afterCommit(log, what, step) {
  try {
    return await step();
  } catch (err) {
    log.error(`console fee webhook: ${what} failed`, err);
    return undefined;
  }
}

/** Shared with the operator's retry (buildRetry.cjs). @returns {Promise<boolean>} whether it started */
async function runStartBuild(deps, { orgId, appId, eventName, by = BY_PAYMENT }) {
  const { db, startBuild, now, log } = deps;
  const ref = db.collection('applications').doc(appId);
  try {
    await startBuild({ orgId, appId });
  } catch (err) {
    log.error('console fee webhook: the build did not start', appId, err);
    const at = new Date(now());
    await afterCommit(log, 'recording the build failure', () => ref.update({ buildStart: { state: 'failed', at } }));
    await afterCommit(log, 'auditing the build failure', () => db.collection('console_audit').doc().create({
      action: 'build-start-failed', appId, by, at,
    }));
    await afterCommit(log, 'the build failure notice', () => notifyOperators(deps, { orgId, appId, eventName, kind: 'build-failed' }));
    return false;
  }
  await afterCommit(log, 'recording the build start', () => ref.update({ buildStart: { state: 'started', at: new Date(now()) } }));
  return true;
}

/**
 * One verified event.
 * @returns {Promise<{ outcome: string }>}
 */
async function handleFeeEvent(input, event) {
  const deps = { now: Date.now, log: console, ...input };
  const { log } = deps;
  if (event.type !== 'checkout.session.completed') return { outcome: 'ignored' };
  const session = event.data?.object;
  if (session?.payment_status !== 'paid' || !validOrgId(session.id)) return { outcome: 'ignored' };
  const { appId, orgId } = session.metadata || {};
  // CCM's account takes other payments; a session with no request is not ours.
  if (!appId || !orgId) return { outcome: 'ignored' };

  const claimed = await claimSession(deps, event, session, { appId, orgId });
  if (!claimed) return { outcome: 'repeat' };
  const { problem, eventName } = claimed;

  if (problem) {
    log.error('console fee webhook: a paid session did not approve its request', { sessionId: session.id, appId, problem });
    await afterCommit(log, 'the payment problem notice', () => notifyOperators(deps, {
      orgId, appId, eventName, kind: 'payment-problem', problem, sessionId: session.id, paymentIntentId: paymentIntentId(session),
    }));
    return { outcome: problem };
  }

  await afterCommit(log, 'the Owner email', () => notifyOwners(deps, { orgId, appId, status: 'paid', eventName }));
  await afterCommit(log, 'the operator notice', () => notifyOperators(deps, { orgId, appId, eventName, kind: 'paid' }));
  if (typeof deps.startBuild === 'function') await runStartBuild(deps, { orgId, appId, eventName });
  return { outcome: 'approved' };
}

/**
 * The HTTP handler. A refusal says nothing about why, so it is no oracle
 * for a signature. A 500 makes Stripe send the event again.
 */
function feeWebhookEndpoint(deps) {
  const { stripe, webhookSecret, log = console } = deps;
  return async (req, res) => {
    if (req.method !== 'POST') {
      res.set('Allow', 'POST');
      sendError(res, 405, 'method-not-allowed', 'Use POST.');
      return;
    }
    const raw = req.rawBody;
    let event;
    try {
      // An empty secret would let anyone sign.
      if (!webhookSecret || !Buffer.isBuffer(raw) || raw.length > MAX_BODY_BYTES) throw new Error('unusable delivery');
      event = stripe.webhooks.constructEvent(raw, req.get('stripe-signature'), webhookSecret);
    } catch (err) {
      log.error('console fee webhook refused a delivery', err.message);
      sendError(res, 400, 'bad-request', 'The request is not valid.');
      return;
    }
    try {
      const { outcome } = await handleFeeEvent(deps, event);
      res.status(200).json({ received: true, outcome });
    } catch (err) {
      log.error('console fee webhook failed', err);
      sendError(res, 500, 'internal', 'Something went wrong.');
    }
  };
}

module.exports = { COLLECTION, feeWebhookEndpoint, handleFeeEvent, runStartBuild };
