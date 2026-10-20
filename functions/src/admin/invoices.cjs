'use strict';

/**
 * invoiceAdmin — sponsor and partner invoices (issue #208; the approved
 * spec is the 2026-10-20 comment on that issue).
 *
 * One POST endpoint takes action-style requests, like the ticketing
 * organizer API (ticketing/commerceAdmin.cjs): list, get, settings,
 * saveDraft, deleteDraft and saveSettings (#208), then issue, markPaid,
 * void, reopen and duplicate (#209). Each action declares its tier: only
 * an operator voids, reopens a paid invoice, or changes the settings. The PDF of an issued invoice is
 * a separate endpoint, invoicePdf (invoicePdf.cjs), because it answers a
 * file and not JSON.
 *
 * NUMBERS HAVE NO GAPS. A number is assigned only by `issue`, in the same
 * transaction that moves invoice_counters/current on by one and writes the
 * invoice. Either all of it commits or none of it does, so a failed or
 * repeated issue never uses a number, and two issues at once each read the
 * counter the other wrote. A void keeps its number: it stays used.
 *
 * LOCKED AFTER ISSUE. Issue freezes the totals (computed again from the
 * stored lines), the issue date on the event clock and a copy of the
 * issuer block from the settings. Only `draft` invoices save or delete.
 * To correct an issued invoice, an operator voids it and staff duplicate
 * it into a new draft.
 *
 * SERVER ONLY. invoices, invoice_counters and invoice_settings deny every
 * client read and write (firestore.rules). The settings hold the issuer's
 * address, tax ID and bank details, so they are kept out of config/event,
 * which anyone can read. Staff read them through this endpoint; only an
 * operator changes them.
 *
 * THE SERVER COMPUTES THE MONEY. A draft's figures come from
 * shared/invoice validateInvoiceDraft, which keeps only the fields a draft
 * may set and computes every total again from the lines. A number is never
 * set here: it is assigned only when an invoice is issued, so a deleted
 * draft leaves no gap in the sequence.
 *
 * Every write refuses on a read-only demo, checks the stored revision, and
 * writes its admin_logs row in the same transaction. A settings row names
 * the fields that changed and never their values.
 */
const { randomUUID } = require('node:crypto');
const { requireAdmin } = require('../core/auth.cjs');
const { checkDemoWrites } = require('../core/demoWrites.cjs');
const { sendError } = require('../core/errors.cjs');
const {
  INVOICE_STATUSES, PAYMENT_METHODS, isInvoiceId, sanitizeInvoiceText, validateInvoiceDraft, validateInvoiceSettings,
  resolveInvoiceCurrency, formatInvoiceNumber, invoiceDateIn, validatePayment, validateVoidReason, validateReopenReason, issueProblems,
  PAY_LINK_STATUSES,
} = require('shared/invoice');
const payLinks = require('./invoicePayLink.cjs');
const { CURRENCY_EXPONENTS } = require('shared/ticketCommerce');

const INVOICES = 'invoices';
const SETTINGS = 'invoice_settings';
const COUNTERS = 'invoice_counters';
const CATALOG = 'ticket_catalog';
const AUDIT = 'admin_logs';
const MAX_PAGE = 50;
const MAX_SCAN = 250;
const OPERATOR_ACTIONS = new Set(['saveSettings', 'void', 'reopen', 'resolvePaymentReview']);
// previewSend writes nothing, so a read-only demo shows it; send is a write.
const READ_ACTIONS = new Set(['list', 'get', 'settings', 'previewSend']);
const ACTIONS = new Set([...READ_ACTIONS, ...OPERATOR_ACTIONS, 'saveDraft', 'deleteDraft', 'issue', 'markPaid', 'duplicate', 'send', 'createPayLink']);
const CURSOR_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\|inv_[a-z0-9]{16,40}$/;

class InvoiceError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
function fail(status, code, message) { throw new InvoiceError(status, code, message); }

async function requireWrites(db, transaction) {
  const policy = await checkDemoWrites({ db, transaction });
  if (!policy.ok) fail(policy.status, policy.code, policy.message);
}
function invoiceIdOf(value) {
  if (!isInvoiceId(value)) fail(400, 'bad-request', 'invoiceId: Choose an invoice from the list.');
  return value;
}
function revisionOf(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail(400, 'bad-request', 'expectedRevision: Reload the invoice before saving.');
  return value;
}
/** The shared validator's issues, joined the way the admin form splits them (adminApi fieldErrorsOf). */
function invalid(noun, issues) {
  fail(400, 'bad-request', `Invalid ${noun}: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`);
}
function iso(value) {
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : null;
}
function amountOr0(value) { return Number.isSafeInteger(value) ? value : 0; }
function auditRef(db) { return db.collection(AUDIT).doc(randomUUID()); }
function audit(tx, ref, { action, actor, now, docPath, invoiceId = null, details = {} }) {
  tx.create(ref, {
    action: `invoices.${action}`, docPath, uid: actor.uid, actorUid: actor.uid, at: now(), invoiceId, details,
  });
}

/** The bill-to block, cleaned again on the way out (issue #209: sanitise on read as well as write). */
function publicBillTo(billTo) {
  const source = billTo && typeof billTo === 'object' ? billTo : {};
  return {
    organizationId: typeof source.organizationId === 'string' ? source.organizationId : null,
    name: sanitizeInvoiceText(source.name),
    contactName: sanitizeInvoiceText(source.contactName),
    email: sanitizeInvoiceText(source.email),
    address: sanitizeInvoiceText(source.address, { multiline: true }),
  };
}
function publicTotals(totals) {
  const source = totals && typeof totals === 'object' ? totals : {};
  return {
    subtotal: amountOr0(source.subtotal), discountTotal: amountOr0(source.discountTotal),
    taxTotal: amountOr0(source.taxTotal), total: amountOr0(source.total),
  };
}
function statusOf(stored) {
  return INVOICE_STATUSES.includes(stored?.status) ? stored.status : 'draft';
}

function dateOrNull(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}
function uidOrNull(value) {
  return typeof value === 'string' ? value : null;
}

/** The issuer block an issued invoice copied from the settings, cleaned on read. */
function publicIssuer(issuer) {
  if (!issuer || typeof issuer !== 'object') return null;
  return {
    name: sanitizeInvoiceText(issuer.name),
    address: sanitizeInvoiceText(issuer.address, { multiline: true }),
    email: sanitizeInvoiceText(issuer.email),
    taxId: sanitizeInvoiceText(issuer.taxId),
    paymentInstructions: sanitizeInvoiceText(issuer.paymentInstructions, { multiline: true }),
  };
}
function stripeIdOrNull(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value) ? value : null;
}
function publicPayment(payment) {
  if (!payment || typeof payment !== 'object') return null;
  const viaStripe = payment.via === 'stripe';
  return {
    paidOn: dateOrNull(payment.paidOn),
    method: PAYMENT_METHODS.includes(payment.method) ? payment.method : 'other',
    // A card payment through the Stripe pay link (#519) names its Stripe ids.
    via: viaStripe ? 'stripe' : null,
    stripe: viaStripe && payment.stripe && typeof payment.stripe === 'object'
      ? { sessionId: stripeIdOrNull(payment.stripe.sessionId), paymentIntentId: stripeIdOrNull(payment.stripe.paymentIntentId) }
      : null,
    note: sanitizeInvoiceText(payment.note),
    recordedAt: iso(payment.recordedAt),
    recordedBy: uidOrNull(payment.recordedBy),
  };
}
/** Payments a reopen undid, oldest first. Kept, never deleted. */
function publicPaymentHistory(history) {
  return (Array.isArray(history) ? history : []).map((entry) => ({
    ...publicPayment(entry),
    reopenedAt: iso(entry?.reopenedAt),
    reopenedBy: uidOrNull(entry?.reopenedBy),
    reason: sanitizeInvoiceText(entry?.reason),
  }));
}
function publicVoided(voided) {
  if (!voided || typeof voided !== 'object') return null;
  return {
    reason: sanitizeInvoiceText(voided.reason),
    from: voided.from === 'paid' ? 'paid' : 'issued',
    at: iso(voided.at),
    by: uidOrNull(voided.by),
  };
}

function timeOf(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') return Date.parse(value);
  return NaN;
}
const SEND_STATUSES = new Set(['sending', 'sent', 'failed', 'uncertain']);
/**
 * A send reserved (`sending`) for longer than this is abandoned: the next
 * send settles it by its claim (invoiceEmail.cjs), and it no longer blocks
 * a status change.
 */
const SENDING_STALE_MS = 5 * 60 * 1000;

/**
 * Refuse a status change while an email of the invoice is reserved and not
 * stale (#208 part 4). The send composed its email and PDF from the status
 * the reservation checked; a payment, a void or a reopen in between would
 * send the old state as if it were current. A reservation ends within the
 * send request, or goes stale after SENDING_STALE_MS, so this never blocks
 * for long.
 */
function refuseWhileSending(stored, at) {
  const nowMs = at.getTime();
  const busy = (Array.isArray(stored.sends) ? stored.sends : [])
    .some((entry) => entry?.status === 'sending' && nowMs - timeOf(entry.at) < SENDING_STALE_MS);
  if (busy) fail(409, 'conflict', 'This invoice is being emailed now. Try again in a minute, after the email is sent.');
}
/**
 * Each email of the invoice PDF (invoiceEmail.cjs), oldest first: who sent
 * it, when, to which addresses, how it ended and the provider's message id.
 * The addresses are cleaned on read like every invoice field.
 */
function publicSends(sends) {
  return (Array.isArray(sends) ? sends : []).map((entry) => ({
    sendId: typeof entry?.sendId === 'string' ? entry.sendId : null,
    status: SEND_STATUSES.has(entry?.status) ? entry.status : 'uncertain',
    to: sanitizeInvoiceText(entry?.to),
    cc: entry?.cc ? sanitizeInvoiceText(entry.cc) : null,
    at: iso(entry?.at),
    sentAt: iso(entry?.sentAt),
    by: uidOrNull(entry?.by),
    providerMessageId: typeof entry?.providerMessageId === 'string' ? entry.providerMessageId : null,
  }));
}

/**
 * The Stripe pay links of an invoice (#519), oldest first. The address shows
 * only while a link is open; the frozen request and its key never leave the
 * server.
 */
function publicPayLinks(links) {
  return (Array.isArray(links) ? links : []).map((link) => {
    const status = PAY_LINK_STATUSES.includes(link?.status) ? link.status : 'failed';
    return {
      linkId: typeof link?.linkId === 'string' ? link.linkId : null,
      status,
      sessionId: stripeIdOrNull(link?.sessionId),
      url: status === 'open' ? payLinks.internals.safeUrl(link?.url) : null,
      amount: amountOr0(link?.amount),
      currency: typeof link?.currency === 'string' ? link.currency : null,
      livemode: link?.livemode === true,
      createdAt: iso(link?.createdAt),
      createdBy: uidOrNull(link?.createdBy),
      expiresAt: iso(link?.expiresAt),
      closedAt: iso(link?.closedAt),
      closedReason: typeof link?.closedReason === 'string' ? link.closedReason : null,
      stripeClosed: typeof link?.stripeClosed === 'boolean' ? link.stripeClosed : null,
    };
  });
}
/** Card payments that were recorded but not applied, for an operator (#519). */
function publicPaymentReviews(reviews) {
  return (Array.isArray(reviews) ? reviews : []).map((entry) => ({
    reviewId: typeof entry?.reviewId === 'string' ? entry.reviewId : null,
    code: Object.hasOwn(payLinks.REVIEW_WORDS, entry?.code) ? entry.code : 'unknown-session',
    sessionId: stripeIdOrNull(entry?.sessionId),
    paymentIntentId: stripeIdOrNull(entry?.paymentIntentId),
    amount: Number.isSafeInteger(entry?.amount) ? entry.amount : null,
    currency: typeof entry?.currency === 'string' ? entry.currency : null,
    at: iso(entry?.at),
    invoiceStatus: INVOICE_STATUSES.includes(entry?.invoiceStatus) ? entry.invoiceStatus : null,
    resolved: entry?.resolved === true,
    resolvedAt: iso(entry?.resolvedAt),
    resolvedBy: uidOrNull(entry?.resolvedBy),
    note: sanitizeInvoiceText(entry?.note),
  }));
}

/** A list row: what the list shows, no lines. */
function invoiceSummary(stored, id) {
  return {
    id,
    status: statusOf(stored),
    number: typeof stored.number === 'string' ? sanitizeInvoiceText(stored.number) : null,
    issueDate: dateOrNull(stored.issueDate),
    currency: typeof stored.currency === 'string' ? stored.currency : 'usd',
    billTo: publicBillTo(stored.billTo),
    reference: sanitizeInvoiceText(stored.reference),
    dueDate: typeof stored.dueDate === 'string' ? stored.dueDate : null,
    totals: publicTotals(stored.totals),
    // A card payment waits for an operator's review (#519).
    needsReview: (Array.isArray(stored.paymentReviews) ? stored.paymentReviews : []).some((entry) => entry?.resolved !== true),
    revision: amountOr0(stored.revision),
    createdAt: iso(stored.createdAt),
    updatedAt: iso(stored.updatedAt),
  };
}

/** The whole record the editor opens. */
function publicInvoice(stored, id) {
  return {
    ...invoiceSummary(stored, id),
    lines: (Array.isArray(stored.lines) ? stored.lines : []).map((line) => ({
      description: sanitizeInvoiceText(line?.description),
      quantity: amountOr0(line?.quantity),
      unitAmount: amountOr0(line?.unitAmount),
      amount: amountOr0(line?.amount),
    })),
    adjustments: (Array.isArray(stored.adjustments) ? stored.adjustments : []).map((row) => ({
      kind: row?.kind === 'tax' ? 'tax' : 'discount',
      label: sanitizeInvoiceText(row?.label),
      amount: amountOr0(row?.amount),
    })),
    notes: sanitizeInvoiceText(stored.notes, { multiline: true }),
    issuer: publicIssuer(stored.issuer),
    issuedAt: iso(stored.issuedAt),
    issuedBy: uidOrNull(stored.issuedBy),
    payment: publicPayment(stored.payment),
    paymentHistory: publicPaymentHistory(stored.paymentHistory),
    voided: publicVoided(stored.voided),
    emailSends: publicSends(stored.sends),
    payLinks: publicPayLinks(stored.payLinks),
    paymentReviews: publicPaymentReviews(stored.paymentReviews),
    duplicatedFrom: stored.duplicatedFrom && isInvoiceId(stored.duplicatedFrom.invoiceId)
      ? {
        invoiceId: stored.duplicatedFrom.invoiceId,
        number: typeof stored.duplicatedFrom.number === 'string' ? sanitizeInvoiceText(stored.duplicatedFrom.number) : null,
      }
      : null,
    createdBy: uidOrNull(stored.createdBy),
    updatedBy: uidOrNull(stored.updatedBy),
  };
}

async function readInvoice({ db, body }) {
  const id = invoiceIdOf(body.invoiceId);
  const snap = await db.collection(INVOICES).doc(id).get();
  if (!snap.exists) fail(404, 'not-found', 'Invoice not found. It may have been deleted.');
  return { invoice: publicInvoice(snap.data(), id) };
}

// Ordered newest first on `listKey` (created time, then id), so a page
// boundary never splits two invoices made in the same millisecond. Bounded
// like the ticketing lists: one page examines at most MAX_SCAN records, and
// the cursor names the last one examined even when filters skipped it.
async function listInvoices({ db, body }) {
  const limit = body.limit === undefined ? 25 : Number(body.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) fail(400, 'bad-request', `Choose a page size from 1 to ${MAX_PAGE}.`);
  const status = body.status || null;
  if (status !== null && !INVOICE_STATUSES.includes(status)) fail(400, 'bad-request', 'Choose a status from the filter.');
  const search = sanitizeInvoiceText(typeof body.search === 'string' ? body.search : '').slice(0, 150).toLowerCase();
  let query = db.collection(INVOICES).orderBy('listKey', 'desc');
  if (body.cursor !== undefined && body.cursor !== null) {
    if (typeof body.cursor !== 'string' || !CURSOR_RE.test(body.cursor)) fail(400, 'bad-request', 'The page reference is invalid. Reload the list.');
    query = query.startAfter(body.cursor);
  }
  const snap = await query.limit(MAX_SCAN + 1).get();
  const invoices = [];
  let examined = 0;
  let last = null;
  for (const doc of snap.docs.slice(0, MAX_SCAN)) {
    examined += 1;
    const stored = doc.data();
    last = stored.listKey;
    const row = invoiceSummary(stored, doc.id);
    if (status && row.status !== status) continue;
    if (search && ![row.id, row.number, row.billTo.name, row.billTo.contactName, row.billTo.email, row.reference]
      .some((value) => typeof value === 'string' && value.toLowerCase().includes(search))) continue;
    invoices.push(row);
    if (invoices.length >= limit) break;
  }
  return { invoices, nextCursor: snap.docs.length > examined ? last : null };
}

async function saveDraft({ db, actor, body, now }) {
  const id = invoiceIdOf(body.invoiceId);
  const expectedRevision = revisionOf(body.expectedRevision);
  const verdict = validateInvoiceDraft(body.invoice);
  if (!verdict.ok) invalid('invoice', verdict.issues);
  const logRef = auditRef(db);
  let saved;
  await db.runTransaction(async (tx) => {
    await requireWrites(db, tx);
    const ref = db.collection(INVOICES).doc(id);
    const snap = await tx.get(ref);
    const at = now();
    if (!snap.exists) {
      if (expectedRevision !== 0) fail(404, 'not-found', 'Invoice not found. It may have been deleted.');
      // The currency is fixed when the draft is made: the ticket catalog's,
      // then the settings', then USD.
      const [catalog, settings] = await Promise.all([
        tx.get(db.collection(CATALOG).doc('current')), tx.get(db.collection(SETTINGS).doc('current')),
      ]);
      saved = {
        ...verdict.value,
        status: 'draft', number: null,
        currency: resolveInvoiceCurrency(catalog.exists ? catalog.data().currency : null, settings.exists ? settings.data().currency : null),
        revision: 1,
        createdAt: at, createdBy: actor.uid, updatedAt: at, updatedBy: actor.uid,
        listKey: `${at.toISOString()}|${id}`,
      };
      tx.create(ref, saved);
      audit(tx, logRef, { action: 'draft-created', actor, now, docPath: `${INVOICES}/${id}`, invoiceId: id, details: { revision: 1 } });
      return;
    }
    const stored = snap.data();
    if (statusOf(stored) !== 'draft') fail(409, 'conflict', 'Only a draft can change. Void the invoice and duplicate it to correct it.');
    if (amountOr0(stored.revision) !== expectedRevision) fail(409, 'conflict', 'The invoice changed since you opened it. Reload it before saving.');
    saved = { ...stored, ...verdict.value, revision: expectedRevision + 1, updatedAt: at, updatedBy: actor.uid };
    tx.set(ref, saved);
    audit(tx, logRef, { action: 'draft-saved', actor, now, docPath: `${INVOICES}/${id}`, invoiceId: id, details: { revision: saved.revision } });
  });
  return { invoice: publicInvoice(saved, id) };
}

async function deleteDraft({ db, actor, body, now }) {
  const id = invoiceIdOf(body.invoiceId);
  const expectedRevision = revisionOf(body.expectedRevision);
  const logRef = auditRef(db);
  await db.runTransaction(async (tx) => {
    await requireWrites(db, tx);
    const ref = db.collection(INVOICES).doc(id);
    const snap = await tx.get(ref);
    if (!snap.exists) fail(404, 'not-found', 'Invoice not found. It may have been deleted.');
    const stored = snap.data();
    if (statusOf(stored) !== 'draft') fail(409, 'conflict', 'Only a draft can be deleted. An issued invoice is voided instead.');
    if (amountOr0(stored.revision) !== expectedRevision) fail(409, 'conflict', 'The invoice changed since you opened it. Reload it before deleting.');
    tx.delete(ref);
    audit(tx, logRef, { action: 'draft-deleted', actor, now, docPath: `${INVOICES}/${id}`, invoiceId: id, details: { revision: expectedRevision } });
  });
  return { deleted: true, invoiceId: id };
}

/** The stored fields a draft may set, as validateInvoiceDraft takes them. */
function draftInputOf(stored) {
  return {
    billTo: stored.billTo,
    reference: stored.reference,
    lines: (Array.isArray(stored.lines) ? stored.lines : []).map((line) => ({
      description: line?.description, quantity: line?.quantity, unitAmount: line?.unitAmount,
    })),
    adjustments: (Array.isArray(stored.adjustments) ? stored.adjustments : []).map((row) => ({
      kind: row?.kind, label: row?.label, amount: row?.amount,
    })),
    dueDate: stored.dueDate,
    notes: stored.notes,
  };
}

/** Read one invoice in a transaction, at the revision the caller saw. */
async function lockedInvoice(tx, db, id, expectedRevision) {
  const ref = db.collection(INVOICES).doc(id);
  const snap = await tx.get(ref);
  if (!snap.exists) fail(404, 'not-found', 'Invoice not found. It may have been deleted.');
  const stored = snap.data();
  if (amountOr0(stored.revision) !== expectedRevision) fail(409, 'conflict', 'The invoice changed since you opened it. Reload it and try again.');
  return { ref, stored };
}

async function eventTimeZone(tx, db) {
  const snap = await tx.get(db.collection('config').doc('event'));
  const zone = snap.exists ? snap.data().timezone : null;
  return typeof zone === 'string' ? zone : null;
}

/**
 * Issue a draft: the next number, the frozen totals, the issue date and
 * the issuer block, with the counter and the audit row, in one commit.
 */
async function issueInvoice({ db, actor, body, now }) {
  const id = invoiceIdOf(body.invoiceId);
  const expectedRevision = revisionOf(body.expectedRevision);
  const logRef = auditRef(db);
  let saved;
  await db.runTransaction(async (tx) => {
    await requireWrites(db, tx);
    const { ref, stored } = await lockedInvoice(tx, db, id, expectedRevision);
    if (statusOf(stored) !== 'draft') fail(409, 'conflict', 'Only a draft can be issued. This invoice already has a number.');
    const counterRef = db.collection(COUNTERS).doc('current');
    const [settingsSnap, counterSnap, timeZone] = await Promise.all([
      tx.get(db.collection(SETTINGS).doc('current')), tx.get(counterRef), eventTimeZone(tx, db),
    ]);
    const at = now();
    const issueDate = invoiceDateIn(at, timeZone);
    // The issuer block and the prefix are copied onto the invoice for
    // good, so settings that no longer pass their own checks (a value
    // edited outside the settings page) are refused, not cleaned and used.
    const storedSettings = settingsSnap.exists ? settingsSnap.data() : {};
    const settingsCheck = validateInvoiceSettings({ ...validateInvoiceSettings({}).value, ...storedSettings });
    if (!settingsCheck.ok) {
      fail(409, 'conflict', 'The invoice settings do not pass their checks, so the invoice was not issued. Ask an operator to open the invoice settings and save them again.');
    }
    const settings = settingsCheck.value;
    if (!Object.hasOwn(CURRENCY_EXPONENTS, stored.currency)) {
      fail(409, 'conflict', 'This draft\'s currency is not supported, so it was not issued. Duplicate it into a new draft.');
    }
    // The stored draft is checked again with today's rules, and its figures
    // are computed again: what is frozen is what the server computed.
    const verdict = validateInvoiceDraft(draftInputOf(stored));
    if (!verdict.ok) invalid('invoice', verdict.issues);
    const problems = issueProblems(verdict.value, { settings, issueDate });
    if (problems.length) invalid('invoice', problems);

    // A missing counter starts at zero. A counter that is not a whole
    // number is never guessed at: a wrong guess would reuse a number.
    const lastNumber = counterSnap.exists ? counterSnap.data().lastNumber : 0;
    if (!Number.isSafeInteger(lastNumber) || lastNumber < 0) {
      fail(409, 'conflict', 'The invoice number counter is damaged, so no number was given. Ask an operator to check invoice_counters/current.');
    }
    const sequence = lastNumber + 1;
    const number = formatInvoiceNumber(settings.prefix, sequence);
    // Belt and braces: a counter set back by hand would hand out a used
    // number. The query is in the transaction, so it is part of its reads.
    const clash = await tx.get(db.collection(INVOICES).where('sequence', '==', sequence).limit(1));
    if (!clash.empty) {
      fail(409, 'conflict', `Invoice number ${number} is already used, so no number was given. Ask an operator to check invoice_counters/current.`);
    }
    const { currency } = stored;
    saved = {
      ...stored,
      ...verdict.value,
      currency,
      status: 'issued',
      number,
      sequence,
      issueDate,
      issuer: {
        name: settings.issuerName,
        address: settings.issuerAddress,
        email: settings.issuerEmail,
        taxId: settings.taxId,
        paymentInstructions: settings.paymentInstructions,
      },
      issuedAt: at,
      issuedBy: actor.uid,
      revision: expectedRevision + 1,
      updatedAt: at,
      updatedBy: actor.uid,
    };
    tx.set(counterRef, { lastNumber: sequence, lastInvoiceId: id, updatedAt: at });
    tx.set(ref, saved);
    audit(tx, logRef, {
      action: 'issued', actor, now, docPath: `${INVOICES}/${id}`, invoiceId: id,
      details: { revision: saved.revision, number, sequence, total: saved.totals.total, currency },
    });
  });
  return { invoice: publicInvoice(saved, id) };
}

async function markPaid({ db, actor, body, now, getPayments, log }) {
  const id = invoiceIdOf(body.invoiceId);
  const expectedRevision = revisionOf(body.expectedRevision);
  const logRef = auditRef(db);
  let saved;
  let closed = [];
  await db.runTransaction(async (tx) => {
    await requireWrites(db, tx);
    const { ref, stored } = await lockedInvoice(tx, db, id, expectedRevision);
    if (statusOf(stored) !== 'issued') fail(409, 'conflict', 'Only an issued invoice can be marked paid.');
    const at = now();
    refuseWhileSending(stored, at);
    const verdict = validatePayment(body.payment, { today: invoiceDateIn(at, await eventTimeZone(tx, db)) });
    if (!verdict.ok) invalid('payment', verdict.issues);
    // A payment recorded by hand closes the card link, so the payer cannot pay twice (#519).
    const links = payLinks.closeOpenPayLinks(stored, { at, reason: 'paid' });
    closed = links.closed;
    saved = {
      ...stored,
      status: 'paid',
      payment: { ...verdict.value, recordedAt: at, recordedBy: actor.uid },
      ...(stored.payLinks ? { payLinks: links.payLinks } : {}),
      revision: expectedRevision + 1,
      updatedAt: at,
      updatedBy: actor.uid,
    };
    tx.set(ref, saved);
    audit(tx, logRef, {
      action: 'paid', actor, now, docPath: `${INVOICES}/${id}`, invoiceId: id,
      details: {
        revision: saved.revision, number: stored.number, paidOn: verdict.value.paidOn, method: verdict.value.method,
        ...(closed.length ? { payLinksClosed: closed.map((link) => link.linkId) } : {}),
      },
    });
  });
  return { invoice: publicInvoice(await afterLinksClosed({ db, id, saved, closed, getPayments, now, log }), id) };
}

/**
 * After a commit that cancelled pay links, ask Stripe to expire them, then
 * answer the invoice as stored, with whether Stripe did.
 */
async function afterLinksClosed({ db, id, saved, closed, getPayments, now, log }) {
  if (!closed.length) return saved;
  await payLinks.expireClosedLinksAtStripe({ db, id, closed, getPayments, now, log });
  const snap = await db.collection(INVOICES).doc(id).get();
  return snap.exists ? snap.data() : saved;
}

/** Operator only (OPERATOR_ACTIONS). The number stays used; nothing else changes. */
async function voidInvoice({ db, actor, body, now, getPayments, log }) {
  const id = invoiceIdOf(body.invoiceId);
  const expectedRevision = revisionOf(body.expectedRevision);
  const reason = validateVoidReason(body.reason);
  if (!reason.ok) invalid('void', reason.issues);
  const logRef = auditRef(db);
  let saved;
  let closed = [];
  await db.runTransaction(async (tx) => {
    await requireWrites(db, tx);
    const { ref, stored } = await lockedInvoice(tx, db, id, expectedRevision);
    const from = statusOf(stored);
    if (from === 'draft') fail(409, 'conflict', 'A draft has no number. Delete it instead of voiding it.');
    if (from === 'void') fail(409, 'conflict', 'This invoice is already void.');
    const at = now();
    refuseWhileSending(stored, at);
    // A void closes the card link (#519). A payment that lands anyway is flagged, never applied.
    const links = payLinks.closeOpenPayLinks(stored, { at, reason: 'void' });
    closed = links.closed;
    saved = {
      ...stored,
      status: 'void',
      voided: { reason: reason.value, from, at, by: actor.uid },
      ...(stored.payLinks ? { payLinks: links.payLinks } : {}),
      revision: expectedRevision + 1,
      updatedAt: at,
      updatedBy: actor.uid,
    };
    tx.set(ref, saved);
    audit(tx, logRef, {
      action: 'voided', actor, now, docPath: `${INVOICES}/${id}`, invoiceId: id,
      details: {
        revision: saved.revision, number: stored.number, from, reason: reason.value,
        ...(closed.length ? { payLinksClosed: closed.map((link) => link.linkId) } : {}),
      },
    });
  });
  return { invoice: publicInvoice(await afterLinksClosed({ db, id, saved, closed, getPayments, now, log }), id) };
}

/**
 * Operator only (OPERATOR_ACTIONS): a paid invoice back to issued, such as
 * after a bounced check. The payment moves to `paymentHistory` with the
 * reason, so the record of it is kept. A void invoice stays void.
 */
async function reopenInvoice({ db, actor, body, now }) {
  const id = invoiceIdOf(body.invoiceId);
  const expectedRevision = revisionOf(body.expectedRevision);
  const reason = validateReopenReason(body.reason);
  if (!reason.ok) invalid('reopen', reason.issues);
  const logRef = auditRef(db);
  let saved;
  await db.runTransaction(async (tx) => {
    await requireWrites(db, tx);
    const { ref, stored } = await lockedInvoice(tx, db, id, expectedRevision);
    const status = statusOf(stored);
    if (status === 'void') fail(409, 'conflict', 'A void invoice cannot be reopened. Duplicate it into a new draft instead.');
    if (status !== 'paid' || !stored.payment || typeof stored.payment !== 'object') {
      fail(409, 'conflict', 'Only a paid invoice can be reopened.');
    }
    const at = now();
    refuseWhileSending(stored, at);
    const history = Array.isArray(stored.paymentHistory) ? stored.paymentHistory : [];
    saved = {
      ...stored,
      status: 'issued',
      payment: null,
      paymentHistory: [...history, { ...stored.payment, reopenedAt: at, reopenedBy: actor.uid, reason: reason.value }],
      revision: expectedRevision + 1,
      updatedAt: at,
      updatedBy: actor.uid,
    };
    tx.set(ref, saved);
    audit(tx, logRef, {
      action: 'reopened', actor, now, docPath: `${INVOICES}/${id}`, invoiceId: id,
      details: { revision: saved.revision, number: stored.number, reason: reason.value, paidOn: stored.payment.paidOn ?? null, method: stored.payment.method ?? null },
    });
  });
  return { invoice: publicInvoice(saved, id) };
}

/**
 * Copy an invoice of any status into a new draft: the bill-to block, the
 * lines, the tax and discount rows, the reference and the notes, in the
 * same currency. No number, no issuer, no due date. The caller mints the
 * new id once, so a retry after a lost answer finds the same draft.
 */
async function duplicateInvoice({ db, actor, body, now }) {
  const sourceId = invoiceIdOf(body.invoiceId);
  if (!isInvoiceId(body.newInvoiceId) || body.newInvoiceId === sourceId) {
    fail(400, 'bad-request', 'newInvoiceId: Reload the invoice before duplicating it.');
  }
  const id = body.newInvoiceId;
  const logRef = auditRef(db);
  let saved;
  await db.runTransaction(async (tx) => {
    await requireWrites(db, tx);
    const sourceRef = db.collection(INVOICES).doc(sourceId);
    const ref = db.collection(INVOICES).doc(id);
    const [sourceSnap, targetSnap] = await Promise.all([tx.get(sourceRef), tx.get(ref)]);
    if (!sourceSnap.exists) fail(404, 'not-found', 'Invoice not found. It may have been deleted.');
    if (targetSnap.exists) {
      const existing = targetSnap.data();
      if (existing.duplicatedFrom?.invoiceId === sourceId) {
        saved = existing;
        return;
      }
      fail(409, 'conflict', 'That invoice id is already used. Reload the invoice before duplicating it.');
    }
    const source = sourceSnap.data();
    const verdict = validateInvoiceDraft({ ...draftInputOf(source), dueDate: null });
    if (!verdict.ok) fail(409, 'conflict', 'This invoice could not be copied, because it no longer passes the draft checks. Write a new draft instead.');
    const at = now();
    const fromNumber = typeof source.number === 'string' ? source.number : null;
    saved = {
      ...verdict.value,
      status: 'draft', number: null,
      currency: Object.hasOwn(CURRENCY_EXPONENTS, source.currency) ? source.currency : 'usd',
      duplicatedFrom: { invoiceId: sourceId, number: fromNumber },
      revision: 1,
      createdAt: at, createdBy: actor.uid, updatedAt: at, updatedBy: actor.uid,
      listKey: `${at.toISOString()}|${id}`,
    };
    tx.create(ref, saved);
    audit(tx, logRef, {
      action: 'duplicated', actor, now, docPath: `${INVOICES}/${id}`, invoiceId: id,
      details: { from: sourceId, fromNumber, revision: 1 },
    });
  });
  return { invoice: publicInvoice(saved, id) };
}

/** Stored settings over the defaults, each field cleaned on read. */
function publicSettings(stored) {
  const defaults = validateInvoiceSettings({}).value;
  const source = stored && typeof stored === 'object' ? stored : {};
  const checked = validateInvoiceSettings({ ...defaults, ...source });
  // A stored value that no longer validates still shows, cleaned, so an
  // operator can see and correct it.
  const value = checked.ok ? checked.value : {
    ...defaults,
    ...Object.fromEntries(Object.keys(defaults).map((key) => [
      key, sanitizeInvoiceText(source[key] ?? defaults[key], { multiline: key === 'issuerAddress' || key === 'paymentInstructions' }),
    ])),
  };
  return value;
}

async function readSettings({ db, actor }) {
  const [settingsSnap, counterSnap, catalogSnap] = await Promise.all([
    db.collection(SETTINGS).doc('current').get(),
    db.collection(COUNTERS).doc('current').get(),
    db.collection(CATALOG).doc('current').get(),
  ]);
  const stored = settingsSnap.exists ? settingsSnap.data() : null;
  const settings = publicSettings(stored);
  const lastNumber = counterSnap.exists ? amountOr0(counterSnap.data().lastNumber) : 0;
  return {
    settings,
    revision: amountOr0(stored?.revision),
    invoiceCurrency: resolveInvoiceCurrency(catalogSnap.exists ? catalogSnap.data().currency : null, settings.currency),
    catalogCurrency: catalogSnap.exists && typeof catalogSnap.data().currency === 'string' ? catalogSnap.data().currency : null,
    nextNumber: formatInvoiceNumber(settings.prefix, lastNumber + 1),
    updatedAt: iso(stored?.updatedAt),
    canEdit: actor.tier === 'operator',
  };
}

async function saveSettings({ db, actor, body, now }) {
  const expectedRevision = revisionOf(body.expectedRevision);
  const verdict = validateInvoiceSettings(body.settings);
  if (!verdict.ok) invalid('settings', verdict.issues);
  const logRef = auditRef(db);
  await db.runTransaction(async (tx) => {
    await requireWrites(db, tx);
    const ref = db.collection(SETTINGS).doc('current');
    const snap = await tx.get(ref);
    const stored = snap.exists ? snap.data() : null;
    if (amountOr0(stored?.revision) !== expectedRevision) fail(409, 'conflict', 'The invoice settings changed since you opened them. Reload them before saving.');
    const before = publicSettings(stored);
    const fields = Object.keys(verdict.value).filter((key) => before[key] !== verdict.value[key]);
    tx.set(ref, { ...verdict.value, revision: expectedRevision + 1, updatedAt: now(), updatedBy: actor.uid });
    audit(tx, logRef, { action: 'settings-saved', actor, now, docPath: `${SETTINGS}/current`, details: { revision: expectedRevision + 1, fields } });
  });
  return readSettings({ db, actor });
}

function noMailer() {
  throw new Error('No email provider is configured for invoiceAdmin.');
}

/** The answer when this site does not take card payments through Stripe (#519). */
const NO_STRIPE_REASON = 'Card payment links need Stripe. This site does not take card payments through Stripe.';
function noPayments() {
  return { available: false, reason: NO_STRIPE_REASON };
}

/**
 * @param {{ db: object, auth: object, getConfig: () => Promise<object>,
 *           now?: () => Date, log?: object,
 *           getMailer?: () => { provider: object, send: (message: object) => Promise<object> } }} deps
 *   getMailer builds the email provider and the email core; it is called
 *   only by previewSend and send, so a provider fault never breaks the rest.
 */
function createInvoiceAdminHandler({
  db, auth, getConfig, now = () => new Date(), log = console, getMailer = noMailer, getPayments = noPayments,
}) {
  return async function invoiceAdmin(req, res) {
    res.set('Cache-Control', 'private, no-store');
    if (req.method !== 'POST') { res.set('Allow', 'POST'); return sendError(res, 405, 'method-not-allowed', 'Use POST.'); }
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const action = body.action || 'list';
    const actor = await requireAdmin({ db, auth, getConfig }, req, { tier: OPERATOR_ACTIONS.has(action) ? 'operator' : 'staff' });
    if (!actor.ok) return sendError(res, actor.status, actor.code, actor.message);
    if (!ACTIONS.has(action)) return sendError(res, 400, 'bad-request', 'Choose a supported invoice action.');
    try {
      if (!READ_ACTIONS.has(action)) {
        const policy = await checkDemoWrites({ db });
        if (!policy.ok) return sendError(res, policy.status, policy.code, policy.message);
      }
      const deps = { db, actor, body, now, getConfig, getMailer, getPayments, log };
      let result;
      if (action === 'list') result = await listInvoices(deps);
      else if (action === 'get') result = await readInvoice(deps);
      else if (action === 'settings') result = await readSettings(deps);
      else if (action === 'saveDraft') result = await saveDraft(deps);
      else if (action === 'deleteDraft') result = await deleteDraft(deps);
      else if (action === 'saveSettings') result = await saveSettings(deps);
      else if (action === 'issue') result = await issueInvoice(deps);
      else if (action === 'markPaid') result = await markPaid(deps);
      else if (action === 'void') result = await voidInvoice(deps);
      else if (action === 'duplicate') result = await duplicateInvoice(deps);
      else if (action === 'reopen') result = await reopenInvoice(deps);
      else if (action === 'createPayLink') result = await payLinks.createPayLink(deps);
      else if (action === 'resolvePaymentReview') result = await payLinks.resolvePaymentReview(deps);
      else if (action === 'previewSend') result = await require('./invoiceEmail.cjs').previewSend(deps);
      else if (action === 'send') {
        const sent = await require('./invoiceEmail.cjs').sendInvoice(deps);
        result = { outcome: sent.outcome, repeated: sent.repeated, invoice: publicInvoice(sent.stored, body.invoiceId) };
      }
      // The page offers Void and Reopen only to a caller who may use them; the action
      // itself checks the tier again (OPERATOR_ACTIONS).
      if (result?.invoice) {
        result = {
          ...result, canVoid: actor.tier === 'operator', canReopen: actor.tier === 'operator',
          cardPayments: payLinks.cardPaymentsStatus(getPayments),
        };
      }
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof InvoiceError) return sendError(res, error.status, error.code, error.message);
      log.error('invoice operation failed', { action, code: error?.code || 'internal' });
      return sendError(res, 503, 'unavailable', 'Invoices could not complete this action. Reload the invoice before trying again.');
    }
  };
}

/**
 * The Stripe provider for card pay links (#519), or why there is none.
 * Building it reads configuration only; it makes no Stripe request.
 */
function stripePayments({ db, getConfig, env }) {
  if ((env.EVENT_TICKETING_PROVIDER || '').trim() !== 'stripe') return noPayments();
  const notReady = { available: false, reason: 'Card payment links need Stripe, and Stripe is not fully set up on this site. Ask an operator to check the Stripe settings.' };
  try {
    const { getTicketingProvider } = require('../ticketing/providers/index.cjs');
    const { configuredPublicUrl } = require('../ticketing/stripeCommerce.cjs');
    const provider = getTicketingProvider({ env, db, getConfig });
    if (provider.hasPaymentCredentials !== true || typeof provider.createInvoiceCheckoutSession !== 'function') return notReady;
    return { available: true, provider, publicUrl: configuredPublicUrl(null, env), testMode: provider.livemode !== true };
  } catch {
    return notReady;
  }
}

/** Deployable export: invoiceAdmin. */
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const { defineSecret } = require('firebase-functions/params');
  const { SEND_SECRETS_BY_PROVIDER } = require('../email/send.cjs').internals;
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  const secrets = [
    ...(SEND_SECRETS_BY_PROVIDER[(process.env.EVENT_EMAIL_PROVIDER || '').trim()] || []),
    // The Stripe API key, for the card pay link (#519). The webhook secret
    // stays with ticketingWebhook, which receives the payment.
    ...((process.env.EVENT_TICKETING_PROVIDER || '').trim() === 'stripe' ? ['TICKETING_API_TOKEN'] : []),
  ].map(defineSecret);
  return {
    // The send secrets are bound because send emails the PDF (part 4).
    invoiceAdmin: onRequest({ region, secrets }, async (req, res) => {
      const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
      if (applyCors(req, res, { allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS), methods: ['POST'] })) return;
      const { getDb } = require('../core/firestore.cjs');
      const { getEventConfig } = require('../core/config.cjs');
      const { getAuth } = require('firebase-admin/auth');
      const db = getDb();
      const getConfig = () => getEventConfig({ db });
      let mailer = null;
      const getMailer = () => {
        if (!mailer) {
          const { getEmailProvider } = require('../email/providers/index.cjs');
          const { createEmailCore } = require('../email/send.cjs');
          const provider = getEmailProvider({ env: process.env });
          mailer = { provider, send: createEmailCore({ db, provider, getConfig }).send };
        }
        return mailer;
      };
      let payments = null;
      const getPayments = () => (payments ||= stripePayments({ db, getConfig, env: process.env }));
      await createInvoiceAdminHandler({ db, auth: getAuth(), getConfig, getMailer, getPayments })(req, res);
    }),
  };
}

module.exports = {
  createInvoiceAdminHandler,
  publicInvoice,
  get handlers() { return buildHandlers(); },
  internals: { MAX_SCAN, MAX_PAGE, OPERATOR_ACTIONS, READ_ACTIONS, listInvoices, saveDraft, publicSettings, InvoiceError, timeOf, SENDING_STALE_MS, stripePayments },
};
