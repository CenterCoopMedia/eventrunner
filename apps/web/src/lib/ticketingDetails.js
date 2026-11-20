import { eventStorageKey } from './eventBrowserState.js';
import { TICKETING_ID_RE } from './ticketingCommerce.js';

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

function attemptKey(uid) { return eventStorageKey(`eventrunner.ticket-checkout.${uid}`); }

/** Store identifiers only: never attendee details, a Checkout URL, or a payment secret. */
export function readCheckoutAttempt(uid) {
  if (!uid) return null;
  try {
    const value = JSON.parse(sessionStorage.getItem(attemptKey(uid)));
    return value && (TICKETING_ID_RE.test(value.requestId || '') || TICKETING_ID_RE.test(value.orderId || ''))
      ? { requestId: TICKETING_ID_RE.test(value.requestId || '') ? value.requestId : null, orderId: TICKETING_ID_RE.test(value.orderId || '') ? value.orderId : null }
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
