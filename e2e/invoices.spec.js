// Invoices (issue #208), on the real surface: the draft flow.
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
import { test, expect } from '@playwright/test';
import {
  ADMIN_EMAIL, adminDb, callFunction, ensureUser, idTokenFor, signIn,
} from './helpers.mjs';

const STAFF_EMAIL = 'e2e-invoice-staff@example.test';
const ORG_ID = 'e2e-invoice-sponsor';
const PACKAGE_ID = 'e2e-invoice-package';

async function clearInvoices() {
  const db = adminDb();
  const left = await db.collection('invoices').get();
  await Promise.all(left.docs.map((doc) => doc.ref.delete()));
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
