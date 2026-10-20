// Invoice form helpers for the invoice list, editor and settings pages
// (issue #208). The money rules live in shared/invoice, which the server
// reads too: this module only turns what staff type into the draft the
// endpoint takes, and a stored invoice back into the form.
//
// A FIELD KEY IS THE SERVER'S PATH. 'billTo.name', 'lines.0.unitAmount' and
// the rest are the paths validateInvoiceDraft names, so a mark made here
// before a save and a mark made from the server's refusal land on the same
// field.
import {
  INVOICE_LIMITS,
  MAX_QUANTITY,
  computeInvoiceTotals,
  minorToInput,
  parseMoneyInput,
  validateInvoiceDraft,
} from 'shared/invoice';

export const INVOICES_ROOT = '/admin/invoices';
export const INVOICE_SETTINGS_PATH = `${INVOICES_ROOT}/settings`;

/** One word per status, the same everywhere it shows. Never colour alone. */
export const INVOICE_STATUS_WORDS = Object.freeze({
  draft: 'Draft',
  issued: 'Issued',
  paid: 'Paid',
  void: 'Void',
});

/** The badge tone under each word. */
export const INVOICE_STATUS_TONES = Object.freeze({
  draft: 'draft',
  issued: 'info',
  paid: 'ok',
  void: 'dead',
});

export const ADJUSTMENT_WORDS = Object.freeze({ discount: 'Discount', tax: 'Tax' });

/** The supported currencies, as the settings page offers them. */
export const CURRENCY_CHOICES = Object.freeze(['usd', 'cad', 'eur', 'gbp', 'aud', 'nzd']);

let keySeed = 0;
/** A React key for a row the form adds. Never sent to the server. */
function rowKey() {
  keySeed += 1;
  return `row-${keySeed}`;
}

/**
 * A new invoice's id: one per form, sent unchanged on every attempt, so a
 * retry after a lost answer saves the same draft and never a second one.
 * The server takes `inv_` and 16 to 40 lowercase letters or digits.
 */
export function mintInvoiceId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `inv_${crypto.randomUUID().replace(/-/g, '')}`;
  }
  const random = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  return `inv_${random.replace(/[^a-z0-9]/g, '').slice(0, 32).padEnd(16, '0')}`;
}

export function blankLine() {
  return { key: rowKey(), description: '', quantity: '1', unitPrice: '' };
}

export function blankAdjustment(kind = 'discount') {
  return { key: rowKey(), kind, label: kind === 'tax' ? 'Tax' : '', amount: '' };
}

export function blankInvoiceForm() {
  return {
    organizationId: '',
    billTo: { name: '', contactName: '', email: '', address: '' },
    reference: '',
    lines: [blankLine()],
    adjustments: [],
    dueDate: '',
    notes: '',
  };
}

/** A stored invoice (the endpoint's `invoice`) as the form edits it. */
export function toInvoiceForm(invoice) {
  const currency = invoice?.currency;
  const lines = (invoice?.lines ?? []).map((line) => ({
    key: rowKey(),
    description: line.description ?? '',
    quantity: Number.isSafeInteger(line.quantity) ? String(line.quantity) : '',
    unitPrice: minorToInput(line.unitAmount, currency),
  }));
  return {
    organizationId: invoice?.billTo?.organizationId ?? '',
    billTo: {
      name: invoice?.billTo?.name ?? '',
      contactName: invoice?.billTo?.contactName ?? '',
      email: invoice?.billTo?.email ?? '',
      address: invoice?.billTo?.address ?? '',
    },
    reference: invoice?.reference ?? '',
    lines,
    adjustments: (invoice?.adjustments ?? []).map((row) => ({
      key: rowKey(),
      kind: row.kind === 'tax' ? 'tax' : 'discount',
      label: row.label ?? '',
      amount: minorToInput(row.amount, currency),
    })),
    dueDate: invoice?.dueDate ?? '',
    notes: invoice?.notes ?? '',
  };
}

/** The form without its React keys, for an unsaved-changes compare. */
export function formSnapshot(form) {
  const strip = ({ key: _key, ...rest }) => rest;
  return JSON.stringify({ ...form, lines: form.lines.map(strip), adjustments: form.adjustments.map(strip) });
}

function parseQuantity(text) {
  const clean = String(text ?? '').trim();
  if (!/^\d+$/.test(clean)) return { ok: false, message: `Enter a whole quantity from 1 to ${MAX_QUANTITY}.` };
  const quantity = Number(clean);
  if (quantity < 1 || quantity > MAX_QUANTITY) return { ok: false, message: `Enter a whole quantity from 1 to ${MAX_QUANTITY}.` };
  return { ok: true, quantity };
}

function lineIsBlank(line) {
  return !line.description.trim() && !line.unitPrice.trim() && ['', '1'].includes(line.quantity.trim());
}

function adjustmentIsBlank(row) {
  return !row.label.trim() && !row.amount.trim();
}

/**
 * A path in the draft the endpoint took, as the path of the form field it
 * came from. The form drops blank rows before a save, so row 2 of the
 * draft may be row 3 on screen. `rows` is formToDraft's own record.
 */
export function formPathOf(path, rows) {
  const match = /^(lines|adjustments)\.(\d+)(\..+)?$/.exec(path ?? '');
  if (!match) return path;
  const formIndex = rows?.[match[1]]?.[Number(match[2])];
  return formIndex === undefined ? match[1] : `${match[1]}.${formIndex}${match[3] ?? ''}`;
}

/**
 * The draft the endpoint takes, and each field's problem before a save,
 * keyed by the form's own paths. A row the form left completely empty is
 * dropped, so a blank last line never blocks a save. `rows` maps each
 * draft row back to its row on screen (formPathOf).
 *
 * @returns {{ draft: object, errors: Map<string, string>, rows: { lines: number[], adjustments: number[] } }}
 */
export function formToDraft(form, currency) {
  const errors = new Map();
  const rows = { lines: [], adjustments: [] };
  const lines = [];
  form.lines.forEach((line, index) => {
    if (lineIsBlank(line)) return;
    rows.lines.push(index);
    const quantity = parseQuantity(line.quantity);
    if (!quantity.ok) errors.set(`lines.${index}.quantity`, quantity.message);
    const price = parseMoneyInput(line.unitPrice, currency);
    if (!price.ok) errors.set(`lines.${index}.unitAmount`, price.message);
    lines.push({
      description: line.description,
      quantity: quantity.ok ? quantity.quantity : 1,
      unitAmount: price.ok ? price.amount : 0,
    });
  });
  const adjustments = [];
  form.adjustments.forEach((row, index) => {
    if (adjustmentIsBlank(row)) return;
    rows.adjustments.push(index);
    const amount = parseMoneyInput(row.amount, currency);
    if (!amount.ok) errors.set(`adjustments.${index}.amount`, amount.message);
    adjustments.push({ kind: row.kind, label: row.label, amount: amount.ok ? amount.amount : 0 });
  });
  const draft = {
    billTo: { organizationId: form.organizationId || null, ...form.billTo },
    reference: form.reference,
    lines,
    adjustments,
    dueDate: form.dueDate || null,
    notes: form.notes,
  };
  // Parse problems come first: they say more than "enter an amount". The
  // shared validator then checks every other rule the server applies. A
  // total problem is checked only once every row parses, because a row
  // counted as zero would make the total wrong.
  const verdict = validateInvoiceDraft(draft);
  for (const issue of verdict.issues) {
    if (issue.path === 'totals' && errors.size > 0) continue;
    const path = formPathOf(issue.path, rows);
    if (!errors.has(path)) errors.set(path, issue.message);
  }
  return { draft, errors, rows };
}

/**
 * The live totals under the form. A row whose numbers do not parse yet
 * counts as nothing and is reported in `skipped`; the figures never guess.
 */
export function previewTotals(form, currency) {
  let skipped = 0;
  const lines = [];
  const lineAmounts = form.lines.map((line) => {
    if (lineIsBlank(line)) return null;
    const quantity = parseQuantity(line.quantity);
    const price = parseMoneyInput(line.unitPrice, currency);
    if (!quantity.ok || !price.ok) {
      skipped += 1;
      return null;
    }
    lines.push({ quantity: quantity.quantity, unitAmount: price.amount });
    const single = computeInvoiceTotals({ lines: [{ quantity: quantity.quantity, unitAmount: price.amount }], adjustments: [] });
    return single.ok ? single.total : null;
  });
  const adjustments = [];
  for (const row of form.adjustments) {
    if (adjustmentIsBlank(row)) continue;
    const amount = parseMoneyInput(row.amount, currency);
    if (!amount.ok) {
      skipped += 1;
      continue;
    }
    adjustments.push({ kind: row.kind, amount: amount.amount });
  }
  const totals = computeInvoiceTotals({ lines, adjustments });
  return { ...totals, lineAmounts, skipped };
}

/**
 * The sponsor packages the site shows, by name, from the cmsContent rows
 * (useAdminContent). A package's price is free text ("$5,000 per year"),
 * so the first number in it is read as the price, and a price that does
 * not parse is left for staff to type.
 */
export function sponsorPackagesFrom(contentRows) {
  const packages = [];
  for (const row of contentRows ?? []) {
    const doc = row?.current;
    if (doc?.blockType !== 'sponsor_package') continue;
    const values = doc.values && typeof doc.values === 'object' ? doc.values : doc;
    const name = typeof values.name === 'string' ? values.name.trim() : '';
    if (!name) continue;
    packages.push({ id: row.id, name, price: typeof values.price === 'string' ? values.price.trim() : '' });
  }
  return packages;
}

/** The first number in a package's price text, as a money field holds it. */
export function priceFromPackage(price, currency) {
  const match = /\d[\d,]*(?:\.\d+)?/.exec(String(price ?? ''));
  if (!match) return '';
  const parsed = parseMoneyInput(match[0], currency);
  return parsed.ok ? minorToInput(parsed.amount, currency) : '';
}

function sameWords(a, b) {
  return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
}

/**
 * Fill the bill-to block from an organization, and the first line from the
 * sponsor package its tier names. Lines staff already wrote are kept.
 *
 * @returns {{ form: object, filled: string }} `filled` says what changed, for the status line
 */
export function prefillFromOrganization(form, organization, packages, currency) {
  if (!organization) return { form: { ...form, organizationId: '' }, filled: '' };
  const current = organization.current ?? {};
  const name = typeof current.name === 'string' ? current.name.trim() : '';
  const next = {
    ...form,
    organizationId: organization.id,
    billTo: { ...form.billTo, name: name || form.billTo.name },
  };
  const linesEmpty = form.lines.every(lineIsBlank);
  const pack = (packages ?? []).find((candidate) => sameWords(candidate.name, current.tier));
  if (pack && linesEmpty) {
    next.lines = [{ key: rowKey(), description: pack.name, quantity: '1', unitPrice: priceFromPackage(pack.price, currency) }];
    return { form: next, filled: `Filled the name and a line for the ${pack.name} package.` };
  }
  if (pack) return { form: next, filled: `Filled the name. Your lines are kept; the ${pack.name} package was not added.` };
  return { form: next, filled: 'Filled the name.' };
}

/** "billTo.name: Enter the name to bill." → "Enter the name to bill." */
export function messageOf(segment) {
  return segment.replace(/^[A-Za-z0-9_.]+:\s*/, '');
}

export { INVOICE_LIMITS };
