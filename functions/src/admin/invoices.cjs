'use strict';

/**
 * invoiceAdmin — sponsor and partner invoices (issue #208; the approved
 * spec is the 2026-10-20 comment on that issue).
 *
 * One POST endpoint takes action-style requests, like the ticketing
 * organizer API (ticketing/commerceAdmin.cjs). This first part holds the
 * record and its draft: list, get, settings, saveDraft, deleteDraft and
 * saveSettings. Issue, mark paid, void, reopen, duplicate and send join
 * the same switch later (#209), so each new action declares its tier in
 * OPERATOR_ACTIONS or not, and nothing else moves.
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
  INVOICE_STATUSES, isInvoiceId, sanitizeInvoiceText, validateInvoiceDraft, validateInvoiceSettings,
  resolveInvoiceCurrency, formatInvoiceNumber,
} = require('shared/invoice');

const INVOICES = 'invoices';
const SETTINGS = 'invoice_settings';
const COUNTERS = 'invoice_counters';
const CATALOG = 'ticket_catalog';
const AUDIT = 'admin_logs';
const MAX_PAGE = 50;
const MAX_SCAN = 250;
const OPERATOR_ACTIONS = new Set(['saveSettings']);
const READ_ACTIONS = new Set(['list', 'get', 'settings']);
const ACTIONS = new Set([...READ_ACTIONS, ...OPERATOR_ACTIONS, 'saveDraft', 'deleteDraft']);
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

/** A list row: what the list shows, no lines. */
function invoiceSummary(stored, id) {
  return {
    id,
    status: statusOf(stored),
    number: typeof stored.number === 'string' ? sanitizeInvoiceText(stored.number) : null,
    currency: typeof stored.currency === 'string' ? stored.currency : 'usd',
    billTo: publicBillTo(stored.billTo),
    reference: sanitizeInvoiceText(stored.reference),
    dueDate: typeof stored.dueDate === 'string' ? stored.dueDate : null,
    totals: publicTotals(stored.totals),
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
    createdBy: typeof stored.createdBy === 'string' ? stored.createdBy : null,
    updatedBy: typeof stored.updatedBy === 'string' ? stored.updatedBy : null,
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

/**
 * @param {{ db: object, auth: object, getConfig: () => Promise<object>,
 *           now?: () => Date, log?: object }} deps
 */
function createInvoiceAdminHandler({ db, auth, getConfig, now = () => new Date(), log = console }) {
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
      const deps = { db, actor, body, now };
      let result;
      if (action === 'list') result = await listInvoices(deps);
      else if (action === 'get') result = await readInvoice(deps);
      else if (action === 'settings') result = await readSettings(deps);
      else if (action === 'saveDraft') result = await saveDraft(deps);
      else if (action === 'deleteDraft') result = await deleteDraft(deps);
      else if (action === 'saveSettings') result = await saveSettings(deps);
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof InvoiceError) return sendError(res, error.status, error.code, error.message);
      log.error('invoice operation failed', { action, code: error?.code || 'internal' });
      return sendError(res, 503, 'unavailable', 'Invoices could not complete this action. Reload the invoice before trying again.');
    }
  };
}

/** Deployable export: invoiceAdmin. */
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  return {
    invoiceAdmin: onRequest({ region }, async (req, res) => {
      const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
      if (applyCors(req, res, { allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS), methods: ['POST'] })) return;
      const { getDb } = require('../core/firestore.cjs');
      const { getEventConfig } = require('../core/config.cjs');
      const { getAuth } = require('firebase-admin/auth');
      const db = getDb();
      await createInvoiceAdminHandler({ db, auth: getAuth(), getConfig: () => getEventConfig({ db }) })(req, res);
    }),
  };
}

module.exports = {
  createInvoiceAdminHandler,
  publicInvoice,
  get handlers() { return buildHandlers(); },
  internals: { MAX_SCAN, MAX_PAGE, OPERATOR_ACTIONS, READ_ACTIONS, listInvoices, saveDraft, publicSettings },
};
