'use strict';

/**
 * Pay an issued invoice by card through a Stripe pay link (issue #519; the
 * scope is the amendment to ADR 0004). Two invoiceAdmin actions and one
 * webhook step:
 *
 *   createPayLink         staff. A Stripe-hosted Checkout Session for the
 *                         invoice total, in the invoice currency, built on
 *                         the server from the frozen invoice. The request
 *                         carries no amount, currency or description.
 *   resolvePaymentReview  operator. Closes a flagged card payment with a note.
 *   applyInvoiceCheckout  called by the ticketing webhook (webhook.cjs) for a
 *                         signed, account-verified Checkout Session event
 *                         whose metadata names an invoice.
 *
 * ONLY WITH STRIPE. Links exist only when EVENT_TICKETING_PROVIDER=stripe
 * and the Stripe account, mode and key are set (`getPayments`). Otherwise
 * the record says card links need Stripe, and nothing else changes.
 *
 * ONE LINK AT A TIME. The invoice keeps every link it had in `payLinks`,
 * oldest first; only the last can be open. A press while a link is open
 * answers that link. A Checkout Session lives at most 24 hours in Stripe,
 * so a link is made for LINK_LIFETIME_MS and staff make a new one after it
 * ends.
 *
 * THE SAME REQUEST AFTER A LOST ANSWER. The request and its idempotency key
 * are frozen on the invoice (status `creating`) before Stripe is called. A
 * press after a lost answer sends the identical request and key, so Stripe
 * answers the same session rather than making a second one. After
 * RETRY_WINDOW_MS the attempt is closed and a new one starts. Stripe
 * refusing the request (a 4xx) closes the attempt at once.
 *
 * THE PAYMENT IS STRIPE'S WORD, READ FRESH. The webhook is verified with the
 * signing secret and the event is retrieved again with this account's key
 * (providers/stripe.cjs). Here the Checkout Session is retrieved once more,
 * and only Stripe's copy decides. In one transaction with the delivery
 * claim, a paid session that matches a stored link (by session id, or by
 * the link id in its metadata when the create answer was lost), the invoice
 * total and the invoice currency marks an issued invoice paid, method
 * `card` via `stripe`, with the session and PaymentIntent ids, and writes
 * the admin_logs row.
 *
 * NEVER APPLIED QUIETLY. A paid session for a void or already paid invoice,
 * through a cancelled link, for another amount or currency, or through a
 * session the invoice never stored, is recorded in `paymentReviews`, logged
 * in admin_logs and raised to the operator through a system_errors row, all
 * in the same transaction. The invoice status does not change.
 *
 * VOID AND PAID BY HAND CLOSE THE LINK. void and markPaid (invoices.cjs)
 * set an open link to `cancelled` in their own transaction, then ask Stripe
 * to expire the session. When Stripe cannot be reached the link may still
 * work until it ends; `stripeClosed: false` says so, and a payment through
 * it is flagged as above. Reopen needs no step: a paid invoice has no open
 * link.
 *
 * NO SECRETS OR PERSONAL DATA IN LOGS. A Stripe error is logged by its type
 * only, never its message. admin_logs rows name ids and amounts, never an
 * address. The system_errors message names the invoice number and why.
 */
const { createHash, randomBytes, randomUUID } = require('node:crypto');
const {
  isInvoiceId, invoiceDateIn, sanitizeInvoiceText, validateReviewNote, formatPayLinkEnd,
} = require('shared/invoice');
const { CURRENCY_EXPONENTS, CURRENCY_MINIMUMS, MAX_AMOUNT } = require('shared/ticketCommerce');

const INVOICES = 'invoices';
const AUDIT = 'admin_logs';
const DELIVERIES = 'ticket_webhook_deliveries';
const ALERTS = 'system_errors';
/** How long a link works. Stripe ends a Checkout Session within 24 hours. */
const LINK_LIFETIME_MS = 23 * 60 * 60 * 1000;
/**
 * A lost answer is retried with the same key only this long. Stripe keeps an
 * idempotency key for 24 hours, and the frozen end time must stay at least
 * 30 minutes ahead when the request is sent again.
 */
const RETRY_WINDOW_MS = 22 * 60 * 60 * 1000;
/** An open link that ends sooner than this is not handed out again. */
const REUSE_MARGIN_MS = 15 * 60 * 1000;
/** The most links one invoice keeps. Each needs a press, so this is generous. */
const MAX_LINKS = 25;
const MAX_REVIEWS = 25;
const OPEN = new Set(['creating', 'open']);
const SAFE_ID = /^[A-Za-z0-9_-]{1,160}$/;

/** Why a card payment was not applied, in words for the operator and the record. */
const REVIEW_WORDS = Object.freeze({
  'invoice-void': 'the invoice was void',
  'invoice-already-paid': 'the invoice was already paid',
  'invoice-not-issued': 'the invoice was not issued',
  'link-cancelled': 'its link had been cancelled',
  'currency-mismatch': 'it was in a different currency from the invoice',
  'amount-mismatch': 'the amount was not the invoice total',
  'unknown-session': 'the invoice has no record of that payment page',
});

// invoices.cjs requires this module at load; this one reads invoices.cjs
// only when an action runs, so the two never load each other half-built.
function fail(status, code, message) {
  const { internals: { InvoiceError } } = require('./invoices.cjs');
  throw new InvoiceError(status, code, message);
}
function invoiceAnswer(stored, id) {
  return { invoice: require('./invoices.cjs').publicInvoice(stored, id) };
}

function safeId(value) {
  return typeof value === 'string' && SAFE_ID.test(value) ? value : null;
}
function objectId(value) {
  return typeof value === 'string' ? value : value?.id || null;
}
function timeOf(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') return Date.parse(value);
  return NaN;
}
function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** An https address with no credentials, as Stripe returns it; else null. */
function safeUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

/** The text for when a link ends, on the event clock. */
function payLinkExpiryText(iso, timeZone) {
  return formatPayLinkEnd(iso, timeZone);
}

/**
 * The link a reader can use now: the last link, open, with an address, on
 * an issued invoice, and not yet ended. Takes a publicInvoice.
 */
function currentPayLink(invoice, at = new Date()) {
  if (invoice?.status !== 'issued') return null;
  const links = Array.isArray(invoice.payLinks) ? invoice.payLinks : [];
  const last = links.at(-1);
  if (!last || last.status !== 'open' || !safeUrl(last.url)) return null;
  const ends = timeOf(last.expiresAt);
  if (!Number.isFinite(ends) || ends <= at.getTime()) return null;
  return last;
}

/**
 * What the record says about card payments on this site. Never throws: a
 * Stripe setup fault reads as "not available".
 */
function cardPaymentsStatus(getPayments) {
  try {
    const payments = getPayments();
    if (payments?.available === true && payments.provider) {
      return { available: true, reason: null, testMode: payments.testMode === true };
    }
    return { available: false, reason: payments?.reason || NOT_SET_UP, testMode: false };
  } catch {
    return { available: false, reason: NOT_SET_UP, testMode: false };
  }
}
const NOT_SET_UP = 'Card payment links need Stripe, and Stripe is not fully set up on this site. Ask an operator to check the Stripe settings.';

/** The Checkout Session request for one invoice, from the frozen record only. */
function invoiceCheckoutRequest({ id, stored, linkId, publicUrl, eventId, at }) {
  const number = sanitizeInvoiceText(stored.number);
  const issuerName = sanitizeInvoiceText(stored.issuer?.name);
  const metadata = { eventRunnerInvoiceId: id, eventRunnerEventId: eventId, eventRunnerPayLinkId: linkId };
  const email = sanitizeInvoiceText(stored.billTo?.email).toLowerCase();
  const { isBareEmailAddress } = require('shared/email');
  return {
    mode: 'payment',
    ui_mode: 'hosted_page',
    allowed_payment_method_types: ['card'],
    adaptive_pricing: { enabled: false },
    automatic_tax: { enabled: false },
    allow_promotion_codes: false,
    client_reference_id: id,
    ...(isBareEmailAddress(email) ? { customer_email: email } : {}),
    line_items: [{
      price_data: { currency: stored.currency, unit_amount: stored.totals.total, product_data: { name: `Invoice ${number}` } },
      quantity: 1,
    }],
    metadata,
    payment_intent_data: {
      metadata: { ...metadata },
      description: issuerName ? `Invoice ${number} from ${issuerName}` : `Invoice ${number}`,
    },
    expires_at: Math.floor((at.getTime() + LINK_LIFETIME_MS) / 1000),
    success_url: `${publicUrl}/`,
    cancel_url: `${publicUrl}/`,
  };
}

/** Why an invoice cannot have a link now, or null. */
function linkRefusal(stored) {
  const status = stored?.status;
  if (status === 'draft') return [409, 'conflict', 'Issue the invoice first. A draft cannot be paid.'];
  if (status === 'void') return [409, 'conflict', 'A void invoice cannot be paid. Duplicate it as a new draft to bill again.'];
  if (status === 'paid') return [409, 'conflict', 'This invoice is already paid.'];
  if (status !== 'issued') return [409, 'conflict', 'Only an issued invoice can have a card payment link.'];
  if (!Object.hasOwn(CURRENCY_EXPONENTS, stored.currency)) {
    return [409, 'conflict', 'Stripe card links support this site\'s ticket currencies only. This invoice\'s currency is not one of them.'];
  }
  const total = stored.totals?.total;
  if (!Number.isSafeInteger(total) || total < CURRENCY_MINIMUMS[stored.currency]) {
    return [409, 'amount-out-of-range', 'This total is below the smallest card payment Stripe takes, so it has no card link.'];
  }
  if (total > MAX_AMOUNT) {
    return [409, 'amount-out-of-range', 'This total is above the largest card payment a link can take. Use the payment instructions instead.'];
  }
  return null;
}

/** A Stripe error that is a final refusal of this request, not a lost answer. */
function isRefusal(err) {
  const status = Number(err?.statusCode);
  if (err?.type === 'StripeInvalidRequestError' || err?.type === 'StripeCardError' || err?.type === 'StripePermissionError') return true;
  return Number.isInteger(status) && status >= 400 && status < 500 && ![408, 409, 429].includes(status);
}

function auditRow(tx, db, { actor, at, id, action, details, docId = randomUUID() }) {
  const uid = actor?.uid ?? null;
  tx.create(db.collection(AUDIT).doc(docId), {
    action: `invoices.${action}`, docPath: `${INVOICES}/${id}`, uid, actorUid: uid,
    ...(uid ? {} : { actor: 'stripe' }), at, invoiceId: id, details,
  });
}

/** The links with every open one set to cancelled; `closed` lists them. */
function closeOpenPayLinks(stored, { at, reason }) {
  const payLinks = (Array.isArray(stored?.payLinks) ? stored.payLinks : []).map((link) => ({ ...link }));
  const closed = [];
  for (const link of payLinks) {
    if (!OPEN.has(link.status)) continue;
    link.status = 'cancelled';
    link.closedAt = at;
    link.closedReason = reason;
    delete link.request;
    delete link.idempotencyKey;
    closed.push(link);
  }
  return { payLinks, closed };
}

/**
 * After a commit that cancelled links: ask Stripe to expire each session and
 * record whether it did. Best effort. Never throws.
 */
async function expireClosedLinksAtStripe({ db, id, closed, getPayments, now, log }) {
  if (!closed?.length) return;
  let provider = null;
  try {
    const payments = getPayments();
    provider = payments?.available === true ? payments.provider : null;
  } catch {
    provider = null;
  }
  const results = new Map();
  for (const link of closed) {
    let ok = false;
    if (provider && safeId(link.sessionId)) {
      try {
        await provider.expireCheckoutSession(link.sessionId);
        ok = true;
      } catch (err) {
        log?.warn?.('invoice pay link not expired at Stripe', { type: err?.type || 'Error' });
      }
    }
    results.set(link.linkId, ok);
  }
  try {
    await db.runTransaction(async (tx) => {
      const ref = db.collection(INVOICES).doc(id);
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const payLinks = (Array.isArray(snap.data().payLinks) ? snap.data().payLinks : []).map((link) => (
        results.has(link.linkId) ? { ...link, stripeClosed: results.get(link.linkId), stripeCheckedAt: now() } : link
      ));
      tx.update(ref, { payLinks });
    });
  } catch (err) {
    log?.error?.('invoice pay link record failed', { code: err?.code || 'internal' });
  }
}

/** Mark the last link ended when its end time has passed. Mutates `links`. */
function settleEnded(links, at) {
  const last = links.at(-1);
  if (last?.status === 'open' && timeOf(last.expiresAt) <= at.getTime()) {
    last.status = 'expired';
    last.closedAt = at;
    last.closedReason = 'ended';
  }
}

async function createPayLink({ db, actor, body, now, getPayments, log }) {
  if (!isInvoiceId(body.invoiceId)) fail(400, 'bad-request', 'invoiceId: Choose an invoice from the list.');
  const id = body.invoiceId;
  const payments = (() => {
    try { return getPayments(); } catch { return null; }
  })();
  if (payments?.available !== true || !payments.provider) {
    fail(409, 'pay-links-unavailable', payments?.reason || NOT_SET_UP);
  }
  const { provider, publicUrl } = payments;
  const ref = db.collection(INVOICES).doc(id);

  const plan = await db.runTransaction(async (tx) => {
    const { checkDemoWrites } = require('../core/demoWrites.cjs');
    const policy = await checkDemoWrites({ db, transaction: tx });
    if (!policy.ok) fail(policy.status, policy.code, policy.message);
    const snap = await tx.get(ref);
    if (!snap.exists) fail(404, 'not-found', 'Invoice not found. It may have been deleted.');
    const stored = snap.data();
    const refusal = linkRefusal(stored);
    if (refusal) fail(...refusal);
    const at = now();
    const links = (Array.isArray(stored.payLinks) ? stored.payLinks : []).map((link) => ({ ...link }));
    settleEnded(links, at);
    const last = links.at(-1);
    if (last?.status === 'open' && timeOf(last.expiresAt) - at.getTime() > REUSE_MARGIN_MS) {
      return { reuse: true, stored };
    }
    if (last?.status === 'creating') {
      if (at.getTime() - timeOf(last.createdAt) < RETRY_WINDOW_MS && last.request && last.idempotencyKey) {
        tx.update(ref, { payLinks: links });
        return { attempt: last };
      }
      last.status = 'failed';
      last.closedAt = at;
      last.closedReason = 'no-answer';
      delete last.request;
    }
    if (links.length >= MAX_LINKS) {
      fail(429, 'rate-limited', `This invoice already had ${links.length} card payment links. Use the payment instructions instead.`);
    }
    const linkId = `pl_${randomBytes(12).toString('hex')}`;
    const request = invoiceCheckoutRequest({ id, stored, linkId, publicUrl, eventId: provider.externalEventId, at });
    const attempt = {
      linkId, status: 'creating', idempotencyKey: `invoice-pay-link:${id}:${linkId}`, request,
      amount: stored.totals.total, currency: stored.currency, livemode: provider.livemode === true,
      createdAt: at, createdBy: actor.uid, expiresAt: new Date(request.expires_at * 1000),
    };
    tx.update(ref, { payLinks: [...links, attempt] });
    return { attempt };
  });
  if (plan.reuse) return { ...invoiceAnswer(plan.stored, id), repeated: true };

  const { attempt } = plan;
  let session;
  try {
    session = await provider.createInvoiceCheckoutSession(attempt.request, { idempotencyKey: attempt.idempotencyKey });
  } catch (err) {
    log.error('invoice pay link request failed', { type: err?.type || 'Error' });
    if (isRefusal(err)) {
      await closeAttempt({ db, ref, linkId: attempt.linkId, reason: 'refused', now });
      fail(502, 'stripe-refused', 'Stripe refused the card payment link. Check the Stripe account settings, then try again.');
    }
    fail(503, 'stripe-unavailable', 'Stripe did not answer, so the link may not exist yet. Try again. The same request is sent again, so no second link is made.');
  }

  const sessionId = safeId(session?.id);
  const url = safeUrl(session?.url);
  const ends = Number.isSafeInteger(session?.expires_at) ? new Date(session.expires_at * 1000) : null;
  const matches = Boolean(sessionId && url && ends)
    && session.amount_total === attempt.amount && session.currency === attempt.currency
    && session.metadata?.eventRunnerInvoiceId === id && session.metadata?.eventRunnerPayLinkId === attempt.linkId
    && session.livemode === attempt.livemode;

  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { expire: true, stored: null };
    const stored = snap.data();
    const links = (Array.isArray(stored.payLinks) ? stored.payLinks : []).map((link) => ({ ...link }));
    const link = links.find((each) => each.linkId === attempt.linkId);
    if (!link) return { expire: true, stored };
    // A second press that resent the same request got the same session after
    // the first press opened it: answer the open link, never close it.
    if (link.status === 'open' && link.sessionId && link.sessionId === sessionId) return { stored, repeated: true };
    // A payment through this session can beat its create answer; the
    // webhook then recorded it. Answer the invoice as it is.
    if (link.status === 'paid' || link.status === 'expired') return { stored, repeated: true };
    const at = now();
    if (sessionId) link.sessionId = sessionId;
    delete link.request;
    delete link.idempotencyKey;
    if (!matches) {
      link.status = 'failed';
      link.closedAt = at;
      link.closedReason = 'mismatch';
      tx.update(ref, { payLinks: links });
      return { expire: true, mismatch: true, stored };
    }
    if (link.status !== 'creating' || stored.status !== 'issued') {
      // A void or a payment won the race: the session must not stay usable.
      if (OPEN.has(link.status)) {
        link.status = 'cancelled';
        link.closedAt = at;
        link.closedReason = stored.status === 'issued' ? 'replaced' : stored.status;
      }
      tx.update(ref, { payLinks: links });
      return { expire: true, stored };
    }
    link.status = 'open';
    link.url = url;
    link.expiresAt = ends;
    link.openedAt = at;
    tx.update(ref, { payLinks: links });
    auditRow(tx, db, {
      actor, at, id, action: 'pay-link-created',
      details: {
        number: stored.number ?? null, linkId: link.linkId, sessionId, amount: link.amount, currency: link.currency,
        livemode: link.livemode, expiresAt: ends.toISOString(),
      },
    });
    return { stored: { ...stored, payLinks: links } };
  });

  if (outcome.expire) {
    if (sessionId) {
      try { await provider.expireCheckoutSession(sessionId); } catch (err) { log.warn?.('invoice pay link not expired at Stripe', { type: err?.type || 'Error' }); }
    }
    if (outcome.mismatch) fail(502, 'stripe-refused', 'Stripe answered with a payment page that does not match this invoice, so it was closed. Try again.');
    fail(409, 'conflict', 'The invoice changed while the link was made, so the link was closed. Reload the invoice.');
  }
  return { ...invoiceAnswer(outcome.stored, id), repeated: outcome.repeated === true };
}

async function closeAttempt({ db, ref, linkId, reason, now }) {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const payLinks = (Array.isArray(snap.data().payLinks) ? snap.data().payLinks : []).map((link) => {
      if (link.linkId !== linkId || link.status !== 'creating') return link;
      const { request: _request, idempotencyKey: _key, ...rest } = link;
      return { ...rest, status: 'failed', closedAt: now(), closedReason: reason };
    });
    tx.update(ref, { payLinks });
  });
}

async function resolvePaymentReview({ db, actor, body, now }) {
  if (!isInvoiceId(body.invoiceId)) fail(400, 'bad-request', 'invoiceId: Choose an invoice from the list.');
  if (typeof body.reviewId !== 'string' || !/^rv_[A-Za-z0-9_]{8,80}$/.test(body.reviewId)) {
    fail(400, 'bad-request', 'reviewId: Reload the invoice and choose the payment again.');
  }
  const note = validateReviewNote(body.note);
  if (!note.ok) fail(400, 'bad-request', `Invalid review: ${note.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`);
  const id = body.invoiceId;
  const ref = db.collection(INVOICES).doc(id);
  let saved;
  await db.runTransaction(async (tx) => {
    const { checkDemoWrites } = require('../core/demoWrites.cjs');
    const policy = await checkDemoWrites({ db, transaction: tx });
    if (!policy.ok) fail(policy.status, policy.code, policy.message);
    const snap = await tx.get(ref);
    if (!snap.exists) fail(404, 'not-found', 'Invoice not found. It may have been deleted.');
    const stored = snap.data();
    const reviews = (Array.isArray(stored.paymentReviews) ? stored.paymentReviews : []).map((entry) => ({ ...entry }));
    const entry = reviews.find((each) => each.reviewId === body.reviewId);
    if (!entry) fail(404, 'not-found', 'That payment is not on this invoice. Reload the invoice.');
    if (entry.resolved === true) fail(409, 'conflict', 'This payment was already reviewed. Reload the invoice.');
    const at = now();
    Object.assign(entry, { resolved: true, resolvedAt: at, resolvedBy: actor.uid, note: note.value });
    tx.update(ref, { paymentReviews: reviews });
    auditRow(tx, db, {
      actor, at, id, action: 'payment-review-resolved',
      details: { number: stored.number ?? null, reviewId: entry.reviewId, code: entry.code, paymentIntentId: entry.paymentIntentId ?? null, note: note.value },
    });
    saved = { ...stored, paymentReviews: reviews };
  });
  return invoiceAnswer(saved, id);
}

/**
 * Apply one verified Checkout Session event about an invoice. Returns the
 * webhook answer fields. Throws only for a fault worth a Stripe retry.
 *
 * @param {{ db: object, provider: object, deliveryId: string, invoiceId: string,
 *           sessionId: string, now?: () => Date, log?: object }} deps
 */
async function applyInvoiceCheckout({ db, provider, deliveryId, invoiceId, sessionId, now = () => new Date(), log = console }) {
  if (!isInvoiceId(invoiceId) || !safeId(sessionId) || !safeId(deliveryId)) return { ignored: 'not_actionable' };
  const session = await provider.retrieveCheckoutSession(sessionId);
  if (session?.id !== sessionId || session.metadata?.eventRunnerInvoiceId !== invoiceId
      || session.metadata?.eventRunnerEventId !== provider.externalEventId
      || session.livemode !== provider.livemode || session.mode !== 'payment') {
    log.warn?.('invoice checkout event does not match its session');
    return { ignored: 'wrong_event' };
  }
  const paid = session.status === 'complete' && session.payment_status === 'paid';
  const ended = session.status === 'expired';
  const ref = db.collection(INVOICES).doc(invoiceId);
  const claimRef = db.collection(DELIVERIES).doc(deliveryId);
  const paymentIntentId = safeId(objectId(session.payment_intent));
  const linkIdFromSession = safeId(session.metadata?.eventRunnerPayLinkId);

  try {
    return await db.runTransaction(async (tx) => {
      const { checkDemoWrites, throwIfDemoPolicyUnavailable } = require('../core/demoWrites.cjs');
      const policy = await checkDemoWrites({ db, transaction: tx });
      throwIfDemoPolicyUnavailable(policy);
      if (!policy.ok) return { ignored: true };
      const [snap, eventSnap] = await Promise.all([tx.get(ref), tx.get(db.collection('config').doc('event'))]);
      const at = now();
      tx.create(claimRef, { deliveryId, invoiceId, sessionId, eventType: 'invoice.checkout', provider: 'stripe', receivedAt: at });
      if (!snap.exists) {
        // Money for an invoice that is gone: there is no record to flag, so the operator is told directly.
        if (paid) {
          tx.create(db.collection(ALERTS).doc(`invoice_review_${hash(sessionId).slice(0, 40)}`), alertRow({
            at, message: `A Stripe card payment for invoice ${invoiceId} needs review: the invoice no longer exists. Check payment ${paymentIntentId || sessionId} in the Stripe Dashboard.`, invoiceId,
          }));
          return { invoice: 'flagged' };
        }
        return { invoice: 'ignored' };
      }
      const stored = snap.data();
      const links = (Array.isArray(stored.payLinks) ? stored.payLinks : []).map((link) => ({ ...link }));
      let index = links.findIndex((link) => link.sessionId === sessionId);
      if (index < 0 && linkIdFromSession) {
        index = links.findIndex((link) => !link.sessionId && link.linkId === linkIdFromSession);
      }
      const link = index >= 0 ? links[index] : null;
      if (link && !link.sessionId) link.sessionId = sessionId;

      if (ended) {
        if (link && OPEN.has(link.status)) {
          Object.assign(link, { status: 'expired', closedAt: at, closedReason: 'ended' });
          delete link.request;
          delete link.idempotencyKey;
          tx.update(ref, { payLinks: links });
        }
        return { invoice: 'expired' };
      }
      if (!paid) return { invoice: 'not-paid' };

      const reviews = (Array.isArray(stored.paymentReviews) ? stored.paymentReviews : []).map((entry) => ({ ...entry }));
      const history = Array.isArray(stored.paymentHistory) ? stored.paymentHistory : [];
      const seen = stored.payment?.stripe?.sessionId === sessionId
        || history.some((entry) => entry?.stripe?.sessionId === sessionId)
        || reviews.some((entry) => entry.sessionId === sessionId);
      if (seen) return { invoice: 'already-recorded' };

      const status = stored.status;
      let code = null;
      if (!link) code = 'unknown-session';
      else if (session.currency !== stored.currency || link.currency !== stored.currency) code = 'currency-mismatch';
      else if (session.amount_total !== link.amount || link.amount !== stored.totals?.total) code = 'amount-mismatch';
      else if (status === 'void') code = 'invoice-void';
      else if (status === 'paid') code = 'invoice-already-paid';
      else if (status !== 'issued') code = 'invoice-not-issued';
      else if (link.status === 'cancelled') code = 'link-cancelled';

      if (link) {
        link.status = 'paid';
        link.paidAt = at;
        delete link.request;
        delete link.idempotencyKey;
      }
      const number = typeof stored.number === 'string' ? sanitizeInvoiceText(stored.number) : null;
      if (code) {
        const reviewId = `rv_${hash(sessionId).slice(0, 32)}`;
        reviews.push({
          reviewId, code, sessionId, paymentIntentId, amount: Number.isSafeInteger(session.amount_total) ? session.amount_total : null,
          currency: typeof session.currency === 'string' ? session.currency : null, at, invoiceStatus: status ?? null, resolved: false,
        });
        tx.update(ref, { payLinks: links, paymentReviews: reviews.slice(-MAX_REVIEWS) });
        auditRow(tx, db, {
          actor: null, at, id: invoiceId, action: 'stripe-payment-flagged', docId: `invoice_stripe_${hash(`${deliveryId}:flag`).slice(0, 40)}`,
          details: { number, code, sessionId, paymentIntentId, amount: session.amount_total ?? null, currency: session.currency ?? null, invoiceStatus: status ?? null },
        });
        tx.create(db.collection(ALERTS).doc(`invoice_review_${hash(sessionId).slice(0, 40)}`), alertRow({
          at, invoiceId,
          message: `A Stripe card payment for invoice ${number || invoiceId} needs review: ${REVIEW_WORDS[code]}. It was recorded on the invoice and not applied.`,
        }));
        return { invoice: 'flagged' };
      }

      const timeZone = eventSnap.exists ? eventSnap.data().timezone : null;
      const revision = Number.isSafeInteger(stored.revision) ? stored.revision : 0;
      // Any other open link closes with the payment.
      for (const other of links) {
        if (other !== link && OPEN.has(other.status)) Object.assign(other, { status: 'cancelled', closedAt: at, closedReason: 'paid' });
      }
      tx.update(ref, {
        status: 'paid',
        payment: {
          paidOn: invoiceDateIn(at, typeof timeZone === 'string' ? timeZone : null),
          method: 'card', via: 'stripe', note: '',
          stripe: { sessionId, paymentIntentId },
          recordedAt: at, recordedBy: null,
        },
        payLinks: links,
        revision: revision + 1,
        updatedAt: at,
        updatedBy: null,
      });
      auditRow(tx, db, {
        actor: null, at, id: invoiceId, action: 'paid', docId: `invoice_stripe_${hash(`${deliveryId}:paid`).slice(0, 40)}`,
        details: {
          revision: revision + 1, number, method: 'card', via: 'stripe', sessionId, paymentIntentId,
          amount: session.amount_total, currency: session.currency,
        },
      });
      return { invoice: 'paid' };
    });
  } catch (err) {
    const { internals: { isDuplicateClaim } } = require('../ticketing/webhook.cjs');
    if (isDuplicateClaim(err)) return { duplicate: true };
    throw err;
  }
}

function alertRow({ at, message, invoiceId }) {
  return {
    kind: 'invoice-payment-review', message, stack: null, url: null, userAgent: null,
    context: `invoices/${invoiceId}`, ipHash: null, resolved: false, alertedAt: null, createdAt: at,
  };
}

module.exports = {
  createPayLink,
  resolvePaymentReview,
  applyInvoiceCheckout,
  closeOpenPayLinks,
  expireClosedLinksAtStripe,
  currentPayLink,
  payLinkExpiryText,
  cardPaymentsStatus,
  invoiceCheckoutRequest,
  REVIEW_WORDS,
  internals: { LINK_LIFETIME_MS, RETRY_WINDOW_MS, REUSE_MARGIN_MS, MAX_LINKS, safeUrl, isRefusal, linkRefusal },
};
