import { functionsOrigin } from '../contexts/AuthContext.jsx';
import { appCheckHeaders } from '../firebase.js';

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

/** Hosted Checkout only. A returned arbitrary URL must not become a payment handoff. */
export function safeCheckoutUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('https://')) return null;
  try {
    const url = new URL(value);
    return url.hostname === 'checkout.stripe.com' && !url.username && !url.password && !url.port
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

export function ticketStatusLabel(status) {
  return ({
    valid: 'Valid', cancelled: 'Cancelled', refunded: 'Refunded', pending_info: 'Awaiting attendee details',
    paid: 'Paid', succeeded: 'Paid', unpaid: 'Unpaid', pending: 'Confirming payment',
    processing: 'Confirming payment', complete: 'Complete', completed: 'Complete',
    failed: 'Failed', expired: 'Expired', none: 'No refund', partial: 'Partly refunded',
    full: 'Fully refunded', requires_action: 'Needs organizer attention',
    fulfilled: 'Complete', checked_in: 'Checked in', not_checked_in: 'Not checked in',
    free: 'Free order', exception: 'Needs organizer attention',
    catalog_saved: 'Catalog saved', sales_paused: 'Sales paused', sales_resumed: 'Sales reopened',
    attendee_corrected: 'Attendee corrected', refund_allocated: 'Refund admission decision recorded',
    tickets_cancelled: 'Tickets cancelled', reconciliation_requested: 'Payment resync requested',
    check_in_corrected: 'Check-in corrected', comp_issued: 'Complimentary tickets issued',
    refunded_partial: 'Partly refunded', no_payment_required: 'No payment required',
  })[status] || String(status || 'Not available').replaceAll('_', ' ');
}
