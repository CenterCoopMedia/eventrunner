import { functionsOrigin } from './firebaseSettings.js';
import { appCheckHeaders } from './firebaseLoader.js';

const ID_RE = /^[A-Za-z0-9_-]{1,160}$/;

export class TicketingRequestError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.name = 'TicketingRequestError';
    this.code = code;
    this.status = status;
  }
}

/** Private order responses must never be cached by the browser or a service worker. */
export async function ticketingRequest(name, { user, body, query, signal } = {}) {
  const headers = { ...await appCheckHeaders() };
  if (user) {
    try {
      headers.Authorization = `Bearer ${await user.getIdToken()}`;
    } catch {
      throw new TicketingRequestError('unauthenticated', 'Your session has expired. Sign in again.', 401);
    }
  }
  if (body) headers['Content-Type'] = 'application/json';
  const suffix = query ? `?${new URLSearchParams(query)}` : '';
  let response;
  try {
    response = await fetch(`${functionsOrigin()}/${name}${suffix}`, {
      method: body ? 'POST' : 'GET', headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: 'no-store', referrerPolicy: 'no-referrer', signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new TicketingRequestError('network', 'We could not reach ticketing. Check your connection and try again.');
  }
  let payload;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok || !payload) {
    const message = response.status === 404
      ? 'This order is not available to this account. Sign in with the purchaser’s verified email, or contact the organizers.'
      : payload?.error?.message || 'Ticketing could not complete this request. Try again.';
    const error = new TicketingRequestError(payload?.error?.code || 'unknown', message, response.status);
    if (ID_RE.test(payload?.error?.existingOrderId || '')) error.existingOrderId = payload.error.existingOrderId;
    throw error;
  }
  return payload;
}

/** Currency units follow the currency, including zero- and three-decimal currencies. */
export function currencyDigits(currency) {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  } catch { return 2; }
}

export function formatTicketMoney(amount, currency) {
  if (!Number.isSafeInteger(amount) || !currency) return 'Not available';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() })
      .format(amount / (10 ** currencyDigits(currency)));
  } catch { return `${amount} ${currency}`; }
}

export function formatTicketTime(value, timezone = 'UTC') {
  if (!value) return 'No deadline';
  const parsed = new Date(typeof value === 'object' && value.seconds ? value.seconds * 1000 : value);
  if (!Number.isFinite(parsed.getTime())) return 'Not available';
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium', timeStyle: 'long', timeZone: timezone,
    }).format(parsed);
  } catch { return parsed.toISOString(); }
}

/**
 * This value comes only from the verified server Checkout response. Stripe
 * may return the merchant's custom domain; the browser validates transport,
 * while the server establishes that the URL belongs to the saved Session.
 */
export function safeCheckoutUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('https://')) return null;
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.port
      ? url.href : null;
  } catch { return null; }
}

export function safeStripeDashboardUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('https://')) return null;
  try {
    const url = new URL(value);
    return url.hostname === 'dashboard.stripe.com' && !url.username && !url.password && !url.port
      ? url.href : null;
  } catch { return null; }
}

export function newTicketingRequestId() {
  return globalThis.crypto.randomUUID();
}

function attemptKey(uid) { return `eventrunner.ticket-checkout.${uid}`; }

/** Store identifiers only: never attendee details, a Checkout URL, or a payment secret. */
export function readCheckoutAttempt(uid) {
  if (!uid) return null;
  try {
    const value = JSON.parse(sessionStorage.getItem(attemptKey(uid)));
    return value && (ID_RE.test(value.requestId || '') || ID_RE.test(value.orderId || ''))
      ? { requestId: ID_RE.test(value.requestId || '') ? value.requestId : null, orderId: ID_RE.test(value.orderId || '') ? value.orderId : null }
      : null;
  } catch { return null; }
}

export function rememberCheckoutAttempt(uid, attempt) {
  if (!uid) return;
  try {
    sessionStorage.setItem(attemptKey(uid), JSON.stringify({ requestId: attempt.requestId || null, orderId: attempt.orderId || null }));
  } catch { /* A storage refusal must not prevent the in-memory idempotent request. */ }
}

export function forgetCheckoutAttempt(uid) {
  try { sessionStorage.removeItem(attemptKey(uid)); } catch { /* Private browsing can refuse storage. */ }
}

// Each stored field has its own words. One shared map made a pending refund
// read "Confirming payment" and a succeeded refund read "Paid". The keys follow
// the lists in shared/ticketCommerce; the test checks every value has words.
const TICKET_LABELS = Object.freeze({
  valid: 'Valid', cancelled: 'Cancelled', refunded: 'Refunded', pending_info: 'Awaiting attendee details',
});
const ORDER_LABELS = Object.freeze({
  pending: 'Confirming payment', paid: 'Paid', free: 'Free order', expired: 'Expired',
  refunded: 'Refunded', exception: 'Needs organizer attention',
});
const PAYMENT_LABELS = Object.freeze({
  unpaid: 'Unpaid', pending: 'Confirming payment', succeeded: 'Paid', failed: 'Payment failed', expired: 'Expired',
});
/** The order's summary of its refunds (`order.refundStatus`). */
const REFUND_STATE_LABELS = Object.freeze({
  none: 'No refund', pending: 'Refund pending', partial: 'Partly refunded', full: 'Fully refunded',
  failed: 'Refund failed', requires_action: 'Needs organizer attention',
});
/** One Stripe refund object (`order.refunds[].status`). */
const REFUND_LABELS = Object.freeze({
  pending: 'Pending', requires_action: 'Needs organizer attention', succeeded: 'Succeeded',
  failed: 'Failed', canceled: 'Cancelled',
});
/** One Stripe dispute (`order.disputes[].status`). */
const DISPUTE_LABELS = Object.freeze({
  warning_needs_response: 'Inquiry needs a response', warning_under_review: 'Inquiry under review',
  warning_closed: 'Inquiry closed', needs_response: 'Needs a response', under_review: 'Under review',
  won: 'Won', lost: 'Lost', prevented: 'Prevented',
});

function label(words, status) {
  return (Object.hasOwn(words, status) && words[status]) || String(status || 'Not available').replaceAll('_', ' ');
}

export const ticketStatusLabel = (status) => label(TICKET_LABELS, status);
export const orderStatusLabel = (status) => label(ORDER_LABELS, status);
export const paymentStatusLabel = (status) => label(PAYMENT_LABELS, status);
export const refundStateLabel = (status) => label(REFUND_STATE_LABELS, status);
export const refundLabel = (status) => label(REFUND_LABELS, status);
export const disputeStatusLabel = (status) => label(DISPUTE_LABELS, status);
