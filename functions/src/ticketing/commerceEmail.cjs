'use strict';

// Firestore is a wake-up only. Re-read current financial and admission state,
// then use the existing managed-email send-once contract. No email work queue.
const { isOrderFulfilled } = require('shared/ticketCommerce');
const { joinEventPath } = require('shared/config/publicPath');
const { eventPublicAddress } = require('../core/config.cjs');
const { createHash } = require('node:crypto');
const { checkDemoWrites, throwIfDemoPolicyUnavailable } = require('../core/demoWrites.cjs');
const { attendeeLanguage } = require('../email/attendeeLanguage.cjs');
const { attendeeUrl, renderAttendeeTemplate } = require('../email/attendeeTemplates.cjs');
const { loadTemplate } = require('../email/templates.cjs');
const { createEmailCore, internals: { SEND_SECRETS_BY_PROVIDER } } = require('../email/send.cjs');
const { stripeScope, internals: { scopeMatches } } = require('./providers/stripe.cjs');

function receiptAmount(order, language = 'en') {
  const format = new Intl.NumberFormat(language, { style: 'currency', currency: order.currency.toUpperCase() });
  const exponent = format.resolvedOptions().maximumFractionDigits;
  return format.format(order.totalAmount / (10 ** exponent));
}

/** "2 × Reception" per add-on line; empty when the order has none. */
function addOnSummary(lines) {
  return (lines || []).map((line) => `${line.quantity} × ${line.name}`).join(', ');
}

function confirmationPublicBase(env) {
  const { publicBase } = eventPublicAddress(env.EVENT_PUBLIC_URL, env);
  if (!publicBase) {
    throw new Error('Ticket confirmations require a configured public event URL.');
  }
  return publicBase;
}

async function sendOrderConfirmations({ db, getConfig, orderId, resendKey = null, actorUid = null, sendEmail, env = process.env, now = () => new Date(), confirmedOrder }) {
  const policy = await checkDemoWrites({ db });
  throwIfDemoPolicyUnavailable(policy);
  if (!policy.ok) return { sent: 0, alreadySent: false, skipped: 'read-only-demo' };
  const order = confirmedOrder ? confirmedOrder.order : (await db.collection('ticket_orders').doc(orderId).get()).data();
  if (!order || order.provider !== 'stripe' || !isOrderFulfilled(order)) {
    return { sent: 0, alreadySent: false, skipped: 'not-confirmed' };
  }
  // Use the provider's normalized deployment identity without creating its
  // SDK client or requiring payment secrets in this email-only trigger.
  if (!scopeMatches(order, stripeScope(env))) {
    return { sent: 0, alreadySent: false, skipped: 'not-confirmed' };
  }
  let orderTickets = confirmedOrder?.tickets;
  if (!orderTickets) {
    const refs = (order.ticketIds || []).slice(0, 20).map((id) => db.collection('tickets').doc(id));
    orderTickets = (await Promise.all(refs.map((ref) => ref.get()))).map((snap) => snap.data()).filter(Boolean);
  }
  const tickets = orderTickets.filter((ticket) => ticket.orderId === orderId && ticket.status === 'valid');
  if (tickets.length === 0) return { sent: 0, alreadySent: false, skipped: 'no-valid-tickets' };
  const publicBase = confirmationPublicBase(env);
  const config = await getConfig();
  const event = config?.event;
  const purchaserLanguage = attendeeLanguage(order, event);
  const purchaserEmail = typeof order.purchaserEmail === 'string' ? order.purchaserEmail.trim().toLowerCase() : '';
  let send = sendEmail;
  if (!send) {
    const { getEmailProvider } = require('../email/providers/index.cjs');
    send = createEmailCore({ db, provider: getEmailProvider({ env }), getConfig }).send;
  }
  const recipients = [];
  if (order.purchaserEmail) {
    recipients.push({
      to: order.purchaserEmail, templateId: 'ticket.order_confirmation', language: purchaserLanguage,
      tokens: { order_reference: orderId, ticket_count: String(order.ticketIds.length), total_amount: receiptAmount(order, purchaserLanguage), add_ons: addOnSummary(order.addOnLines), cta_url: joinEventPath(publicBase, `/tickets/status?orderId=${encodeURIComponent(orderId)}`) },
    });
  }
  const attendees = new Map();
  for (const ticket of tickets) {
    // Claim invitations are only for outstanding claims. The purchaser's
    // separate confirmation remains available after attendees have claimed.
    if (ticket.claimedByUid) continue;
    const email = ticket.email?.trim().toLowerCase();
    if (!email) continue;
    const existing = attendees.get(email) || { firstName: ticket.firstName || '', count: 0, addOns: new Map() };
    existing.count += 1;
    for (const addOn of ticket.addOns || []) {
      if (addOn.status === 'valid') existing.addOns.set(addOn.name, (existing.addOns.get(addOn.name) || 0) + 1);
    }
    attendees.set(email, existing);
  }
  const assigned = [...attendees.keys()].filter((email) => email !== purchaserEmail);
  const accountsByEmail = new Map();
  if (assigned.length > 0) {
    const accounts = await db.collection('users').where('email', 'in', assigned).get();
    for (const account of accounts.docs) {
      const data = account.data();
      accountsByEmail.set(data.email, accountsByEmail.has(data.email) ? null : { registrationLanguage: data.registrationLanguage });
    }
  }
  for (const [email, attendee] of attendees) {
    const language = email === purchaserEmail ? purchaserLanguage : attendeeLanguage(accountsByEmail.get(email), event);
    recipients.push({
      to: email, templateId: 'ticket.attendee_confirmation', language,
      tokens: {
        first_name: attendee.firstName, order_reference: orderId, ticket_count: String(attendee.count),
        add_ons: addOnSummary([...attendee.addOns].map(([name, quantity]) => ({ name, quantity }))), cta_url: joinEventPath(publicBase, `/ticket/claim?order=${encodeURIComponent(orderId)}`),
      },
    });
  }
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const recipient of recipients) {
    const { template, override } = await loadTemplate({ db, id: recipient.templateId, now: () => now().getTime() });
    const { language } = recipient;
    const tokenValues = { ...recipient.tokens, cta_url: attendeeUrl(recipient.tokens.cta_url, language) };
    const rendered = renderAttendeeTemplate({ template, override, tokenValues, config, now, language });
    const addressKey = createHash('sha256').update(recipient.to).digest('hex');
    const onceKey = `ticket-confirmation:${orderId}:${recipient.templateId}:${addressKey}:${resendKey || 'initial'}`;
    const outcome = await send({
      to: recipient.to, ...rendered, tag: recipient.templateId, onceKey,
      source: 'ticketing-confirmation', storeRendered: false,
    }, { reportPreviousFailure: true });
    if (outcome.status !== 'sent') failed += 1;
    else if (outcome.skipped) skipped += 1;
    else sent += 1;
  }
  // Keep earlier failures visible when a retry finishes other recipients
  // or when an explicit resend already has a needs-attention audit entry.
  if (sent || failed || (resendKey && skipped)) {
    const key = createHash('sha256').update(`ticket-email:${orderId}:${resendKey || 'initial'}`).digest('hex');
    const ref = db.collection('admin_logs').doc(key);
    failed = await db.runTransaction(async (tx) => {
      const previous = (await tx.get(ref)).data()?.details;
      const previousFailures = previous?.failed || 0;
      const failures = Math.max(failed, previousFailures);
      if (sent || failures > previousFailures) {
        tx.set(ref, {
          action: failures ? 'ticketing.confirmation-needs-attention' : 'ticketing.confirmation-sent',
          docPath: `ticket_orders/${orderId}`, orderId, uid: actorUid, actorUid,
          at: now(), reason: failures ? 'Some ticket messages could not be confirmed. Review the email log before resending.' : null,
          ticketIds: [], details: { sent: sent + (previous?.sent || 0), failed: failures, explicitResend: Boolean(resendKey) },
        });
      }
      return failures;
    });
  }
  return { sent, failed, alreadySent: sent === 0 && failed === 0 && skipped > 0 };
}

function buildHandlers() {
  const { onDocumentWritten } = require('firebase-functions/v2/firestore');
  const { defineSecret } = require('firebase-functions/params');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  const selected = (process.env.EVENT_EMAIL_PROVIDER || '').trim();
  const secrets = (SEND_SECRETS_BY_PROVIDER[selected] || []).map(defineSecret);
  return {
    onTicketOrderConfirmation: onDocumentWritten({ region, document: 'ticket_orders/{orderId}', retry: true, secrets }, async (event) => {
      if (!event.data?.after?.exists) return;
      const { getDb } = require('../core/firestore.cjs');
      const { getEventConfig } = require('../core/config.cjs');
      const db = getDb();
      await sendOrderConfirmations({ db, getConfig: () => getEventConfig({ db }), orderId: event.params.orderId });
    }),
  };
}

module.exports = { sendOrderConfirmations, get handlers() { return buildHandlers(); }, internals: { receiptAmount, addOnSummary } };
