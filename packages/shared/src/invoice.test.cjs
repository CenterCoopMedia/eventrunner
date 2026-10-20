'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  INVOICE_LIMITS, MAX_INVOICE_AMOUNT, DEFAULT_INVOICE_PREFIX,
  isInvoiceId, computeInvoiceTotals, parseMoneyInput, formatMoney, minorToInput,
  validateInvoiceDraft, validateInvoiceSettings, sanitizeInvoiceText,
  resolveInvoiceCurrency, formatInvoiceNumber,
  PAYMENT_METHODS, PAYMENT_METHOD_WORDS, invoiceDateIn, validatePayment, validateVoidReason, validateReopenReason, issueProblems,
  validateInvoiceSend,
} = require('./invoice.cjs');
const { CURRENCY_EXPONENTS } = require('./ticketCommerce.cjs');

const draft = (patch = {}) => ({
  billTo: { organizationId: 'example-press', name: 'Example Press', contactName: 'Ada Example', email: 'billing@example.org', address: '1 Main Street\nSuite 2' },
  reference: 'PO-77',
  lines: [{ description: 'Presenting package', quantity: 1, unitAmount: 500000 }],
  adjustments: [],
  dueDate: '2026-11-30',
  notes: '',
  ...patch,
});

test('totals add lines, subtract discounts and add taxes in minor units', () => {
  const totals = computeInvoiceTotals({
    lines: [{ quantity: 2, unitAmount: 12345 }, { quantity: 3, unitAmount: 1 }],
    adjustments: [{ kind: 'discount', amount: 5000 }, { kind: 'tax', amount: 1999 }, { kind: 'tax', amount: 1 }],
  });
  assert.deepEqual(totals, {
    ok: true, problem: null, lineAmounts: [24690, 3],
    subtotal: 24693, discountTotal: 5000, taxTotal: 2000, total: 21693,
  });
  // Ten cents three times is exactly thirty cents: no binary fractions.
  const cents = computeInvoiceTotals({ lines: [{ quantity: 3, unitAmount: 10 }], adjustments: [] });
  assert.equal(cents.total, 30);
  const empty = computeInvoiceTotals({ lines: [], adjustments: [] });
  assert.equal(empty.ok, true);
  assert.equal(empty.total, 0);
});

test('totals refuse a negative total, an amount past the ceiling, and non-integer values', () => {
  const negative = computeInvoiceTotals({ lines: [{ quantity: 1, unitAmount: 100 }], adjustments: [{ kind: 'discount', amount: 101 }] });
  assert.equal(negative.ok, false);
  assert.equal(negative.problem, 'negative');
  const huge = computeInvoiceTotals({ lines: [{ quantity: 2, unitAmount: MAX_INVOICE_AMOUNT }], adjustments: [] });
  assert.equal(huge.ok, false);
  assert.equal(huge.problem, 'too-large');
  for (const line of [{ quantity: 1.5, unitAmount: 1 }, { quantity: 1, unitAmount: 0.1 }, { quantity: 0, unitAmount: 1 }, { quantity: '1', unitAmount: 1 }]) {
    assert.equal(computeInvoiceTotals({ lines: [line], adjustments: [] }).problem, 'invalid');
  }
  assert.equal(computeInvoiceTotals({ lines: [], adjustments: [{ kind: 'fee', amount: 1 }] }).problem, 'invalid');
  assert.equal(computeInvoiceTotals(null).problem, 'invalid');
});

test('money input parses to minor units without floating point error', () => {
  assert.deepEqual(parseMoneyInput('1,234.56', 'usd'), { ok: true, amount: 123456 });
  assert.deepEqual(parseMoneyInput(' 0.1 ', 'USD'), { ok: true, amount: 10 });
  assert.deepEqual(parseMoneyInput('19.99', 'eur'), { ok: true, amount: 1999 });
  assert.deepEqual(parseMoneyInput('.5', 'gbp'), { ok: true, amount: 50 });
  assert.deepEqual(parseMoneyInput('1250', 'cad'), { ok: true, amount: 125000 });
  assert.deepEqual(parseMoneyInput('99999999.99', 'usd'), { ok: true, amount: MAX_INVOICE_AMOUNT });
  for (const bad of ['', '   ', '-5', '1.234', '12a', '1,23', '1..2', '$5', '1e3', 'NaN', '100000000.00']) {
    const parsed = parseMoneyInput(bad, 'usd');
    assert.equal(parsed.ok, false, bad);
    assert.equal(typeof parsed.message, 'string');
  }
  assert.match(parseMoneyInput('1.234', 'usd').message, /2 digits/);
  assert.match(parseMoneyInput('-5', 'usd').message, /positive|zero or more/i);
  assert.equal(parseMoneyInput('5', 'jpy').ok, false);
  assert.equal(parseMoneyInput(5, 'usd').ok, false);
});

test('money formats from minor units with the currency exponent', () => {
  assert.equal(formatMoney(123456, 'usd'), '$1,234.56');
  assert.equal(formatMoney(5, 'eur', 'en-US'), '€0.05');
  assert.equal(formatMoney(0, 'gbp'), '£0.00');
  assert.equal(formatMoney(1.5, 'usd'), '');
  assert.equal(formatMoney(100, 'xyz'), '');
  assert.equal(minorToInput(123456, 'usd'), '1234.56');
  assert.equal(minorToInput(5, 'usd'), '0.05');
  assert.equal(minorToInput(0, 'usd'), '0.00');
  assert.equal(minorToInput(null, 'usd'), '');
  for (const amount of [0, 1, 10, 99, 100, 123456, MAX_INVOICE_AMOUNT]) {
    assert.equal(parseMoneyInput(minorToInput(amount, 'usd'), 'usd').amount, amount);
  }
});

test('every supported ticket currency is an invoice currency', () => {
  for (const currency of Object.keys(CURRENCY_EXPONENTS)) {
    assert.equal(parseMoneyInput('1', currency).ok, true, currency);
    assert.notEqual(formatMoney(100, currency), '', currency);
  }
});

test('the invoice currency is the catalog currency, then the settings currency, then USD', () => {
  assert.equal(resolveInvoiceCurrency('eur', 'gbp'), 'eur');
  assert.equal(resolveInvoiceCurrency(null, 'GBP'), 'gbp');
  assert.equal(resolveInvoiceCurrency('jpy', ''), 'usd');
  assert.equal(resolveInvoiceCurrency(undefined, undefined), 'usd');
});

test('text sanitising removes control, direction and invisible characters', () => {
  assert.equal(sanitizeInvoiceText('  Example\u0000 Press\u202e\u200b  '), 'Example Press');
  assert.equal(sanitizeInvoiceText('One\r\nTwo\n\n\n\nThree  ', { multiline: true }), 'One\nTwo\n\nThree');
  assert.equal(sanitizeInvoiceText('One\nTwo'), 'One Two');
  assert.equal(sanitizeInvoiceText('Tab\there'), 'Tab here');
  assert.equal(sanitizeInvoiceText('\ud800broken'), 'broken');
  assert.equal(sanitizeInvoiceText('Cafe\u0301'), 'Café');
  assert.equal(sanitizeInvoiceText(42), '');
  assert.equal(sanitizeInvoiceText(null), '');
});

test('a draft normalizes, sanitises and carries totals the server computed', () => {
  const checked = validateInvoiceDraft(draft({
    lines: [{ description: ' Presenting\u202e package ', quantity: 2, unitAmount: 250000, amount: 1 }],
    adjustments: [{ kind: 'discount', label: 'Early commitment', amount: 50000 }, { kind: 'tax', label: 'Sales tax', amount: 31500 }],
    totals: { total: 1 },
    status: 'paid',
    number: 'INV-9999',
  }));
  assert.equal(checked.ok, true, JSON.stringify(checked.issues));
  assert.equal(checked.value.lines[0].description, 'Presenting package');
  assert.equal(checked.value.lines[0].amount, 500000);
  assert.deepEqual(checked.value.totals, { subtotal: 500000, discountTotal: 50000, taxTotal: 31500, total: 481500 });
  assert.equal(checked.value.billTo.address, '1 Main Street\nSuite 2');
  assert.equal('status' in checked.value, false);
  assert.equal('number' in checked.value, false);
});

test('a draft names the field that fails, and refuses a negative total', () => {
  const issues = (patch) => validateInvoiceDraft(draft(patch)).issues.map((issue) => issue.path);
  assert.deepEqual(issues({ billTo: { name: '   ' } }), ['billTo.name']);
  assert.deepEqual(issues({ billTo: { name: 'Example', email: 'not-an-address' } }), ['billTo.email']);
  assert.deepEqual(issues({ billTo: { name: 'Example', organizationId: 'a/b' } }), ['billTo.organizationId']);
  assert.deepEqual(issues({ lines: [{ description: '', quantity: 1, unitAmount: 1 }] }), ['lines.0.description']);
  assert.deepEqual(issues({ lines: [{ description: 'A', quantity: 0, unitAmount: 1 }] }), ['lines.0.quantity']);
  assert.deepEqual(issues({ lines: [{ description: 'A', quantity: 1, unitAmount: -1 }] }), ['lines.0.unitAmount']);
  assert.deepEqual(issues({ adjustments: [{ kind: 'fee', label: 'A', amount: 1 }] }), ['adjustments.0.kind']);
  assert.deepEqual(issues({ adjustments: [{ kind: 'tax', label: '', amount: 1 }] }), ['adjustments.0.label']);
  assert.deepEqual(issues({ dueDate: '2026-02-30' }), ['dueDate']);
  assert.deepEqual(issues({ dueDate: '30/11/2026' }), ['dueDate']);
  assert.deepEqual(issues({ notes: 'x'.repeat(INVOICE_LIMITS.notes + 1) }), ['notes']);
  assert.deepEqual(issues({ adjustments: [{ kind: 'discount', label: 'Too much', amount: 600000 }] }), ['totals']);
  assert.match(validateInvoiceDraft(draft({ adjustments: [{ kind: 'discount', label: 'Too much', amount: 600000 }] })).issues[0].message, /below zero/);
  assert.equal(validateInvoiceDraft(null).ok, false);
  assert.equal(validateInvoiceDraft(draft({ lines: 'x' })).ok, false);
});

test('a draft holds at most 50 lines and 10 tax and discount rows', () => {
  const line = { description: 'Item', quantity: 1, unitAmount: 100 };
  const row = { kind: 'tax', label: 'Tax', amount: 1 };
  assert.equal(INVOICE_LIMITS.lines, 50);
  assert.equal(INVOICE_LIMITS.adjustments, 10);
  assert.equal(validateInvoiceDraft(draft({ lines: Array(50).fill(line) })).ok, true);
  assert.deepEqual(validateInvoiceDraft(draft({ lines: Array(51).fill(line) })).issues.map((i) => i.path), ['lines']);
  assert.equal(validateInvoiceDraft(draft({ adjustments: Array(10).fill(row) })).ok, true);
  assert.deepEqual(validateInvoiceDraft(draft({ adjustments: Array(11).fill(row) })).issues.map((i) => i.path), ['adjustments']);
  // A draft may be saved before its lines are written.
  assert.equal(validateInvoiceDraft(draft({ lines: [] })).ok, true);
});

test('settings default the prefix, check the currency and keep payment text', () => {
  const checked = validateInvoiceSettings({
    issuerName: 'Example Events', issuerAddress: '2 High Street\r\nTown', issuerEmail: 'accounts@example.org',
    taxId: 'TAX-123', paymentInstructions: 'Bank transfer.\nAccount 000000.', currency: 'EUR',
  });
  assert.equal(checked.ok, true, JSON.stringify(checked.issues));
  assert.equal(checked.value.prefix, DEFAULT_INVOICE_PREFIX);
  assert.equal(checked.value.currency, 'eur');
  assert.equal(checked.value.issuerAddress, '2 High Street\nTown');
  const paths = (input) => validateInvoiceSettings(input).issues.map((issue) => issue.path);
  assert.deepEqual(paths({ prefix: 'inv 1' }), ['prefix']);
  assert.deepEqual(paths({ prefix: 'ABCDEFGHIJK' }), ['prefix']);
  assert.deepEqual(paths({ currency: 'jpy' }), ['currency']);
  assert.deepEqual(paths({ issuerEmail: 'nope' }), ['issuerEmail']);
  assert.equal(validateInvoiceSettings({ prefix: 'SPONSOR' }).value.prefix, 'SPONSOR');
  assert.equal(validateInvoiceSettings({ currency: '' }).value.currency, '');
  assert.equal(validateInvoiceSettings(null).ok, false);
});

test('ids and numbers have one shape', () => {
  assert.equal(isInvoiceId('inv_0123456789abcdef0123'), true);
  for (const bad of ['inv_short', 'INV_0123456789abcdef0123', 'inv_0123456789abcdef012/', '__proto__', 42]) {
    assert.equal(isInvoiceId(bad), false, String(bad));
  }
  assert.equal(formatInvoiceNumber('INV', 1), 'INV-0001');
  assert.equal(formatInvoiceNumber('SPONSOR', 12345), 'SPONSOR-12345');
});

test('the browser module exports the same functions', async () => {
  const esm = await import('./invoice.mjs');
  const cjs = require('./invoice.cjs');
  for (const name of Object.keys(cjs)) assert.equal(esm[name], cjs[name], name);
});

test('an invoice date is the calendar date on the event clock', () => {
  const lateEvening = new Date('2026-10-21T02:30:00Z');
  assert.equal(invoiceDateIn(lateEvening, 'America/New_York'), '2026-10-20');
  assert.equal(invoiceDateIn(lateEvening, 'Europe/London'), '2026-10-21');
  // A missing or unknown zone reads the date in UTC rather than failing.
  assert.equal(invoiceDateIn(lateEvening, ''), '2026-10-21');
  assert.equal(invoiceDateIn(lateEvening, 'Not/AZone'), '2026-10-21');
});

test('a payment needs a real date that is not in the future and a known method', () => {
  assert.deepEqual(PAYMENT_METHODS, ['bank-transfer', 'check', 'card', 'cash', 'other']);
  for (const method of PAYMENT_METHODS) assert.equal(typeof PAYMENT_METHOD_WORDS[method], 'string');
  const ok = validatePayment({ paidOn: '2026-10-20', method: 'check', note: ' Check 1042\u202e ', extra: 'x' }, { today: '2026-10-20' });
  assert.deepEqual(ok, { ok: true, issues: [], value: { paidOn: '2026-10-20', method: 'check', note: 'Check 1042' } });
  const bad = validatePayment({ paidOn: '2026-02-30', method: 'barter', note: 'x'.repeat(INVOICE_LIMITS.paymentNote + 1) }, { today: '2026-10-20' });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.issues.map((issue) => issue.path), ['paidOn', 'method', 'note']);
  const future = validatePayment({ paidOn: '2026-10-21', method: 'card' }, { today: '2026-10-20' });
  assert.deepEqual(future.issues, [{ path: 'paidOn', message: 'The payment date cannot be after today (2026-10-20).' }]);
  assert.equal(validatePayment(null, { today: '2026-10-20' }).ok, false);
});

test('a void needs a reason, cleaned and capped', () => {
  assert.deepEqual(validateVoidReason('  Wrong amount\n billed '), { ok: true, issues: [], value: 'Wrong amount billed' });
  assert.equal(validateVoidReason(' ').ok, false);
  assert.equal(validateVoidReason(undefined).issues[0].path, 'reason');
  assert.equal(validateVoidReason('x'.repeat(INVOICE_LIMITS.voidReason + 1)).ok, false);
});

test('an invoice is ready to issue with a line, an issuer and a due date on or after the issue date', () => {
  const settings = { issuerName: 'Example Events' };
  const value = validateInvoiceDraft(draft()).value;
  assert.deepEqual(issueProblems(value, { settings, issueDate: '2026-10-20' }), []);
  assert.deepEqual(issueProblems({ ...value, dueDate: null }, { settings, issueDate: '2026-10-20' }), []);
  assert.deepEqual(issueProblems({ ...value, dueDate: '2026-11-30' }, { settings, issueDate: '2026-11-30' }), []);
  assert.deepEqual(
    issueProblems({ ...value, lines: [], dueDate: '2026-10-19' }, { settings: { issuerName: '' }, issueDate: '2026-10-20' }).map((issue) => issue.path),
    ['lines', 'dueDate', 'settings.issuerName'],
  );
});

test('a reopen needs a reason, cleaned and capped, named for the reopen', () => {
  assert.deepEqual(validateReopenReason(' Check bounced '), { ok: true, issues: [], value: 'Check bounced' });
  const empty = validateReopenReason('');
  assert.equal(empty.ok, false);
  assert.deepEqual(empty.issues, [{ path: 'reason', message: 'Enter the reason for reopening.' }]);
  assert.equal(validateReopenReason('x'.repeat(INVOICE_LIMITS.reopenReason + 1)).ok, false);
});

test('an invoice send takes an optional copy address and an optional note, both cleaned', () => {
  assert.deepEqual(validateInvoiceSend({}, { to: 'billing@example.org' }), { ok: true, issues: [], value: { cc: null, note: '' } });
  assert.deepEqual(
    validateInvoiceSend({ cc: ' Finance@Example.org ', note: ' Thanks again.\r\n\r\n\r\nSee you soon. \u202e' }, { to: 'billing@example.org' }),
    { ok: true, issues: [], value: { cc: 'finance@example.org', note: 'Thanks again.\n\nSee you soon.' } },
  );
  // Unknown fields, such as a "to" of the caller's choosing, are dropped.
  assert.deepEqual(validateInvoiceSend({ to: 'someone@example.net', bcc: 'x@example.net' }, { to: 'billing@example.org' }).value, { cc: null, note: '' });
});

test('an invoice send refuses a bad copy address, a copy to the billing email, a header break and a long note', () => {
  const bad = validateInvoiceSend({ cc: 'not an address' }, { to: 'billing@example.org' });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.issues, [{ path: 'cc', message: 'Enter a valid email for the copy, or leave it empty.' }]);
  // Two addresses, or a line break that would start a new header, are one bad address.
  // So are angle brackets, quotes and the other characters the email core
  // refuses at its own boundary (shared/email isBareEmailAddress).
  for (const cc of ['a@example.org, b@example.org', 'a@example.org\r\nBcc: b@example.org', 'a@example.org\nb@example.org',
    'a<b@example.org', 'a@example.org>', '"a"@example.org', 'a(b)@example.org', 'a;b@example.org', 'a\\b@example.org']) {
    assert.equal(validateInvoiceSend({ cc }, { to: 'billing@example.org' }).ok, false, JSON.stringify(cc));
  }
  const same = validateInvoiceSend({ cc: 'BILLING@example.org' }, { to: 'billing@example.org' });
  assert.deepEqual(same.issues, [{ path: 'cc', message: 'The billing email already gets the invoice. Enter a different address for the copy, or leave it empty.' }]);
  const long = validateInvoiceSend({ note: 'x'.repeat(INVOICE_LIMITS.sendNote + 1) }, { to: 'billing@example.org' });
  assert.deepEqual(long.issues, [{ path: 'note', message: `Use ${INVOICE_LIMITS.sendNote} characters or fewer for the note.` }]);
  assert.equal(validateInvoiceSend('nope', { to: 'billing@example.org' }).ok, false);
});
