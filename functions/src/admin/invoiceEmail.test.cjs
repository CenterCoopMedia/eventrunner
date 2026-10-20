'use strict';

// Invoice email (issue #208, part 4): staff email an issued or paid
// invoice to the billing email on it, as a PDF attachment, after a preview.
// The real invoiceAdmin handler, the real email core and the real console
// provider run over the in-memory Firestore fake; the captured mail is what
// the provider received.

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeFakeDb } = require('../cms/firestoreFake.cjs');
const { createInvoiceAdminHandler } = require('./invoices.cjs');
const { createEmailCore } = require('../email/send.cjs');
const { createConsoleProvider } = require('../email/providers/console.cjs');
const { internals: { RESEND_WINDOW_MS, SENDING_STALE_MS } } = require('./invoiceEmail.cjs');

const NOW = new Date('2026-10-20T12:00:00Z');
const ID = 'inv_0123456789abcdef0123';
const SEND_ID = 'send-0001-abcdef';
const CONFIG = {
  event: {
    name: 'Example Summit',
    historicalDemo: false,
    timezone: 'America/New_York',
    sender: { email: 'events@example.org', name: 'Example Summit', replyTo: 'reply@example.org' },
    legal: { postalAddressHtml: '1 Example Street' },
  },
  providers: { email: { messageStream: 'outbound', announcementStream: 'announcements' } },
};
const auth = { async verifyIdToken(token) {
  return { uid: token, email: `${token}@example.org`, email_verified: true };
} };
const quiet = { error() {}, warn() {}, info() {}, log() {} };

function issued(patch = {}) {
  return {
    status: 'issued', number: 'INV-0001', sequence: 1, currency: 'usd',
    billTo: { organizationId: 'example-press', name: 'Example Press', contactName: 'Ada Example', email: 'billing@example.org', address: '1 Main Street' },
    reference: 'PO-77',
    lines: [{ description: 'Presenting package', quantity: 2, unitAmount: 250000, amount: 500000 }],
    adjustments: [{ kind: 'discount', label: 'Early commitment', amount: 50000 }, { kind: 'tax', label: 'Sales tax', amount: 31500 }],
    totals: { subtotal: 500000, discountTotal: 50000, taxTotal: 31500, total: 481500 },
    dueDate: '2026-11-30', notes: 'Thank you.', issueDate: '2026-10-20',
    issuer: { name: 'Example Events', address: '2 High Street', email: 'accounts@example.org', taxId: 'TAX-1', paymentInstructions: 'Account 000000.' },
    issuedAt: NOW, issuedBy: 'staff', revision: 2, listKey: `${NOW.toISOString()}|${ID}`,
    ...patch,
  };
}

function dbFor(invoice = issued(), extra = {}) {
  return makeFakeDb({
    'config/bootstrap': { adminEmails: ['operator@example.org'], staffEmails: ['staff@example.org'] },
    'config/event': { historicalDemo: false },
    [`invoices/${ID}`]: invoice,
    ...extra,
  });
}

/** The mail the console provider captured, one parsed line per message. */
function mailerFor(db, { provider, config = CONFIG } = {}) {
  const mail = [];
  const consoleProvider = provider ?? createConsoleProvider({
    env: { FUNCTIONS_EMULATOR: 'true', E2E_MAIL_FILE: '/captured-mail.jsonl' },
    log: quiet,
    appendFileSync: (_path, line) => mail.push(JSON.parse(line)),
  });
  const core = createEmailCore({ db, provider: consoleProvider, getConfig: async () => config, log: quiet });
  return { mail, getMailer: () => ({ provider: consoleProvider, send: core.send }) };
}

function resOf() {
  return { statusCode: 0, body: null, headers: {}, set(key, value) { this.headers[key] = value; return this; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

let clock = 0;
let fixedNow = null;
const now = () => fixedNow ?? new Date(NOW.getTime() + (clock += 1000));

async function call(db, body, { user = 'staff', mailer = mailerFor(db), config = CONFIG } = {}) {
  const res = resOf();
  const handler = createInvoiceAdminHandler({
    db, auth, getConfig: async () => config, now, log: quiet, getMailer: mailer.getMailer,
  });
  await handler({ method: 'POST', body, headers: { authorization: `Bearer ${user}` } }, res);
  return res;
}

async function previewAndSend(db, mailer, extra = {}, previewExtra = {}) {
  const preview = await call(db, { action: 'previewSend', invoiceId: ID, ...previewExtra }, { mailer });
  assert.equal(preview.statusCode, 200, JSON.stringify(preview.body));
  const sent = await call(db, {
    action: 'send', invoiceId: ID, sendId: SEND_ID, receipt: preview.body.receipt, ...previewExtra, ...extra,
  }, { mailer });
  return { preview, sent };
}

function audits(db) {
  return db.ids('admin_logs').map((id) => db.read('admin_logs', id));
}

test.beforeEach(() => { fixedNow = null; });

test('staff preview the email, then send it with the PDF attached to the billing email', async () => {
  const db = dbFor();
  const mailer = mailerFor(db);
  const note = 'Thanks for your support.\nSee you in March.';
  const { preview, sent } = await previewAndSend(db, mailer, {}, { cc: 'Finance@Example.org', note });

  const shown = preview.body.preview;
  assert.equal(shown.to, 'billing@example.org');
  assert.equal(shown.cc, 'finance@example.org');
  assert.equal(shown.replyTo, 'accounts@example.org');
  assert.equal(shown.subject, 'Invoice INV-0001 from Example Events');
  assert.equal(shown.filename, 'INV-0001.pdf');
  for (const words of ['Hello Ada Example,', 'Invoice INV-0001 for $4,815.00 is attached as a PDF.', 'Payment is due by November 30, 2026.', 'Thanks for your support.\nSee you in March.', '1 Example Street']) {
    assert.ok(shown.text.includes(words), `the preview text says "${words}"`);
  }
  assert.ok(shown.html.includes('Thanks for your support.'));
  assert.match(preview.body.receipt, /^[0-9a-f]{64}$/);
  assert.equal(preview.body.canSend, true);
  assert.equal(preview.body.recentSend, null);

  assert.equal(sent.statusCode, 200, JSON.stringify(sent.body));
  assert.equal(sent.body.outcome, 'sent');
  assert.equal(mailer.mail.length, 1);
  const [mail] = mailer.mail;
  assert.equal(mail.to, 'billing@example.org');
  assert.equal(mail.cc, 'finance@example.org');
  assert.equal(mail.replyTo, 'accounts@example.org');
  assert.equal(mail.tag, 'invoice.send');
  assert.equal(mail.subject, shown.subject);
  assert.equal(mail.text, shown.text);
  assert.equal(mail.html, shown.html);
  // The transactional stream, never the announcement stream.
  assert.equal(mail.messageStream, 'outbound');
  assert.equal(mail.attachments.length, 1);
  assert.equal(mail.attachments[0].filename, 'INV-0001.pdf');
  assert.equal(mail.attachments[0].contentType, 'application/pdf');
  assert.equal(Buffer.from(mail.attachments[0].content, 'base64').subarray(0, 5).toString('latin1'), '%PDF-');

  // The send is on the invoice: who, when, to, the copy and the message id.
  const stored = db.read('invoices', ID);
  assert.equal(stored.revision, 2, 'a send does not change the invoice revision');
  assert.equal(stored.sends.length, 1);
  assert.equal(stored.sends[0].sendId, SEND_ID);
  assert.equal(stored.sends[0].status, 'sent');
  assert.equal(stored.sends[0].to, 'billing@example.org');
  assert.equal(stored.sends[0].cc, 'finance@example.org');
  assert.equal(stored.sends[0].by, 'staff');
  assert.match(stored.sends[0].providerMessageId, /^console-/);
  assert.ok(stored.sends[0].sentAt instanceof Date);
  assert.deepEqual(sent.body.invoice.emailSends.map((row) => [row.status, row.to, row.cc]), [['sent', 'billing@example.org', 'finance@example.org']]);

  // One audit row, with no address and no note text in it.
  const rows = audits(db).filter((row) => row.action.startsWith('invoices.email'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, 'invoices.emailed');
  assert.equal(rows[0].invoiceId, ID);
  assert.equal(rows[0].actorUid, 'staff');
  assert.deepEqual(rows[0].details, {
    sendId: SEND_ID, number: 'INV-0001', status: 'sent', providerMessageId: stored.sends[0].providerMessageId, copy: true, note: true, resend: false,
  });
  assert.equal(JSON.stringify(rows[0]).includes('example.org'), false);

  // The email log keeps the file's name and size, never its content.
  const logged = db.ids('sent_emails').map((id) => db.read('sent_emails', id));
  assert.equal(logged.length, 1);
  assert.equal(logged[0].attachments[0].filename, 'INV-0001.pdf');
  assert.equal(JSON.stringify(logged[0]).includes(mail.attachments[0].content), false);
});

test('the record of a send and its audit row are written in one transaction', async () => {
  const db = dbFor();
  const mailer = mailerFor(db);
  const groups = [];
  const run = db.runTransaction.bind(db);
  db.runTransaction = async (fn, options) => {
    const before = db.writes.length;
    const result = await run(fn, options);
    groups.push(db.writes.slice(before).map((write) => write.path.split('/')[0]));
    return result;
  };
  const { sent } = await previewAndSend(db, mailer);
  assert.equal(sent.statusCode, 200);
  assert.ok(groups.some((paths) => paths.includes('invoices') && paths.includes('admin_logs')), JSON.stringify(groups));
});

test('a paid invoice can be sent, and the email says it is paid', async () => {
  const db = dbFor(issued({ status: 'paid', payment: { paidOn: '2026-10-19', method: 'check', note: '', recordedAt: NOW, recordedBy: 'staff' } }));
  const mailer = mailerFor(db);
  const { preview, sent } = await previewAndSend(db, mailer);
  assert.ok(preview.body.preview.text.includes('It was paid on October 19, 2026. This copy is for your records.'));
  assert.equal(sent.statusCode, 200);
  assert.equal(mailer.mail.length, 1);
});

test('a draft, a void invoice and an invoice with no billing email are refused, and nothing is sent', async () => {
  for (const [invoice, words] of [
    [issued({ status: 'draft', number: null }), /Issue the invoice first/],
    [issued({ status: 'void', voided: { reason: 'Wrong', from: 'issued', at: NOW, by: 'operator' } }), /void invoice is not sent/],
    [issued({ billTo: { ...issued().billTo, email: '' } }), /no billing email/],
    [issued({ billTo: { ...issued().billTo, email: 'not an address' } }), /no billing email/],
  ]) {
    const db = dbFor(invoice);
    const mailer = mailerFor(db);
    const preview = await call(db, { action: 'previewSend', invoiceId: ID }, { mailer });
    assert.equal(preview.statusCode, 409);
    assert.match(preview.body.error.message, words);
    const sent = await call(db, { action: 'send', invoiceId: ID, sendId: SEND_ID, receipt: 'a'.repeat(64) }, { mailer });
    assert.equal(sent.statusCode, 409);
    assert.match(sent.body.error.message, words);
    assert.equal(mailer.mail.length, 0);
    assert.equal(db.read('invoices', ID).sends, undefined);
  }
});

test('a bad copy address, a copy to the billing email and a long note are refused by field', async () => {
  const db = dbFor();
  const mailer = mailerFor(db);
  for (const [extra, field] of [
    [{ cc: 'a@example.org, b@example.org' }, 'cc'],
    [{ cc: 'a@example.org\r\nBcc: b@example.org' }, 'cc'],
    [{ cc: 'billing@example.org' }, 'cc'],
    [{ note: 'x'.repeat(1001) }, 'note'],
  ]) {
    for (const action of ['previewSend', 'send']) {
      const res = await call(db, { action, invoiceId: ID, sendId: SEND_ID, receipt: 'a'.repeat(64), ...extra }, { mailer });
      assert.equal(res.statusCode, 400, `${action} ${JSON.stringify(extra)}`);
      assert.match(res.body.error.message, new RegExp(`^Invalid email: ${field}:`));
    }
  }
  assert.equal(mailer.mail.length, 0);
});

test('a request cannot choose the recipient: a "to" or "bcc" in the body is ignored', async () => {
  const db = dbFor();
  const mailer = mailerFor(db);
  const { sent } = await previewAndSend(db, mailer, { to: 'someone@example.net', bcc: 'other@example.net' }, { to: 'someone@example.net' });
  assert.equal(sent.statusCode, 200);
  assert.equal(mailer.mail[0].to, 'billing@example.org');
  assert.equal(JSON.stringify(mailer.mail[0]).includes('example.net'), false);
});

test('a read-only demo refuses the send and writes nothing', async () => {
  const db = dbFor(issued(), { 'config/event': { historicalDemo: true } });
  const mailer = mailerFor(db);
  const res = await call(db, { action: 'send', invoiceId: ID, sendId: SEND_ID, receipt: 'a'.repeat(64) }, { mailer });
  assert.equal(res.statusCode, 403);
  assert.equal(mailer.mail.length, 0);
  assert.equal(db.read('invoices', ID).sends, undefined);
  assert.equal(audits(db).length, 0);
});

test('a provider that cannot carry an attachment is refused before anything is recorded', async () => {
  const db = dbFor();
  let requests = 0;
  const mailer = mailerFor(db, { provider: { name: 'webhook', send: async () => { requests += 1; return { status: 'sent' }; } } });
  const preview = await call(db, { action: 'previewSend', invoiceId: ID }, { mailer });
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.body.canSend, false);
  assert.match(preview.body.cannotSendReason, /cannot send attachments/);
  const sent = await call(db, { action: 'send', invoiceId: ID, sendId: SEND_ID, receipt: preview.body.receipt }, { mailer });
  assert.equal(sent.statusCode, 409);
  assert.equal(sent.body.error.code, 'attachments-unsupported');
  assert.equal(requests, 0);
  assert.equal(db.read('invoices', ID).sends, undefined);
  assert.equal(db.ids('email_claims').length, 0);
});

test('an email provider that is not set up is stated, not thrown', async () => {
  const db = dbFor();
  const mailer = { getMailer: () => { throw new Error('EVENT_EMAIL_PROVIDER is not set.'); } };
  const preview = await call(db, { action: 'previewSend', invoiceId: ID }, { mailer });
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.body.canSend, false);
  const sent = await call(db, { action: 'send', invoiceId: ID, sendId: SEND_ID, receipt: preview.body.receipt }, { mailer });
  assert.equal(sent.statusCode, 503);
  assert.equal(sent.body.error.code, 'email-unavailable');
});

test('a transactional stream set to the announcement stream is refused', async () => {
  const config = { ...CONFIG, providers: { email: { messageStream: 'announcements', announcementStream: 'announcements' } } };
  const db = dbFor();
  const mailer = mailerFor(db, { config });
  const preview = await call(db, { action: 'previewSend', invoiceId: ID }, { mailer, config });
  assert.equal(preview.body.canSend, false);
  assert.match(preview.body.cannotSendReason, /announcement stream/);
  const sent = await call(db, { action: 'send', invoiceId: ID, sendId: SEND_ID, receipt: preview.body.receipt }, { mailer, config });
  assert.equal(sent.statusCode, 409);
  assert.equal(sent.body.error.code, 'stream-misconfigured');
  assert.equal(mailer.mail.length, 0);
  // With no stream set, Postmark's default transactional stream is used, and
  // an announcement stream with that name is refused too.
  const unset = { ...CONFIG, providers: { email: { announcementStream: 'outbound' } } };
  const again = await call(db, { action: 'previewSend', invoiceId: ID }, { mailer: mailerFor(db, { config: unset }), config: unset });
  assert.equal(again.body.canSend, false);
});

test('a send whose preview is out of date is refused', async () => {
  const db = dbFor();
  const mailer = mailerFor(db);
  const preview = await call(db, { action: 'previewSend', invoiceId: ID, note: 'One' }, { mailer });
  // The note changed after the preview.
  const changedNote = await call(db, { action: 'send', invoiceId: ID, sendId: SEND_ID, receipt: preview.body.receipt, note: 'Two' }, { mailer });
  assert.equal(changedNote.statusCode, 409);
  assert.equal(changedNote.body.error.code, 'stale-preview');
  // The invoice was marked paid after the preview.
  await db.collection('invoices').doc(ID).set(issued({ status: 'paid', revision: 3, payment: { paidOn: '2026-10-19', method: 'check', note: '' } }));
  const changedInvoice = await call(db, { action: 'send', invoiceId: ID, sendId: SEND_ID, receipt: preview.body.receipt, note: 'One' }, { mailer });
  assert.equal(changedInvoice.statusCode, 409);
  assert.equal(changedInvoice.body.error.code, 'stale-preview');
  for (const receipt of [undefined, 'nope']) {
    assert.equal((await call(db, { action: 'send', invoiceId: ID, sendId: SEND_ID, receipt }, { mailer })).statusCode, 400);
  }
  assert.equal((await call(db, { action: 'send', invoiceId: ID, sendId: 'x', receipt: preview.body.receipt, note: 'One' }, { mailer })).statusCode, 400);
  assert.equal(mailer.mail.length, 0);
});

test('a repeat of the same send never sends twice', async () => {
  const db = dbFor();
  const mailer = mailerFor(db);
  const { preview, sent } = await previewAndSend(db, mailer);
  assert.equal(sent.body.outcome, 'sent');
  const again = await call(db, { action: 'send', invoiceId: ID, sendId: SEND_ID, receipt: preview.body.receipt }, { mailer });
  assert.equal(again.statusCode, 200);
  assert.equal(again.body.outcome, 'sent');
  assert.equal(again.body.repeated, true);
  assert.equal(mailer.mail.length, 1);
  assert.equal(db.read('invoices', ID).sends.length, 1);
});

test('a second send to the same address within the window needs a confirmation', async () => {
  const db = dbFor();
  const mailer = mailerFor(db);
  await previewAndSend(db, mailer);
  const preview = await call(db, { action: 'previewSend', invoiceId: ID }, { mailer });
  assert.equal(preview.body.recentSend.to, 'billing@example.org');
  assert.equal(preview.body.resendWindowMinutes, RESEND_WINDOW_MS / 60000);
  const refused = await call(db, { action: 'send', invoiceId: ID, sendId: 'send-0002-abcdef', receipt: preview.body.receipt }, { mailer });
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.body.error.code, 'recent-send');
  assert.match(refused.body.error.message, /INV-0001 was emailed to billing@example\.org less than 15 minutes ago/);
  assert.equal(mailer.mail.length, 1);

  // A copy to an address that got the last one counts too.
  const ccPreview = await call(db, { action: 'previewSend', invoiceId: ID, cc: 'finance@example.org' }, { mailer });
  const ccRefused = await call(db, { action: 'send', invoiceId: ID, sendId: 'send-0003-abcdef', receipt: ccPreview.body.receipt, cc: 'finance@example.org' }, { mailer });
  assert.equal(ccRefused.body.error.code, 'recent-send');

  const confirmed = await call(db, { action: 'send', invoiceId: ID, sendId: 'send-0004-abcdef', receipt: preview.body.receipt, confirmResend: true }, { mailer });
  assert.equal(confirmed.statusCode, 200);
  assert.equal(mailer.mail.length, 2);
  const rows = audits(db).filter((row) => row.action === 'invoices.emailed');
  assert.deepEqual(rows.map((row) => row.details.resend).sort(), [false, true]);
});

test('after the window a send goes without a confirmation', async () => {
  const db = dbFor();
  const mailer = mailerFor(db);
  fixedNow = NOW;
  await previewAndSend(db, mailer);
  fixedNow = new Date(NOW.getTime() + RESEND_WINDOW_MS + 1000);
  const preview = await call(db, { action: 'previewSend', invoiceId: ID }, { mailer });
  assert.equal(preview.body.recentSend, null);
  const sent = await call(db, { action: 'send', invoiceId: ID, sendId: 'send-0002-abcdef', receipt: preview.body.receipt }, { mailer });
  assert.equal(sent.statusCode, 200);
  assert.equal(mailer.mail.length, 2);
});

test('a send in progress blocks another, even a confirmed one; a stale one is settled by the email claim', async () => {
  const db = dbFor(issued({
    sends: [{ sendId: 'send-old-000001', status: 'sending', to: 'billing@example.org', cc: null, by: 'staff', at: NOW, note: false, resend: false }],
  }));
  const mailer = mailerFor(db);
  fixedNow = new Date(NOW.getTime() + 1000);
  const preview = await call(db, { action: 'previewSend', invoiceId: ID }, { mailer });
  const busy = await call(db, { action: 'send', invoiceId: ID, sendId: SEND_ID, receipt: preview.body.receipt, confirmResend: true }, { mailer });
  assert.equal(busy.statusCode, 409);
  assert.equal(busy.body.error.code, 'in-progress');
  assert.equal(mailer.mail.length, 0);

  // Past the stale limit with no claim: the old send never reached the
  // provider, so it is settled as failed and the new one goes.
  fixedNow = new Date(NOW.getTime() + SENDING_STALE_MS + 1000);
  const sent = await call(db, { action: 'send', invoiceId: ID, sendId: SEND_ID, receipt: preview.body.receipt }, { mailer });
  assert.equal(sent.statusCode, 200, JSON.stringify(sent.body));
  const sends = db.read('invoices', ID).sends;
  assert.deepEqual(sends.map((row) => [row.sendId, row.status]), [['send-old-000001', 'failed'], [SEND_ID, 'sent']]);
});

test('a provider refusal is recorded as failed and does not count as a send', async () => {
  const db = dbFor();
  let calls = 0;
  const provider = {
    name: 'postmark',
    capabilities: { attachments: true, cc: true },
    send: async () => {
      calls += 1;
      return calls === 1
        ? { providerMessageId: null, status: 'failed', providerStatus: 422, error: "Invalid 'To' address: 'billing@example.org'." }
        : { providerMessageId: 'pm-2', status: 'sent', providerStatus: 200 };
    },
  };
  const mailer = mailerFor(db, { provider });
  const { preview, sent } = await previewAndSend(db, mailer);
  assert.equal(sent.statusCode, 502);
  assert.equal(sent.body.error.code, 'send-failed');
  const stored = db.read('invoices', ID).sends[0];
  assert.equal(stored.status, 'failed');
  assert.equal(stored.providerStatus, 422);
  // The provider's words can hold the address; they stay out of the invoice and the audit row.
  assert.equal(JSON.stringify(stored).includes('Invalid'), false);
  const row = audits(db).find((entry) => entry.action === 'invoices.email-failed');
  assert.equal(JSON.stringify(row).includes('example.org'), false);
  // A failed send leaves no window: the next one goes without a confirmation.
  const again = await call(db, { action: 'send', invoiceId: ID, sendId: 'send-0002-abcdef', receipt: preview.body.receipt }, { mailer });
  assert.equal(again.statusCode, 200);
  assert.equal(again.body.outcome, 'sent');
});

test('a provider that throws leaves the send uncertain, and the window applies', async () => {
  const db = dbFor();
  const provider = { name: 'postmark', capabilities: { attachments: true, cc: true }, send: async () => { throw new Error('socket hang up'); } };
  const mailer = mailerFor(db, { provider });
  const { preview, sent } = await previewAndSend(db, mailer);
  assert.equal(sent.statusCode, 200);
  assert.equal(sent.body.outcome, 'uncertain');
  assert.equal(db.read('invoices', ID).sends[0].status, 'uncertain');
  const again = await call(db, { action: 'send', invoiceId: ID, sendId: 'send-0002-abcdef', receipt: preview.body.receipt }, { mailer });
  assert.equal(again.body.error.code, 'recent-send');
});

test('names and notes cannot add a header or markup', async () => {
  const db = dbFor(issued({
    issuer: { ...issued().issuer, name: 'Example\r\nBcc: thief@example.net Events' },
    billTo: { ...issued().billTo, contactName: '<b>Ada</b>\r\nX-Evil: 1' },
  }));
  const mailer = mailerFor(db);
  const { preview, sent } = await previewAndSend(db, mailer, {}, { note: '<script>alert(1)</script>\r\nBcc: thief@example.net' });
  assert.equal(sent.statusCode, 200);
  const [mail] = mailer.mail;
  assert.equal(/[\r\n]/.test(mail.subject), false);
  assert.equal(mail.subject, 'Invoice INV-0001 from Example Bcc: thief@example.net Events');
  assert.equal(mail.to, 'billing@example.org');
  assert.equal(mail.cc, undefined);
  assert.equal(mail.bcc, undefined);
  assert.equal(mail.headers, undefined);
  assert.equal(mail.html.includes('<script>'), false);
  assert.equal(mail.html.includes('<b>Ada</b>'), false);
  assert.ok(mail.html.includes('&lt;script&gt;'));
  assert.equal(preview.body.preview.subject, mail.subject);
});
