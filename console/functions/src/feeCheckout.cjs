'use strict';

/**
 * The event fee's payment page (ADR 0007, amendment 2026-11-04): a Stripe
 * Checkout Session on CCM's account. The amount and currency come from
 * `console_config/settings`, never from the request.
 *
 * A request has at most one live session. A second select gets the open
 * one back. Two selects at once send one idempotency key, so Stripe answers
 * both with one session. A session is closed before the request can change
 * (edit, withdraw, decline, delete), and a paid one refuses the change.
 * The close happens outside the path's transaction, so that transaction
 * calls refuseNewCheckout: a page opened since the close is still live.
 * Only the webhook (feeWebhook.cjs) counts a payment.
 */

const { ConsoleError } = require('./http.cjs');
const { requireOwner } = require('./access.cjs');
const { AWAITING_PAYMENT, readApplication } = require('./applications.cjs');
const { readSignupTerms, signupsClosed } = require('./consoleSettings.cjs');

const PAID = 'We already received a payment for this request, so it cannot change now. We email you when the payment is confirmed.';
const UNAVAILABLE = 'We could not reach the payment service. Try again in a few minutes. We will not charge you twice.';

/** The real client. The handlers call this; the tests pass a fake. */
function stripeClient(key) {
  const Stripe = require('stripe');
  return new Stripe(key, { timeout: 10_000, maxNetworkRetries: 1 });
}

/** A failed call to Stripe is logged by postEndpoint; the client reads plain words. */
async function askStripe(call) {
  try {
    return await call();
  } catch (cause) {
    const err = new ConsoleError(502, 'payment-unavailable', UNAVAILABLE);
    err.cause = cause;
    throw err;
  }
}

/**
 * Close the request's open payment page, if it has one.
 * @throws {ConsoleError} 409 payment-received when it was paid; 502 when Stripe cannot say
 */
async function closeOpenCheckout(stripe, app) {
  const sessionId = app.feeCheckout?.sessionId;
  if (!sessionId) return;
  let session = await askStripe(() => stripe.checkout.sessions.retrieve(sessionId));
  // A session paid in between makes expire fail: the next try reads it as paid.
  if (session.status === 'open') session = await askStripe(() => stripe.checkout.sessions.expire(sessionId));
  if (session.status === 'complete') throw new ConsoleError(409, 'payment-received', PAID);
}

/**
 * Inside a path's transaction: refuse when the session changed since the
 * first read and close. Opening a page adds no history, so a revision check
 * cannot see this. A second try closes the new page.
 * @param {object} first the request as first read
 * @param {object} current the request inside the transaction
 * @throws {ConsoleError} 409 status-changed
 */
function refuseNewCheckout(first, current) {
  if ((current.feeCheckout?.sessionId || null) !== (first.feeCheckout?.sessionId || null)) {
    throw new ConsoleError(409, 'status-changed', 'This request just changed. Reload the page and try again.');
  }
}

function statusUrl(publicUrl, orgId, appId, result) {
  return `${publicUrl}/organizations/${orgId}/applications/${appId}?payment=${result}`;
}

/** Only values fixed for this attempt, because Stripe refuses a repeated key with other values. */
function sessionParams({ publicUrl, orgId, appId, app, fee }) {
  return {
    mode: 'payment',
    // Card only: a slower method reports `unpaid` at completion and would need a later event.
    payment_method_types: ['card'],
    client_reference_id: appId,
    customer_email: app.agreementAcceptance.email,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: fee.currency,
        unit_amount: fee.amount,
        product_data: { name: `Event fee: ${app.frozen.event.name}` },
      },
    }],
    metadata: { appId, orgId },
    payment_intent_data: { metadata: { appId, orgId } },
    success_url: statusUrl(publicUrl, orgId, appId, 'done'),
    cancel_url: statusUrl(publicUrl, orgId, appId, 'cancelled'),
  };
}

/**
 * startFeeCheckout: Owners only.
 * @returns {Promise<{ body: { url?: string, alreadyPaid?: boolean } }>}
 */
async function startFeeCheckout({ db, stripe, publicUrl, now = Date.now, log = console }, { body, user }) {
  const { orgId, appId } = body;
  await requireOwner(db, orgId, user, 'Only an Owner can pay the event fee.');
  const { ref, data: app } = await readApplication((r) => r.get(), db, orgId, appId);
  if (app.status !== AWAITING_PAYMENT) throw new ConsoleError(409, 'locked', 'This request is not waiting for payment.');
  const { fee } = await readSignupTerms((r) => r.get(), db);
  if (!publicUrl) log.error('console fee checkout: CONSOLE_PUBLIC_URL is not set');
  if (!fee || !publicUrl) throw signupsClosed();

  const previous = app.feeCheckout || null;
  if (previous) {
    const open = await askStripe(() => stripe.checkout.sessions.retrieve(previous.sessionId));
    // Paid, and waiting for the confirmation: never a second way to pay.
    if (open.status === 'complete') return { body: { alreadyPaid: true } };
    if (open.status === 'open') {
      if (previous.amount === fee.amount && previous.currency === fee.currency) return { body: { url: open.url } };
      // The fee changed while this page was open.
      await closeOpenCheckout(stripe, app);
    }
  }

  const attempt = (previous?.attempt || 0) + 1;
  const acceptanceId = app.agreementAcceptance.id;
  const session = await askStripe(() => stripe.checkout.sessions.create(
    sessionParams({ publicUrl, orgId, appId, app, fee }),
    { idempotencyKey: `console-fee-${acceptanceId}-${attempt}-${fee.amount}-${fee.currency}` },
  ));

  const at = new Date(now());
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists ? snap.data() : null;
      const sameAcceptance = current?.agreementAcceptance?.id === acceptanceId;
      const heldSession = current?.feeCheckout?.sessionId || null;
      const free = heldSession === (previous?.sessionId || null) || heldSession === session.id;
      if (current?.status !== AWAITING_PAYMENT || !sameAcceptance || !free) {
        throw new ConsoleError(409, 'status-changed', 'This request just changed. Reload the page to see it.');
      }
      tx.update(ref, {
        feeCheckout: { sessionId: session.id, amount: fee.amount, currency: fee.currency, attempt, createdAt: at },
        updatedAt: at,
      });
    });
  } catch (err) {
    // The request moved on, so this page must not stay open. If this close
    // fails, a payment on it reaches the webhook as a problem for operators.
    await stripe.checkout.sessions.expire(session.id).catch((cause) => log.error('console fee checkout could not close a session', session.id, cause));
    throw err;
  }
  return { body: { url: session.url } };
}

module.exports = { closeOpenCheckout, refuseNewCheckout, startFeeCheckout, stripeClient };
