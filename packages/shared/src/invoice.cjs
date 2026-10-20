'use strict';

/**
 * Invoice arithmetic, money parsing, validation and text cleaning (issue
 * #208). The admin form's live totals and the invoiceAdmin endpoint read
 * this one module, so the preview and the stored figures cannot disagree.
 *
 * MINOR UNITS. Every amount is a safe integer in the currency's minor unit
 * (cents for USD). The form parses what staff type into an integer once,
 * here, and every sum after that is integer arithmetic. No binary fraction
 * ever reaches a total.
 *
 * THE SERVER DECIDES. validateInvoiceDraft keeps the fields a draft may set
 * and drops the rest: a client cannot send its own totals, status, number
 * or issuer. The totals it returns are computed again from the lines.
 *
 * Tax and discount rows are amounts staff type by hand. There is no rate
 * and no rounding rule to agree on.
 */
const { CURRENCY_EXPONENTS } = require('./ticketCommerce.cjs');
const { EMAIL_ADDRESS_RE } = require('./email.cjs');
const { isKnownTimeZone, wallParts } = require('./eventDateTime.cjs');

/** The largest single amount or total: 99,999,999.99 in a two-digit currency. */
const MAX_INVOICE_AMOUNT = 9999999999;
const MAX_QUANTITY = 100000;
const INVOICE_LIMITS = Object.freeze({
  lines: 50,
  adjustments: 10,
  description: 500,
  label: 120,
  name: 200,
  contactName: 200,
  email: 254,
  address: 1000,
  reference: 100,
  notes: 2000,
  issuerName: 200,
  issuerAddress: 1000,
  taxId: 100,
  paymentInstructions: 2000,
  paymentNote: 500,
  voidReason: 500,
  reopenReason: 500,
  sendNote: 1000,
});
const INVOICE_STATUSES = Object.freeze(['draft', 'issued', 'paid', 'void']);
const ADJUSTMENT_KINDS = Object.freeze(['discount', 'tax']);
/** How a payment arrived. `card` is the method the Stripe pay link records (#519). */
const PAYMENT_METHODS = Object.freeze(['bank-transfer', 'check', 'card', 'cash', 'other']);
const PAYMENT_METHOD_WORDS = Object.freeze({
  'bank-transfer': 'Bank transfer',
  check: 'Check',
  card: 'Card',
  cash: 'Cash',
  other: 'Other',
});
const DEFAULT_INVOICE_PREFIX = 'INV';
const DEFAULT_INVOICE_CURRENCY = 'usd';
const PREFIX_RE = /^[A-Z][A-Z0-9-]{0,9}$/;
const INVOICE_ID_RE = /^inv_[a-z0-9]{16,40}$/;
const ORGANIZATION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// C0 and C1 controls (a newline is handled on its own), direction overrides
// and isolates, and the zero-width characters that make two strings look
// the same while they compare differently.
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;
const INVISIBLE_RE = /[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;
const LONE_SURROGATE_RE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

function exponentOf(currency) {
  const code = typeof currency === 'string' ? currency.trim().toLowerCase() : '';
  return Object.hasOwn(CURRENCY_EXPONENTS, code) ? CURRENCY_EXPONENTS[code] : null;
}

function isInvoiceId(value) {
  return typeof value === 'string' && INVOICE_ID_RE.test(value);
}

/**
 * Clean text that staff type or that an organization record supplies. One
 * line by default; `multiline` keeps line breaks (an address, the notes)
 * and allows at most one blank line in a row. Run on write and on read.
 *
 * @param {unknown} value
 * @param {{ multiline?: boolean }} [options]
 * @returns {string}
 */
function sanitizeInvoiceText(value, { multiline = false } = {}) {
  if (typeof value !== 'string') return '';
  let text = value
    .replace(LONE_SURROGATE_RE, '')
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(CONTROL_RE, '')
    .replace(INVISIBLE_RE, '');
  if (!multiline) return text.replace(/\s+/g, ' ').trim();
  text = text
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

function isAmount(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_INVOICE_AMOUNT;
}

/**
 * The invoice's figures. Lines are quantity times unit amount; discounts
 * subtract and taxes add. `problem` is 'invalid' for a value that is not a
 * whole number in range, 'too-large' past MAX_INVOICE_AMOUNT, and
 * 'negative' when the discounts take the total below zero.
 *
 * @param {{ lines: Array<{ quantity: number, unitAmount: number }>,
 *           adjustments: Array<{ kind: 'discount'|'tax', amount: number }> }} input
 */
function computeInvoiceTotals(input) {
  const refuse = (problem) => ({
    ok: false, problem, lineAmounts: [], subtotal: 0, discountTotal: 0, taxTotal: 0, total: 0,
  });
  const lines = input?.lines;
  const adjustments = input?.adjustments ?? [];
  if (!Array.isArray(lines) || !Array.isArray(adjustments)) return refuse('invalid');
  const lineAmounts = [];
  let subtotal = 0;
  for (const line of lines) {
    const quantity = line?.quantity;
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY || !isAmount(line?.unitAmount)) {
      return refuse('invalid');
    }
    const amount = quantity * line.unitAmount;
    if (amount > MAX_INVOICE_AMOUNT) return refuse('too-large');
    lineAmounts.push(amount);
    subtotal += amount;
    if (subtotal > MAX_INVOICE_AMOUNT) return refuse('too-large');
  }
  let discountTotal = 0;
  let taxTotal = 0;
  for (const row of adjustments) {
    if (!ADJUSTMENT_KINDS.includes(row?.kind) || !isAmount(row?.amount)) return refuse('invalid');
    if (row.kind === 'discount') discountTotal += row.amount;
    else taxTotal += row.amount;
    if (discountTotal > MAX_INVOICE_AMOUNT || taxTotal > MAX_INVOICE_AMOUNT) return refuse('too-large');
  }
  const total = subtotal - discountTotal + taxTotal;
  if (total < 0) return refuse('negative');
  if (total > MAX_INVOICE_AMOUNT) return refuse('too-large');
  return { ok: true, problem: null, lineAmounts, subtotal, discountTotal, taxTotal, total };
}

/**
 * What staff type in a money field, as minor units. Digits, an optional
 * point and up to the currency's minor digits; commas may group thousands.
 * No sign and no currency symbol: a discount row subtracts on its own.
 *
 * @param {unknown} text
 * @param {string} currency
 * @returns {{ ok: true, amount: number } | { ok: false, message: string }}
 */
function parseMoneyInput(text, currency) {
  const exponent = exponentOf(currency);
  if (exponent === null) return { ok: false, message: 'Choose a supported currency.' };
  if (typeof text !== 'string' || !text.trim()) return { ok: false, message: 'Enter an amount.' };
  const clean = text.trim();
  if (clean.startsWith('-')) return { ok: false, message: 'Enter an amount of zero or more. A discount row subtracts on its own.' };
  const match = /^(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d*))?$/.exec(clean);
  if (!match || (!match[1] && !match[2])) {
    return { ok: false, message: 'Enter an amount in digits, such as 1250.00.' };
  }
  const whole = (match[1] ?? '0').replace(/,/g, '');
  const fraction = match[2] ?? '';
  if (fraction.length > exponent) {
    return {
      ok: false,
      message: exponent === 0 ? 'Enter a whole amount.' : `Use at most ${exponent} digits after the decimal point.`,
    };
  }
  const tooLarge = { ok: false, message: `Enter an amount of ${minorToInput(MAX_INVOICE_AMOUNT, currency)} or less.` };
  if (whole.replace(/^0+/, '').length > 12) return tooLarge;
  const amount = Number(whole) * 10 ** exponent + Number(fraction.padEnd(exponent, '0') || '0');
  if (!isAmount(amount)) return tooLarge;
  return { ok: true, amount };
}

/**
 * Minor units as the plain text a money field holds: "1234.56". Built from
 * the integer's digits, so it never shows a binary fraction.
 */
function minorToInput(amount, currency) {
  const exponent = exponentOf(currency);
  if (exponent === null || !Number.isSafeInteger(amount) || amount < 0) return '';
  if (exponent === 0) return String(amount);
  const digits = String(amount).padStart(exponent + 1, '0');
  return `${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}

/**
 * Minor units as a reader sees money: "$1,234.56". Empty for a value that
 * is not a whole number or a currency this module does not support.
 */
function formatMoney(amount, currency, locale = 'en-US') {
  const exponent = exponentOf(currency);
  if (exponent === null || !Number.isSafeInteger(amount)) return '';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency.trim().toUpperCase(),
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(amount / 10 ** exponent);
}

/** The ticket catalog currency, then the settings currency, then USD. */
function resolveInvoiceCurrency(catalogCurrency, settingsCurrency) {
  for (const candidate of [catalogCurrency, settingsCurrency]) {
    if (exponentOf(candidate) !== null) return candidate.trim().toLowerCase();
  }
  return DEFAULT_INVOICE_CURRENCY;
}

/** "INV-0001". The number has at least four digits. */
function formatInvoiceNumber(prefix, sequence) {
  return `${prefix}-${String(sequence).padStart(4, '0')}`;
}

function isCalendarDate(value) {
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * The calendar date of one instant on the event's clock, as 'YYYY-MM-DD'.
 * Issue dates and payment dates are event dates, like the due date. A
 * missing or unknown zone reads the date in UTC rather than failing.
 *
 * @param {Date} instant
 * @param {unknown} timeZone
 */
function invoiceDateIn(instant, timeZone) {
  if (!isKnownTimeZone(timeZone)) return instant.toISOString().slice(0, 10);
  const parts = wallParts(instant, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** One validator's bookkeeping: a cleaned text field and its limit. */
function textField(issues, path, value, max, { required = false, multiline = false, label }) {
  const clean = sanitizeInvoiceText(value, { multiline });
  if (required && !clean) issues.push({ path, message: `Enter ${label}.` });
  else if (clean.length > max) issues.push({ path, message: `Use ${max} characters or fewer for ${label}.` });
  return clean;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * A draft as the server stores it, from what the form sent. Unknown fields
 * are dropped. A draft may have no lines yet; issuing one needs a line.
 *
 * @param {unknown} input
 * @returns {{ ok: boolean, value: object|null, issues: Array<{ path: string, message: string }> }}
 */
function validateInvoiceDraft(input) {
  if (!isRecord(input)) {
    return { ok: false, value: null, issues: [{ path: 'invoice', message: 'An invoice is required.' }] };
  }
  const issues = [];
  const billToInput = isRecord(input.billTo) ? input.billTo : {};
  const organizationId = typeof billToInput.organizationId === 'string' ? billToInput.organizationId.trim() : '';
  if (organizationId && !ORGANIZATION_ID_RE.test(organizationId)) {
    issues.push({ path: 'billTo.organizationId', message: 'Choose an organization from the list.' });
  }
  const billTo = {
    organizationId: organizationId || null,
    name: textField(issues, 'billTo.name', billToInput.name, INVOICE_LIMITS.name, { required: true, label: 'the name to bill' }),
    contactName: textField(issues, 'billTo.contactName', billToInput.contactName, INVOICE_LIMITS.contactName, { label: 'the contact name' }),
    email: textField(issues, 'billTo.email', billToInput.email, INVOICE_LIMITS.email, { label: 'the billing email' }).toLowerCase(),
    address: textField(issues, 'billTo.address', billToInput.address, INVOICE_LIMITS.address, { multiline: true, label: 'the billing address' }),
  };
  if (billTo.email && !EMAIL_ADDRESS_RE.test(billTo.email)) {
    issues.push({ path: 'billTo.email', message: 'Enter a valid billing email, or leave it empty.' });
  }

  const lines = [];
  if (!Array.isArray(input.lines ?? [])) {
    issues.push({ path: 'lines', message: 'Lines must be a list.' });
  } else if ((input.lines ?? []).length > INVOICE_LIMITS.lines) {
    issues.push({ path: 'lines', message: `An invoice holds at most ${INVOICE_LIMITS.lines} lines.` });
  } else {
    (input.lines ?? []).forEach((source, index) => {
      const path = `lines.${index}`;
      const row = isRecord(source) ? source : {};
      const description = textField(issues, `${path}.description`, row.description, INVOICE_LIMITS.description, { required: true, label: 'a description' });
      if (!Number.isSafeInteger(row.quantity) || row.quantity < 1 || row.quantity > MAX_QUANTITY) {
        issues.push({ path: `${path}.quantity`, message: `Enter a whole quantity from 1 to ${MAX_QUANTITY}.` });
      }
      if (!isAmount(row.unitAmount)) {
        issues.push({ path: `${path}.unitAmount`, message: 'Enter a unit price of zero or more.' });
      }
      lines.push({ description, quantity: row.quantity, unitAmount: row.unitAmount });
    });
  }

  const adjustments = [];
  if (!Array.isArray(input.adjustments ?? [])) {
    issues.push({ path: 'adjustments', message: 'Tax and discount rows must be a list.' });
  } else if ((input.adjustments ?? []).length > INVOICE_LIMITS.adjustments) {
    issues.push({ path: 'adjustments', message: `An invoice holds at most ${INVOICE_LIMITS.adjustments} tax and discount rows.` });
  } else {
    (input.adjustments ?? []).forEach((source, index) => {
      const path = `adjustments.${index}`;
      const row = isRecord(source) ? source : {};
      if (!ADJUSTMENT_KINDS.includes(row.kind)) issues.push({ path: `${path}.kind`, message: 'Choose tax or discount.' });
      const label = textField(issues, `${path}.label`, row.label, INVOICE_LIMITS.label, { required: true, label: 'a label' });
      if (!isAmount(row.amount)) issues.push({ path: `${path}.amount`, message: 'Enter an amount of zero or more.' });
      adjustments.push({ kind: row.kind, label, amount: row.amount });
    });
  }

  const reference = textField(issues, 'reference', input.reference, INVOICE_LIMITS.reference, { label: 'the reference' });
  const notes = textField(issues, 'notes', input.notes, INVOICE_LIMITS.notes, { multiline: true, label: 'the notes' });
  const dueDate = typeof input.dueDate === 'string' ? input.dueDate.trim() : '';
  if (input.dueDate !== undefined && input.dueDate !== null && typeof input.dueDate !== 'string') {
    issues.push({ path: 'dueDate', message: 'Enter the due date as a date.' });
  } else if (dueDate && !isCalendarDate(dueDate)) {
    issues.push({ path: 'dueDate', message: 'Enter a real calendar date.' });
  }

  if (issues.length) return { ok: false, value: null, issues };
  const totals = computeInvoiceTotals({ lines, adjustments });
  if (!totals.ok) {
    const message = totals.problem === 'negative'
      ? 'The discounts take the total below zero. Reduce a discount.'
      : `The total must be ${minorToInput(MAX_INVOICE_AMOUNT, DEFAULT_INVOICE_CURRENCY)} or less.`;
    return { ok: false, value: null, issues: [{ path: 'totals', message }] };
  }
  return {
    ok: true,
    issues: [],
    value: {
      billTo,
      reference,
      lines: lines.map((line, index) => ({ ...line, amount: totals.lineAmounts[index] })),
      adjustments,
      dueDate: dueDate || null,
      notes,
      totals: {
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
      },
    },
  };
}

/**
 * invoice_settings/current: the issuer block and payment instructions every
 * issued invoice copies, the number prefix, and the fallback currency.
 *
 * @param {unknown} input
 */
function validateInvoiceSettings(input) {
  if (!isRecord(input)) {
    return { ok: false, value: null, issues: [{ path: 'settings', message: 'Invoice settings are required.' }] };
  }
  const issues = [];
  const prefixInput = typeof input.prefix === 'string' ? input.prefix.trim() : '';
  const prefix = prefixInput || DEFAULT_INVOICE_PREFIX;
  if (!PREFIX_RE.test(prefix)) {
    issues.push({ path: 'prefix', message: 'Use 1 to 10 capital letters, digits or hyphens, starting with a letter.' });
  }
  const currencyInput = typeof input.currency === 'string' ? input.currency.trim().toLowerCase() : '';
  if (currencyInput && exponentOf(currencyInput) === null) {
    issues.push({ path: 'currency', message: 'Choose USD, CAD, EUR, GBP, AUD or NZD.' });
  }
  const value = {
    prefix,
    currency: currencyInput,
    issuerName: textField(issues, 'issuerName', input.issuerName, INVOICE_LIMITS.issuerName, { label: 'the issuer name' }),
    issuerAddress: textField(issues, 'issuerAddress', input.issuerAddress, INVOICE_LIMITS.issuerAddress, { multiline: true, label: 'the issuer address' }),
    issuerEmail: textField(issues, 'issuerEmail', input.issuerEmail, INVOICE_LIMITS.email, { label: 'the issuer email' }).toLowerCase(),
    taxId: textField(issues, 'taxId', input.taxId, INVOICE_LIMITS.taxId, { label: 'the tax ID' }),
    paymentInstructions: textField(issues, 'paymentInstructions', input.paymentInstructions, INVOICE_LIMITS.paymentInstructions, { multiline: true, label: 'the payment instructions' }),
  };
  if (value.issuerEmail && !EMAIL_ADDRESS_RE.test(value.issuerEmail)) {
    issues.push({ path: 'issuerEmail', message: 'Enter a valid email, or leave it empty.' });
  }
  return issues.length ? { ok: false, value: null, issues } : { ok: true, value, issues: [] };
}

/**
 * A payment staff record when they mark an invoice paid: the date it
 * arrived (an event date, not after `today`), how it arrived, and an
 * optional note such as a check number. Unknown fields are dropped.
 *
 * @param {unknown} input
 * @param {{ today: string }} context today's date on the event clock
 */
function validatePayment(input, { today }) {
  if (!isRecord(input)) {
    return { ok: false, value: null, issues: [{ path: 'payment', message: 'Enter the payment details.' }] };
  }
  const issues = [];
  const paidOn = typeof input.paidOn === 'string' ? input.paidOn.trim() : '';
  if (!paidOn) issues.push({ path: 'paidOn', message: 'Enter the date the payment arrived.' });
  else if (!isCalendarDate(paidOn)) issues.push({ path: 'paidOn', message: 'Enter a real calendar date.' });
  else if (paidOn > today) issues.push({ path: 'paidOn', message: `The payment date cannot be after today (${today}).` });
  const method = typeof input.method === 'string' ? input.method : '';
  if (!PAYMENT_METHODS.includes(method)) issues.push({ path: 'method', message: 'Choose how the payment arrived.' });
  const note = textField(issues, 'note', input.note, INVOICE_LIMITS.paymentNote, { label: 'the payment note' });
  return issues.length ? { ok: false, value: null, issues } : { ok: true, issues: [], value: { paidOn, method, note } };
}

/** Why an invoice is voided. Required, one line, cleaned. */
function validateVoidReason(input) {
  const issues = [];
  const value = textField(issues, 'reason', input, INVOICE_LIMITS.voidReason, { required: true, label: 'the reason for the void' });
  return issues.length ? { ok: false, value: null, issues } : { ok: true, issues: [], value };
}

/**
 * Why an operator reopens a paid invoice, such as a bounced check.
 * Required, one line, cleaned. The payment it undoes is kept in the
 * invoice's payment history, never deleted.
 */
function validateReopenReason(input) {
  const issues = [];
  const value = textField(issues, 'reason', input, INVOICE_LIMITS.reopenReason, { required: true, label: 'the reason for reopening' });
  return issues.length ? { ok: false, value: null, issues } : { ok: true, issues: [], value };
}

/**
 * What staff add when they email an issued invoice (#208, part 4): an
 * optional copy address and an optional note for the email body. The
 * recipient is never an input: it is the billing email on the invoice,
 * passed here as `to`, so a request cannot send the invoice anywhere else.
 * Unknown fields are dropped.
 *
 * The copy address is one address, checked as typed: a list, a display
 * name or a line break is refused, so it cannot add a recipient or a
 * header. The note is plain text, cleaned like the invoice notes.
 *
 * @param {unknown} input
 * @param {{ to: string }} context the billing email on the invoice
 * @returns {{ ok: boolean, value: { cc: string|null, note: string }|null, issues: Array<{ path: string, message: string }> }}
 */
function validateInvoiceSend(input, { to } = {}) {
  if (!isRecord(input)) {
    return { ok: false, value: null, issues: [{ path: 'send', message: 'Enter the email details.' }] };
  }
  const issues = [];
  const rawCc = typeof input.cc === 'string' ? input.cc.trim().toLowerCase() : '';
  let cc = null;
  if (rawCc) {
    if (rawCc.length > INVOICE_LIMITS.email || !EMAIL_ADDRESS_RE.test(rawCc) || rawCc.includes(',')) {
      issues.push({ path: 'cc', message: 'Enter a valid email for the copy, or leave it empty.' });
    } else if (typeof to === 'string' && rawCc === to.trim().toLowerCase()) {
      issues.push({ path: 'cc', message: 'The billing email already gets the invoice. Enter a different address for the copy, or leave it empty.' });
    } else {
      cc = rawCc;
    }
  }
  const note = textField(issues, 'note', input.note, INVOICE_LIMITS.sendNote, { multiline: true, label: 'the note' });
  return issues.length ? { ok: false, value: null, issues } : { ok: true, issues: [], value: { cc, note } };
}

/**
 * What stops a valid draft from being issued: no line, a due date before
 * the issue date, or invoice settings with no issuer name. An empty list
 * means it is ready.
 *
 * @param {{ lines: unknown[], dueDate: string|null }} value a validateInvoiceDraft value
 * @param {{ settings: { issuerName?: string }, issueDate: string }} context
 */
function issueProblems(value, { settings, issueDate }) {
  const issues = [];
  if (!Array.isArray(value?.lines) || value.lines.length === 0) {
    issues.push({ path: 'lines', message: 'Add at least one line before issuing.' });
  }
  if (value?.dueDate && value.dueDate < issueDate) {
    issues.push({ path: 'dueDate', message: `The due date is before the issue date (${issueDate}). Change the due date.` });
  }
  if (!sanitizeInvoiceText(settings?.issuerName)) {
    issues.push({ path: 'settings.issuerName', message: 'The invoice settings have no issuer name. Ask an operator to fill in the invoice settings.' });
  }
  return issues;
}

module.exports = {
  MAX_INVOICE_AMOUNT, MAX_QUANTITY, INVOICE_LIMITS, INVOICE_STATUSES, ADJUSTMENT_KINDS,
  PAYMENT_METHODS, PAYMENT_METHOD_WORDS, DEFAULT_INVOICE_PREFIX, DEFAULT_INVOICE_CURRENCY,
  isInvoiceId, sanitizeInvoiceText, computeInvoiceTotals, parseMoneyInput, minorToInput, formatMoney,
  resolveInvoiceCurrency, formatInvoiceNumber, validateInvoiceDraft, validateInvoiceSettings,
  invoiceDateIn, validatePayment, validateVoidReason, validateReopenReason, issueProblems, validateInvoiceSend,
};
