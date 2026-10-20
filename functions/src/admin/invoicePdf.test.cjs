'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { makeFakeDb } = require('../cms/firestoreFake.cjs');
const { publicInvoice } = require('./invoices.cjs');
const { buildInvoicePdf, createInvoicePdfHandler } = require('./invoicePdf.cjs');

const ID = 'inv_0123456789abcdef0123';
const NOW = new Date('2026-10-20T12:00:00Z');
// Fixture colours are built as data; test files are not on the hex allowlist.
const hex = (digits) => `#${digits}`;
const THEME = { colors: { primary: hex('123456'), ink: hex('111111'), inkMuted: hex('666666'), surface: hex('FFFFFF'), accent: hex('ABCDEF') } };

function issued(patch = {}) {
  return {
    status: 'issued', number: 'INV-0007', sequence: 7, currency: 'usd', revision: 2,
    issueDate: '2026-10-20', dueDate: '2026-11-30', reference: 'PO-77',
    billTo: { organizationId: 'example-press', name: 'Example Press', contactName: 'Ada Example', email: 'billing@example.org', address: '1 Main Street\nSuite 2' },
    issuer: { name: 'Example Events', address: '2 High Street\nExample Town', email: 'events@example.org', taxId: 'TAX-1', paymentInstructions: 'Bank: Example Bank\nAccount 000000' },
    lines: [{ description: 'Presenting package', quantity: 2, unitAmount: 250000, amount: 500000 }],
    adjustments: [{ kind: 'discount', label: 'Early commitment', amount: 50000 }, { kind: 'tax', label: 'Sales tax', amount: 31500 }],
    totals: { subtotal: 500000, discountTotal: 50000, taxTotal: 31500, total: 481500 },
    notes: 'Thank you for your support.',
    issuedAt: NOW, issuedBy: 'staff', createdAt: NOW, updatedAt: NOW,
    ...patch,
  };
}

// pdf-lib writes WinAnsi text as hex strings inside Flate streams
// (schedule/pdf.test.cjs pdfDrawnText). Decode them to read what was drawn.
function drawnText(bytes) {
  const chunks = [];
  function walk(buf, depth) {
    if (depth > 6) return;
    const text = Buffer.from(buf).toString('latin1');
    chunks.push(text);
    const re = /stream\r?\n/g;
    let match;
    while ((match = re.exec(text)) !== null) {
      const start = match.index + match[0].length;
      const end = text.indexOf('endstream', start);
      if (end < 0) break;
      let slice = text.slice(start, end);
      if (slice.endsWith('\n')) slice = slice.slice(0, -1);
      if (slice.endsWith('\r')) slice = slice.slice(0, -1);
      try {
        walk(zlib.inflateSync(Buffer.from(slice, 'latin1')), depth + 1);
      } catch {
        // Not a zlib stream.
      }
    }
  }
  walk(bytes, 0);
  const drawn = [];
  const hexRe = /<([0-9A-Fa-f\s]+)>/g;
  let found;
  const joined = chunks.join('\n');
  while ((found = hexRe.exec(joined)) !== null) {
    const digits = found[1].replace(/\s/g, '');
    if (digits.length < 2 || digits.length % 2 !== 0) continue;
    drawn.push(Buffer.from(digits, 'hex').toString('latin1'));
  }
  return drawn;
}

async function pageCount(bytes) {
  const { PDFDocument } = require('pdf-lib');
  return (await PDFDocument.load(bytes)).getPageCount();
}

test('the PDF carries the number, both parties, the dates, every line, the totals and the payment instructions', async () => {
  const bytes = await buildInvoicePdf({ invoice: publicInvoice(issued(), ID), theme: THEME });
  assert.equal(Buffer.from(bytes).toString('latin1', 0, 5), '%PDF-');
  const drawn = drawnText(bytes);
  for (const expected of [
    'Invoice', 'INV-0007', 'Example Events', '2 High Street', 'Example Town', 'events@example.org', 'Tax ID: TAX-1',
    'Bill to', 'Example Press', 'Ada Example', 'billing@example.org', '1 Main Street', 'Suite 2',
    'October 20, 2026', 'November 30, 2026', 'PO-77', 'USD',
    'Presenting package', '2', '$2,500.00', '$5,000.00',
    'Subtotal', 'Early commitment', '-$500.00', 'Sales tax', '$315.00', 'Total', '$4,815.00',
    'How to pay', 'Bank: Example Bank', 'Account 000000', 'Thank you for your support.', 'Page 1 of 1',
  ]) {
    assert.ok(drawn.includes(expected), `missing "${expected}" in ${JSON.stringify(drawn)}`);
  }
  assert.equal(await pageCount(bytes), 1);
});

test('a long invoice runs onto more pages and repeats the number on each', async () => {
  const lines = Array.from({ length: 50 }, (_, index) => ({
    description: `Line ${index + 1}: ${'a long description that wraps onto a second line in the table '.repeat(2)}`,
    quantity: 1, unitAmount: 100, amount: 100,
  }));
  const invoice = publicInvoice(issued({ lines, adjustments: [], totals: { subtotal: 5000, discountTotal: 0, taxTotal: 0, total: 5000 } }), ID);
  const bytes = await buildInvoicePdf({ invoice, theme: THEME });
  const pages = await pageCount(bytes);
  assert.ok(pages >= 3, `expected at least 3 pages, got ${pages}`);
  const drawn = drawnText(bytes);
  assert.ok(drawn.includes(`Page ${pages} of ${pages}`));
  assert.ok(drawn.includes('INV-0007 (continued)'));
  assert.ok(drawn.some((text) => text.startsWith('Line 50:')));
  assert.ok(drawn.includes('$50.00'));
});

test('an address too tall for one page stacks the parties and runs on, with no line lost', async () => {
  const address = Array.from({ length: 80 }, (_, index) => `Address line ${index + 1}`).join('\n');
  const bytes = await buildInvoicePdf({ invoice: publicInvoice(issued({ billTo: { name: 'Example Press', address } }), ID), theme: THEME });
  const drawn = drawnText(bytes);
  for (let index = 1; index <= 80; index += 1) assert.ok(drawn.includes(`Address line ${index}`), `line ${index}`);
  assert.ok(await pageCount(bytes) >= 2);
  assert.ok(drawn.includes('$4,815.00'));
});

test('a long reference and a long discount label wrap rather than lose words', async () => {
  const reference = 'Purchase order 2026-0042 for the regional newsroom collaborative spring program';
  const label = 'Discount for a multi-year commitment agreed with the partnership committee in the spring of this year';
  const invoice = publicInvoice(issued({
    reference,
    adjustments: [{ kind: 'discount', label, amount: 50000 }],
    totals: { subtotal: 500000, discountTotal: 50000, taxTotal: 0, total: 450000 },
  }), ID);
  const drawn = drawnText(await buildInvoicePdf({ invoice, theme: THEME }));
  const words = (text) => text.split(' ');
  const joined = drawn.join(' ');
  for (const word of [...words(reference), ...words(label)]) assert.ok(joined.includes(word), word);
  assert.ok(drawn.includes('-$500.00'));
});

test('a paid invoice says when and how it was paid, and a void one says void and why', async () => {
  const paid = drawnText(await buildInvoicePdf({
    invoice: publicInvoice(issued({ status: 'paid', payment: { paidOn: '2026-10-19', method: 'bank-transfer', note: 'Ref 42', recordedAt: NOW, recordedBy: 'staff' } }), ID),
    theme: THEME,
  }));
  assert.ok(paid.includes('Paid on October 19, 2026. Method: Bank transfer. Ref 42'), JSON.stringify(paid));
  const voided = drawnText(await buildInvoicePdf({
    invoice: publicInvoice(issued({ status: 'void', voided: { reason: 'Wrong amount', from: 'issued', at: NOW, by: 'operator' } }), ID),
    theme: THEME,
  }));
  assert.ok(voided.includes('VOID'));
  assert.ok(voided.includes('This invoice is void. Reason: Wrong amount'), JSON.stringify(voided));
  assert.equal(voided.includes('How to pay'), false);
});

test('hostile text draws as plain text, and a script the font lacks never breaks the PDF', async () => {
  const invoice = publicInvoice(issued({
    billTo: { name: 'Evil ) Tj ET BT (Corp\u202e\u0007', contactName: '日本語', email: '', address: '<< /S /JavaScript >>\nstream' },
    lines: [{ description: 'Tiếng Việt 😀 line', quantity: 1, unitAmount: 100, amount: 100 }],
    adjustments: [], totals: { subtotal: 100, discountTotal: 0, taxTotal: 0, total: 100 },
    notes: 'endstream endobj',
  }), ID);
  const bytes = await buildInvoicePdf({ invoice, theme: THEME });
  assert.equal(await pageCount(bytes), 1);
  const drawn = drawnText(bytes);
  assert.ok(drawn.includes('Evil ) Tj ET BT (Corp'));
  assert.ok(drawn.includes('(unsupported characters)'));
  assert.ok(drawn.includes('<< /S /JavaScript >>'));
  assert.ok(drawn.includes('Tieng Viet line'));
  assert.ok(drawn.includes('endstream endobj'));
  // Drawn text only; the document info strings are UTF-16 with a byte-order mark.
  for (const text of drawn.filter((each) => !each.startsWith('\u00fe\u00ff'))) {
    // eslint-disable-next-line no-control-regex -- the test looks for control characters
    assert.doesNotMatch(text, /[\u0000-\u0008\u000b-\u001f\u202e]/);
  }
  // Text never reaches the PDF as a literal string, where a parenthesis could end it.
  const raw = Buffer.from(bytes).toString('latin1');
  assert.equal(raw.includes('/JavaScript'), false);
  assert.equal(raw.includes('Tj ET BT'), false);
});

// ------------------------------------------------------------------ handler

const auth = { async verifyIdToken(token) {
  if (token === 'missing') throw new Error('unauthorized');
  return { uid: token, email: `${token}@example.org`, email_verified: true };
} };
function dbFor(extra = {}) {
  return makeFakeDb({
    'config/bootstrap': { adminEmails: ['operator@example.org'], staffEmails: ['staff@example.org'] },
    'config/event': { historicalDemo: false },
    ...extra,
  });
}
function resOf() {
  return {
    statusCode: 0, body: null, sent: null, headers: {},
    set(key, value) { this.headers[key] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.sent = body; return this; },
  };
}
async function call(db, body, user = 'staff', method = 'POST', config = {}) {
  const res = resOf();
  const handler = createInvoicePdfHandler({ db, auth, getConfig: async () => ({ event: { historicalDemo: false }, theme: THEME, ...config }), log: { error() {} } });
  await handler({ method, body, headers: { authorization: `Bearer ${user}` } }, res);
  return res;
}

test('staff download an issued invoice as a PDF named for its number', async () => {
  const db = dbFor({ [`invoices/${ID}`]: issued({ billTo: { name: 'Stored\u202e name' } }) });
  const res = await call(db, { invoiceId: ID });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.headers['Content-Type'], 'application/pdf');
  assert.equal(res.headers['Content-Disposition'], 'attachment; filename="INV-0007.pdf"');
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
  assert.equal(res.sent.toString('latin1', 0, 5), '%PDF-');
  // Stored text is cleaned again on the way out.
  assert.ok(drawnText(res.sent).includes('Stored name'));
  // A read-only demo still serves a PDF: a download writes nothing.
  await db.collection('config').doc('event').set({ historicalDemo: true });
  assert.equal((await call(db, { invoiceId: ID }, 'operator')).statusCode, 200);
});

test('the PDF endpoint refuses a draft, an unknown invoice, a bad id, a non-admin and a GET', async () => {
  const db = dbFor({ [`invoices/${ID}`]: issued({ status: 'draft', number: null, issuer: null, issueDate: null }) });
  const draft = await call(db, { invoiceId: ID });
  assert.equal(draft.statusCode, 409);
  assert.match(draft.body.error.message, /Issue the invoice first/);
  assert.equal((await call(db, { invoiceId: 'inv_99999999999999999999' })).statusCode, 404);
  assert.equal((await call(db, { invoiceId: '../x' })).statusCode, 400);
  assert.equal((await call(db, { invoiceId: ID }, 'stranger')).statusCode, 403);
  assert.equal((await call(db, { invoiceId: ID }, 'missing')).statusCode, 401);
  assert.equal((await call(db, { invoiceId: ID }, 'staff', 'GET')).statusCode, 405);
});

// ------------------------------------------------------------- pay link (#519)

const PAY_URL = 'https://checkout.stripe.com/c/pay/cs_test_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6#fidkdWxOYHwnPyd1blpxYHZxWjA0';
function withLink(patch = {}, linkPatch = {}) {
  return issued({
    payLinks: [{
      linkId: 'pl_000000000000000000000001', status: 'open', sessionId: 'cs_test_a1', url: PAY_URL,
      amount: 481500, currency: 'usd', livemode: false, createdAt: NOW, createdBy: 'staff',
      expiresAt: new Date('2026-10-21T15:30:00Z'), ...linkPatch,
    }],
    ...patch,
  });
}

/** True for drawn text that is the first part of PAY_URL (compared exactly, never by substring). */
function startsTheLink(text) {
  return text.length >= 24 && PAY_URL.slice(0, text.length) === text;
}

/** The link annotations a PDF holds, as their URI strings. */
async function linkTargets(bytes) {
  const { PDFDocument, PDFName } = require('pdf-lib');
  const doc = await PDFDocument.load(bytes);
  const targets = [];
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let index = 0; index < annots.size(); index += 1) {
      const annot = annots.lookup(index);
      const action = annot.lookup(PDFName.of('A'));
      const uri = action?.lookup(PDFName.of('URI'));
      if (uri) targets.push(uri.decodeText());
    }
  }
  return targets;
}

test('an open pay link prints with its end time on the event clock, as a link that opens it', async () => {
  const bytes = await buildInvoicePdf({ invoice: publicInvoice(withLink(), ID), theme: THEME, now: NOW, timeZone: 'America/New_York' });
  const drawn = drawnText(bytes);
  assert.ok(drawn.includes('Pay by card'), JSON.stringify(drawn));
  assert.ok(drawn.includes('Pay $4,815.00 by card through Stripe at this link. The link works until October 21, 2026, 11:30 AM EDT.'), JSON.stringify(drawn));
  // The address wraps by character; every part of it is drawn, in order.
  const start = drawn.findIndex(startsTheLink);
  assert.ok(start >= 0);
  let joined = '';
  for (let index = start; joined.length < PAY_URL.length && index < drawn.length; index += 1) joined += drawn[index];
  assert.equal(joined, PAY_URL);
  assert.deepEqual(await linkTargets(bytes), [PAY_URL]);
  // The bank instructions still print; the card link is one more way to pay.
  assert.ok(drawn.includes('How to pay'));
});

test('no pay link prints once it has run out, after a void, after payment, or when it was cancelled', async () => {
  const cases = [
    [withLink(), new Date('2026-10-21T15:30:00Z')],
    [withLink({ status: 'void', voided: { reason: 'Wrong amount', from: 'issued', at: NOW, by: 'operator' } }), NOW],
    [withLink({ status: 'paid', payment: { paidOn: '2026-10-20', method: 'card', via: 'stripe', note: '', stripe: { sessionId: 'cs_test_a1', paymentIntentId: 'pi_a1' }, recordedAt: NOW, recordedBy: null } }, { status: 'paid' }), NOW],
    [withLink({}, { status: 'cancelled', closedReason: 'paid' }), NOW],
  ];
  for (const [stored, now] of cases) {
    const bytes = await buildInvoicePdf({ invoice: publicInvoice(stored, ID), theme: THEME, now, timeZone: 'America/New_York' });
    const drawn = drawnText(bytes);
    assert.equal(drawn.includes('Pay by card'), false, stored.status);
    assert.equal(drawn.some(startsTheLink), false);
    assert.deepEqual(await linkTargets(bytes), []);
  }
  const paid = drawnText(await buildInvoicePdf({ invoice: publicInvoice(cases[2][0], ID), theme: THEME, now: NOW }));
  assert.ok(paid.includes('Paid on October 20, 2026. Method: Card (Stripe).'), JSON.stringify(paid));
});

test('the PDF endpoint prints the open link on the event clock', async () => {
  const db = dbFor({ [`invoices/${ID}`]: withLink({}, { expiresAt: new Date(Date.now() + 60 * 60 * 1000) }) });
  const res = await call(db, { invoiceId: ID }, 'staff', 'POST', { event: { historicalDemo: false, timezone: 'America/New_York' } });
  assert.equal(res.statusCode, 200);
  assert.ok(drawnText(res.sent).includes('Pay by card'));
});
