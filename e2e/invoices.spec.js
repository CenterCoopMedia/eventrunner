// Invoices (issues #208, #209), on the real surface: the draft flow, then
// issue and what follows.
//
// The done line is "an invoice is saved, reopened, and its totals
// recomputed correctly". It crosses the form, the shared arithmetic, the
// invoiceAdmin endpoint, the rules and the audit trail, so only the
// emulators prove it. The seeded operator signs in through the real
// sign-in page, picks an organization whose tier names a sponsor package,
// edits the line the package filled, saves, reloads the page, and finds the
// same figures. The stored record and its admin_logs row are read back with
// the Admin SDK. A request that sends its own totals is answered with the
// totals the server computed, and staff cannot change the invoice settings.
//
// Issue and after (#209), in the second block: the operator issues a draft
// from its page and it takes INV-0001, downloads its PDF, marks it paid,
// reopens it after a bounced check (the payment kept), marks it paid again
// and voids it. The number stays used: a copy of the void invoice is issued as
// INV-0002, and two drafts issued at the same moment take the next two
// numbers. The records, the counter and admin_logs are read back.
//
// Email (part 4): staff email an issued invoice from its page after a
// preview. The console email provider writes the mail to the captured inbox,
// and the test reads it there with its PDF attachment, then finds the send on
// the invoice and in admin_logs. A second send to the same address minutes
// later needs a confirmation, and a void invoice or a draft is refused.
//
// Card payment links (part 5, #519): this suite runs the manual ticketing
// provider, so there is no Stripe. The record says card links need Stripe and
// the server refuses to make one. A link written the way the server writes
// it then shows on the record, prints on the PDF and goes in the email; a
// void closes it, and says Stripe was not told. A card payment flagged for
// review shows in the list and on the record, and an operator closes it with
// a note. Stripe itself is never called: its own flow is covered by
// functions/src/admin/invoicePayLink.test.cjs with signed fixture events.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { test, expect } from '@playwright/test';
import {
  ADMIN_EMAIL, adminDb, callFunction, ensureUser, idTokenFor, mailFileSize, signIn, taggedMailSince, waitForTaggedMail,
} from './helpers.mjs';

const STAFF_EMAIL = 'e2e-invoice-staff@example.test';
const ORG_ID = 'e2e-invoice-sponsor';
const PACKAGE_ID = 'e2e-invoice-package';

async function clearInvoices() {
  const db = adminDb();
  const left = await db.collection('invoices').get();
  await Promise.all(left.docs.map((doc) => doc.ref.delete()));
  await db.collection('invoice_counters').doc('current').delete();
}

/** The text a pdf-lib PDF draws: hex strings inside Flate streams. */
function pdfText(bytes) {
  const raw = Buffer.from(bytes).toString('latin1');
  const chunks = [raw];
  const re = /stream\r?\n/g;
  let match;
  while ((match = re.exec(raw)) !== null) {
    const start = match.index + match[0].length;
    const end = raw.indexOf('endstream', start);
    try {
      chunks.push(inflateSync(Buffer.from(raw.slice(start, end).replace(/\r?\n$/, ''), 'latin1')).toString('latin1'));
    } catch {
      // Not a zlib stream.
    }
  }
  return [...chunks.join('\n').matchAll(/<([0-9A-Fa-f]+)>/g)]
    .map(([, digits]) => Buffer.from(digits, 'hex').toString('latin1'))
    .join('\n');
}

test.describe.serial('invoice drafts', () => {
  let page;
  let seededBootstrap;
  let invoiceId;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    const db = adminDb();
    await clearInvoices();
    seededBootstrap = (await db.collection('config').doc('bootstrap').get()).data();
    await db.collection('config').doc('bootstrap').set({
      ...seededBootstrap,
      staffEmails: [...(seededBootstrap.staffEmails ?? []), STAFF_EMAIL],
    });
    await db.collection('cmsOrganizations').doc(ORG_ID).set({
      name: 'Example Invoice Sponsor', tier: 'Presenting', order: 999, visible: true,
    });
    await db.collection('cmsContent').doc(PACKAGE_ID).set({
      page: 'sponsors', section: 'packages', field: PACKAGE_ID, blockType: 'sponsor_package',
      values: { name: 'Presenting', price: '$5,000' }, order: 999, visible: true,
    });
    page = await (await browser.newContext()).newPage();
    await signIn(page, ADMIN_EMAIL);
  });

  test.afterAll(async () => {
    await page?.context().close();
    const db = adminDb();
    await clearInvoices();
    await db.collection('cmsOrganizations').doc(ORG_ID).delete();
    await db.collection('cmsContent').doc(PACKAGE_ID).delete();
    if (seededBootstrap) await db.collection('config').doc('bootstrap').set(seededBootstrap);
  });

  test('a draft is saved, reopened, and its totals recomputed', async () => {
    await page.goto('/admin/invoices');
    await expect(page.getByRole('heading', { level: 1, name: 'Invoices' })).toBeVisible();
    await page.getByRole('link', { name: 'New invoice' }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'New invoice' })).toBeVisible();

    await page.getByLabel('Organization', { exact: true }).selectOption(ORG_ID);
    await expect(page.getByLabel('Name to bill')).toHaveValue('Example Invoice Sponsor');
    await expect(page.getByLabel('Line 1 unit price')).toHaveValue('5000.00');
    const total = page.getByTestId('invoice-total');
    await expect(total).toHaveText(/Total: \$5,000\.00/);

    await page.getByLabel('Line 1 quantity').fill('3');
    await page.getByRole('button', { name: 'Add a discount' }).click();
    await expect(page.getByLabel('Discount row 1 kind')).toBeFocused();
    await page.getByLabel('Discount row 1 label').fill('Early commitment');
    await page.getByLabel('Discount row 1 amount').fill('1,000.10');
    await expect(total).toHaveText(/Total: \$13,999\.90/);

    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Draft saved.' })).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/invoices\/inv_[a-z0-9]+$/);
    invoiceId = page.url().split('/').pop();

    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Draft for Example Invoice Sponsor' })).toBeVisible();
    await expect(page.getByLabel('Line 1 quantity')).toHaveValue('3');
    await expect(page.getByLabel('Discount row 1 amount')).toHaveValue('1000.10');
    await expect(page.getByTestId('invoice-total')).toHaveText(/Total: \$13,999\.90/);

    const stored = (await adminDb().collection('invoices').doc(invoiceId).get()).data();
    expect(stored.status).toBe('draft');
    expect(stored.number).toBeNull();
    expect(stored.currency).toMatch(/^[a-z]{3}$/);
    expect(stored.totals).toEqual({ subtotal: 1500000, discountTotal: 100010, taxTotal: 0, total: 1399990 });
    const logs = await adminDb().collection('admin_logs').where('invoiceId', '==', invoiceId).get();
    expect(logs.docs.map((doc) => doc.data().action)).toEqual(['invoices.draft-created']);

    await page.goto('/admin/invoices');
    await expect(page.getByRole('link', { name: 'Draft for Example Invoice Sponsor' })).toBeVisible();
  });

  test('the server ignores totals a request sends, and staff cannot change settings', async () => {
    const operatorToken = await idTokenFor(await ensureUser(ADMIN_EMAIL));
    const current = (await adminDb().collection('invoices').doc(invoiceId).get()).data();
    const tampered = await callFunction('invoiceAdmin', {
      action: 'saveDraft', invoiceId, expectedRevision: current.revision,
      invoice: {
        billTo: { name: 'Example Invoice Sponsor' },
        lines: [{ description: 'Presenting', quantity: 1, unitAmount: 500000 }],
        totals: { subtotal: 1, discountTotal: 0, taxTotal: 0, total: 1 },
        status: 'paid', number: 'INV-9999',
      },
    }, operatorToken);
    expect(tampered.status).toBe(200);
    expect(tampered.body.invoice.totals.total).toBe(500000);
    expect(tampered.body.invoice.status).toBe('draft');
    expect(tampered.body.invoice.number).toBeNull();

    const stale = await callFunction('invoiceAdmin', {
      action: 'saveDraft', invoiceId, expectedRevision: current.revision, invoice: { billTo: { name: 'Late' } },
    }, operatorToken);
    expect(stale.status).toBe(409);

    const staffToken = await idTokenFor(await ensureUser(STAFF_EMAIL));
    const refused = await callFunction('invoiceAdmin', { action: 'saveSettings', expectedRevision: 0, settings: { prefix: 'X' } }, staffToken);
    expect(refused.status).toBe(403);
    expect((await callFunction('invoiceAdmin', { action: 'list' }, staffToken)).status).toBe(200);
  });

  test('a draft is deleted from the editor', async () => {
    await page.goto(`/admin/invoices/${invoiceId}`);
    await page.getByRole('button', { name: 'Delete this draft' }).click();
    await page.getByRole('button', { name: 'Delete this draft' }).click();
    await expect(page).toHaveURL(/\/admin\/invoices$/);
    expect((await adminDb().collection('invoices').doc(invoiceId).get()).exists).toBe(false);
  });
});

test.describe.serial('issued invoices', () => {
  const SETTINGS = {
    prefix: 'INV', currency: '', issuerName: 'Example Invoice Issuer', issuerAddress: '2 High Street',
    issuerEmail: 'billing@example.test', taxId: 'TAX-1', paymentInstructions: 'Pay to account 000000.', revision: 1,
  };
  const DRAFT = {
    billTo: { name: 'Example Invoice Sponsor', email: 'sponsor@example.test' },
    lines: [{ description: 'Presenting package', quantity: 2, unitAmount: 250000 }],
    adjustments: [{ kind: 'discount', label: 'Early commitment', amount: 50000 }],
    dueDate: '2099-12-31',
  };
  const FIRST = 'inv_e2eissue00000000000001';
  let page;
  let seededBootstrap;
  let operatorToken;
  let staffToken;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    const db = adminDb();
    await clearInvoices();
    seededBootstrap = (await db.collection('config').doc('bootstrap').get()).data();
    await db.collection('config').doc('bootstrap').set({
      ...seededBootstrap,
      staffEmails: [...(seededBootstrap.staffEmails ?? []), STAFF_EMAIL],
    });
    await db.collection('invoice_settings').doc('current').set(SETTINGS);
    operatorToken = await idTokenFor(await ensureUser(ADMIN_EMAIL));
    staffToken = await idTokenFor(await ensureUser(STAFF_EMAIL));
    const saved = await callFunction('invoiceAdmin', { action: 'saveDraft', invoiceId: FIRST, expectedRevision: 0, invoice: DRAFT }, staffToken);
    expect(saved.status).toBe(200);
    page = await (await browser.newContext({ acceptDownloads: true })).newPage();
    await signIn(page, ADMIN_EMAIL);
  });

  test.afterAll(async () => {
    await page?.context().close();
    const db = adminDb();
    await clearInvoices();
    await db.collection('invoice_settings').doc('current').delete();
    if (seededBootstrap) await db.collection('config').doc('bootstrap').set(seededBootstrap);
  });

  test('a draft is issued as INV-0001, downloaded, marked paid, reopened, paid again and voided', async () => {
    await page.goto(`/admin/invoices/${FIRST}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Draft for Example Invoice Sponsor' })).toBeVisible();
    await page.getByRole('button', { name: 'Issue invoice' }).click();
    await expect(page.getByText(/The next number is INV-0001\./)).toBeVisible();
    await page.getByRole('button', { name: 'Issue this invoice' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'INV-0001' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Issued as INV-0001.' })).toBeVisible();
    await expect(page.getByLabel('Name to bill')).toBeDisabled();

    const issued = (await adminDb().collection('invoices').doc(FIRST).get()).data();
    expect(issued.status).toBe('issued');
    expect(issued.number).toBe('INV-0001');
    expect(issued.totals.total).toBe(450000);
    expect(issued.issuer.name).toBe('Example Invoice Issuer');
    expect((await adminDb().collection('invoice_counters').doc('current').get()).data().lastNumber).toBe(1);

    // Later settings edits do not reach the issued invoice or its PDF.
    await adminDb().collection('invoice_settings').doc('current').set({ ...SETTINGS, issuerName: 'Renamed Issuer', revision: 2 });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download PDF' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('INV-0001.pdf');
    const bytes = readFileSync(await download.path());
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const drawn = pdfText(bytes);
    for (const text of ['INV-0001', 'Example Invoice Issuer', 'Example Invoice Sponsor', 'Presenting package', '$4,500.00', 'Pay to account 000000.']) {
      expect(drawn).toContain(text);
    }
    expect(drawn).not.toContain('Renamed Issuer');

    await page.getByRole('button', { name: 'Mark paid' }).click();
    await page.getByLabel('Method').selectOption('check');
    await page.getByLabel('Payment note').fill('Check 1042');
    await page.getByRole('button', { name: 'Record payment' }).click();
    await expect(page.locator('[data-invoice-status="paid"]')).toBeVisible();
    const paid = (await adminDb().collection('invoices').doc(FIRST).get()).data();
    expect(paid.status).toBe('paid');
    expect(paid.payment).toMatchObject({ method: 'check', note: 'Check 1042' });
    expect(paid.payment.paidOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // The check bounces. Only an operator reopens, and the payment is kept.
    const staffReopen = await callFunction('invoiceAdmin', { action: 'reopen', invoiceId: FIRST, expectedRevision: paid.revision, reason: 'x' }, staffToken);
    expect(staffReopen.status).toBe(403);
    await page.getByRole('button', { name: 'Reopen this invoice' }).click();
    await page.getByLabel('Reason for reopening').fill('Check bounced');
    await page.getByRole('button', { name: 'Reopen INV-0001' }).click();
    await expect(page.locator('[data-invoice-status="issued"]')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Earlier payments' })).toContainText('Reopened: Check bounced');
    const reopened = (await adminDb().collection('invoices').doc(FIRST).get()).data();
    expect(reopened.status).toBe('issued');
    expect(reopened.payment).toBeNull();
    expect(reopened.paymentHistory).toHaveLength(1);
    expect(reopened.paymentHistory[0]).toMatchObject({ method: 'check', note: 'Check 1042', reason: 'Check bounced' });

    await page.getByRole('button', { name: 'Mark paid' }).click();
    await page.getByLabel('Method').selectOption('bank-transfer');
    await page.getByRole('button', { name: 'Record payment' }).click();
    await expect(page.locator('[data-invoice-status="paid"]')).toBeVisible();
    const repaid = (await adminDb().collection('invoices').doc(FIRST).get()).data();

    // Only an operator voids: staff are refused by the server.
    const refused = await callFunction('invoiceAdmin', { action: 'void', invoiceId: FIRST, expectedRevision: repaid.revision, reason: 'x' }, staffToken);
    expect(refused.status).toBe(403);

    await page.getByRole('button', { name: 'Void this invoice' }).click();
    await page.getByLabel('Reason').fill('Wrong amount');
    await page.getByRole('button', { name: 'Void INV-0001' }).click();
    await expect(page.locator('[data-invoice-status="void"]')).toBeVisible();
    await expect(page.getByText(/INV-0001 stays used/)).toBeVisible();
    const voided = (await adminDb().collection('invoices').doc(FIRST).get()).data();
    expect(voided.status).toBe('void');
    expect(voided.number).toBe('INV-0001');
    expect(voided.voided.reason).toBe('Wrong amount');
    expect(voided.payment.method).toBe('bank-transfer');
    expect(voided.paymentHistory).toHaveLength(1);

    const logs = await adminDb().collection('admin_logs').where('invoiceId', '==', FIRST).get();
    expect(logs.docs.map((doc) => doc.data().action).sort()).toEqual(
      ['invoices.draft-created', 'invoices.issued', 'invoices.paid', 'invoices.paid', 'invoices.reopened', 'invoices.voided'],
    );
  });

  test('a copy of the void invoice takes the next number, and drafts issued together never share one', async () => {
    await page.getByRole('button', { name: 'Duplicate as a new draft' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Draft for Example Invoice Sponsor' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'INV-0001' })).toBeVisible();
    const copyId = page.url().split('/').pop();
    expect(copyId).not.toBe(FIRST);
    const copied = await callFunction('invoiceAdmin', { action: 'issue', invoiceId: copyId, expectedRevision: 1 }, staffToken);
    expect(copied.status).toBe(200);
    expect(copied.body.invoice.number).toBe('INV-0002');

    const ids = ['inv_e2eissue00000000000003', 'inv_e2eissue00000000000004'];
    for (const id of ids) {
      expect((await callFunction('invoiceAdmin', { action: 'saveDraft', invoiceId: id, expectedRevision: 0, invoice: DRAFT }, staffToken)).status).toBe(200);
    }
    const results = await Promise.all([
      ...ids.map((id) => callFunction('invoiceAdmin', { action: 'issue', invoiceId: id, expectedRevision: 1 }, staffToken)),
      callFunction('invoiceAdmin', { action: 'issue', invoiceId: ids[0], expectedRevision: 1 }, operatorToken),
    ]);
    const numbers = results.filter((res) => res.status === 200).map((res) => res.body.invoice.number).sort();
    expect(numbers).toEqual(['INV-0003', 'INV-0004']);
    expect(results.filter((res) => res.status !== 200).map((res) => res.status)).toEqual([409]);
    expect((await adminDb().collection('invoice_counters').doc('current').get()).data().lastNumber).toBe(4);
  });

  test('an issued invoice is emailed with its PDF to the billing email, once', async () => {
    const id = 'inv_e2eissue00000000000003';
    const stored = (await adminDb().collection('invoices').doc(id).get()).data();
    expect(stored.status).toBe('issued');
    const { number } = stored;
    await page.goto(`/admin/invoices/${id}`);
    await expect(page.getByRole('heading', { level: 1, name: number })).toBeVisible();
    await page.getByRole('button', { name: 'Email invoice' }).click();
    const form = page.getByRole('region', { name: `Email ${number}` });
    await form.getByLabel('Copy to').fill('finance@example.test');
    await form.getByLabel('Note').fill('Thank you for sponsoring.');
    await form.getByRole('button', { name: 'Preview email' }).click();
    const preview = form.getByRole('region', { name: 'Email preview' });
    await expect(preview).toContainText(`Invoice ${number} from ${stored.issuer.name}`);
    await expect(preview).toContainText(`${number}.pdf`);
    await expect(preview).toContainText('Thank you for sponsoring.');

    const since = mailFileSize();
    await form.getByRole('button', { name: 'Send to sponsor@example.test' }).click();
    await expect(page.getByRole('status').filter({ hasText: `Emailed ${number} to sponsor@example.test` })).toBeVisible();
    const mail = await waitForTaggedMail(since, 'sponsor@example.test', 'invoice.send');
    expect(mail.cc).toBe('finance@example.test');
    expect(mail.subject).toBe(`Invoice ${number} from ${stored.issuer.name}`);
    expect(mail.text).toContain('Thank you for sponsoring.');
    const config = (await adminDb().collection('config').doc('providers').get()).data() ?? {};
    const announcementStream = config.email?.announcementStream ?? 'announcements';
    expect(mail.messageStream ?? 'outbound').not.toBe(announcementStream);
    expect(mail.attachments).toHaveLength(1);
    expect(mail.attachments[0]).toMatchObject({ filename: `${number}.pdf`, contentType: 'application/pdf' });
    const pdf = Buffer.from(mail.attachments[0].content, 'base64');
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const drawn = pdfText(pdf);
    for (const text of [number, 'Example Invoice Sponsor', 'Presenting package', '$4,500.00']) {
      expect(drawn).toContain(text);
    }

    const after = (await adminDb().collection('invoices').doc(id).get()).data();
    expect(after.sends).toHaveLength(1);
    expect(after.sends[0]).toMatchObject({ status: 'sent', to: 'sponsor@example.test', cc: 'finance@example.test' });
    expect(after.sends[0].providerMessageId).toMatch(/^console-/);
    const logs = await adminDb().collection('admin_logs').where('invoiceId', '==', id).get();
    const emailed = logs.docs.map((doc) => doc.data()).filter((row) => row.action === 'invoices.emailed');
    expect(emailed).toHaveLength(1);
    expect(emailed[0].details.providerMessageId).toBe(after.sends[0].providerMessageId);
    expect(JSON.stringify(emailed[0])).not.toContain('sponsor@example.test');
    await expect(page.getByRole('list', { name: 'Emails sent' })).toContainText('sponsor@example.test');

    // A second send minutes later needs a confirmation; without one nothing goes.
    await page.getByRole('button', { name: 'Email invoice' }).click();
    await form.getByRole('button', { name: 'Preview email' }).click();
    await expect(form).toContainText('less than 15 minutes ago');
    await form.getByRole('button', { name: 'Send to sponsor@example.test' }).click();
    await expect(form.getByLabel('Send it again anyway')).toBeFocused();
    const again = await callFunction('invoiceAdmin', { action: 'previewSend', invoiceId: id }, staffToken);
    const refused = await callFunction('invoiceAdmin', {
      action: 'send', invoiceId: id, sendId: 'e2e-resend-0001', receipt: again.body.receipt,
    }, staffToken);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('recent-send');
    expect(taggedMailSince(since, 'sponsor@example.test', 'invoice.send')).toHaveLength(1);

    // A void invoice and a draft are never sent.
    const voidPreview = await callFunction('invoiceAdmin', { action: 'previewSend', invoiceId: FIRST }, staffToken);
    expect(voidPreview.status).toBe(409);
    const draftId = 'inv_e2eissue00000000000009';
    expect((await callFunction('invoiceAdmin', { action: 'saveDraft', invoiceId: draftId, expectedRevision: 0, invoice: DRAFT }, staffToken)).status).toBe(200);
    const draftSend = await callFunction('invoiceAdmin', { action: 'send', invoiceId: draftId, sendId: 'e2e-draft-0001', receipt: 'a'.repeat(64) }, staffToken);
    expect(draftSend.status).toBe(409);
  });

  test('without Stripe no card link is made; a stored link shows, prints, mails and closes on void (#519)', async () => {
    const id = 'inv_e2eissue00000000000004';
    const db = adminDb();
    const stored = (await db.collection('invoices').doc(id).get()).data();
    expect(stored.status).toBe('issued');
    const { number } = stored;
    await page.goto(`/admin/invoices/${id}`);
    await expect(page.getByRole('heading', { level: 1, name: number })).toBeVisible();
    const card = page.getByRole('region', { name: 'Pay by card' });
    await expect(card).toContainText('Card payment links need Stripe.');
    await expect(card.getByRole('button', { name: 'Make a card payment link' })).toHaveCount(0);
    const refused = await callFunction('invoiceAdmin', { action: 'createPayLink', invoiceId: id }, staffToken);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('pay-links-unavailable');
    expect((await db.collection('invoices').doc(id).get()).data().payLinks).toBeUndefined();

    // A link Stripe made while this site used Stripe, as the server stores it.
    const payUrl = 'https://checkout.stripe.com/c/pay/cs_test_e2e0001';
    await db.collection('invoices').doc(id).update({
      payLinks: [{
        linkId: 'pl_e2e000000000000000000001', status: 'open', sessionId: 'cs_test_e2e0001', url: payUrl,
        amount: stored.totals.total, currency: stored.currency, livemode: false,
        createdAt: new Date(), createdBy: 'e2e', expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
      }],
    });
    await page.reload();
    const link = card.getByRole('link', { name: /Open the card payment link/ });
    await expect(link).toBeVisible();
    expect(await link.getAttribute('href')).toBe(payUrl);
    await expect(card).toContainText('Works until');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download PDF' }).click(),
    ]);
    const lines = pdfText(readFileSync(await download.path())).split('\n');
    expect(lines).toContain('Pay by card');
    expect(lines).toContain(payUrl);

    const since = mailFileSize();
    await page.getByRole('button', { name: 'Email invoice' }).click();
    const form = page.getByRole('region', { name: `Email ${number}` });
    await form.getByRole('button', { name: 'Preview email' }).click();
    await expect(form.getByRole('region', { name: 'Email preview' })).toContainText('Pay by card');
    await form.getByRole('button', { name: 'Send to sponsor@example.test' }).click();
    await expect(page.getByRole('status').filter({ hasText: `Emailed ${number} to sponsor@example.test` })).toBeVisible();
    const mail = await waitForTaggedMail(since, 'sponsor@example.test', 'invoice.send');
    const hrefs = [...mail.html.matchAll(/href="([^"]*)"/g)].map(([, value]) => value.replace(/&amp;/g, '&'));
    expect(hrefs).toContain(payUrl);
    expect(mail.text.split('\n')).toContain(`Pay by card: ${payUrl}`);

    // A void closes the link. Stripe is not set up here, so the record says Stripe was not told.
    await page.getByRole('button', { name: 'Void this invoice' }).click();
    await page.getByLabel('Reason').fill('Billed twice');
    await page.getByRole('button', { name: `Void ${number}` }).click();
    await expect(page.locator('[data-invoice-status="void"]')).toBeVisible();
    await expect(card).toContainText('Cancelled');
    await expect(card).toContainText('Stripe was not told');
    await expect(card.getByRole('link', { name: /Open the card payment link/ })).toHaveCount(0);
    const voided = (await db.collection('invoices').doc(id).get()).data();
    expect(voided.payLinks[0]).toMatchObject({ status: 'cancelled', closedReason: 'void', stripeClosed: false });
  });

  test('a flagged card payment shows in the list and on the record, and an operator closes it (#519)', async () => {
    const db = adminDb();
    const reviewId = 'rv_e2e000000000000000000001';
    await db.collection('invoices').doc(FIRST).update({
      paymentReviews: [{
        reviewId, code: 'invoice-void', sessionId: 'cs_test_e2e0002', paymentIntentId: 'pi_test_e2e0002',
        amount: 450000, currency: 'usd', at: new Date(), invoiceStatus: 'void', resolved: false,
      }],
    });
    await page.goto('/admin/invoices');
    const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'INV-0001' }) });
    await expect(row).toContainText('Needs review');

    await page.goto(`/admin/invoices/${FIRST}`);
    const panel = page.getByRole('region', { name: 'A card payment needs review' });
    await expect(panel).toContainText('after it was voided');
    await expect(panel).toContainText('pi_test_e2e0002');
    const staffResolve = await callFunction('invoiceAdmin', { action: 'resolvePaymentReview', invoiceId: FIRST, reviewId, note: 'x' }, staffToken);
    expect(staffResolve.status).toBe(403);
    await panel.getByRole('button', { name: 'Mark reviewed' }).click();
    await panel.getByLabel('Review note').fill('Refunded in the Stripe Dashboard');
    await panel.getByRole('button', { name: 'Save review' }).click();
    await expect(page.getByRole('region', { name: 'A card payment needs review' })).toHaveCount(0);
    await expect(page.getByText('Reviewed: Refunded in the Stripe Dashboard')).toBeVisible();
    const after = (await db.collection('invoices').doc(FIRST).get()).data();
    expect(after.paymentReviews[0]).toMatchObject({ resolved: true, note: 'Refunded in the Stripe Dashboard' });
    const logs = await db.collection('admin_logs').where('invoiceId', '==', FIRST).get();
    expect(logs.docs.map((doc) => doc.data().action)).toContain('invoices.payment-review-resolved');
  });
});
