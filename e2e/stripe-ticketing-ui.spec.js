// Synthetic HTTP contracts around the real attendee/admin pages and emulator
// sign-in. No Stripe account, card data, or live payment is involved here.
/* global document, window */
import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, APP_BASE_URL, adminDb, signIn } from './helpers.mjs';

const TYPE = { id: 'general', name: 'General admission', description: 'Full-event admission.', unitAmount: 2500, capacity: 20, active: true, available: true, visibility: 'public', remaining: 20, minPerOrder: 1, maxPerOrder: 4, salesStartAt: null, salesEndAt: null };
const CATALOG = { schemaVersion: 1, revision: 1, published: true, salesPaused: false, currency: 'usd', capacity: 20, maxPerOrder: 4, refundPolicy: 'Contact the organizer before the event to request a refund.', taxTreatment: 'inclusive', commercialTermsConfirmed: true, salesStartAt: null, salesEndAt: null, ticketTypes: [TYPE] };
const PUBLIC = { provider: 'stripe', mode: 'test', salesEnabled: true, catalogRevision: CATALOG.revision, currency: 'usd', maxPerOrder: 4, refundPolicy: CATALOG.refundPolicy, taxTreatment: 'inclusive', ticketTypes: [TYPE] };
const TICKET = { externalId: 'opaque-browser-seat-1', id: 'opaque-browser-seat-1', orderId: 'browser-order-1', ticketTypeId: 'general', ticketClass: 'General admission', firstName: 'Synthetic', lastName: 'Attendee', email: 'browser-attendee@example.test', status: 'valid', claimedByUid: null, claimedByMe: false, checkedInAt: null };
const ORDER = { id: 'browser-order-1', orderId: 'browser-order-1', purchaserEmail: ADMIN_EMAIL, status: 'paid', paymentStatus: 'succeeded', currency: 'usd', subtotalAmount: 2500, totalAmount: 2500, createdAt: '2026-01-01T12:00:00Z', refundStatus: 'none', refundedAmount: 0, lines: [{ ticketTypeId: 'general', name: TYPE.name, quantity: 1, unitAmount: 2500, lineAmount: 2500 }] };
const EVIDENCE = path.resolve('test-results/admin-visual-evidence');
const HEADERS = { 'access-control-allow-origin': APP_BASE_URL, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type, x-firebase-appcheck' };

async function mockEndpoint(page, name, handler) {
  await page.route(`**/${name}**`, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: HEADERS });
    const body = route.request().method() === 'POST' ? route.request().postDataJSON() : {};
    const result = await handler(body, route);
    if (result === null) return;
    await route.fulfill({ status: 200, headers: HEADERS, json: result });
  });
}

async function screenshot(page, name, target = null) {
  await fs.mkdir(EVIDENCE, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  if (target) await target.screenshot({ path: path.join(EVIDENCE, `${name}.png`), animations: 'disabled' });
  else await page.screenshot({ path: path.join(EVIDENCE, `${name}.png`), animations: 'disabled' });
}

async function assertPageFits(page, label) {
  const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth }));
  expect(width.page, `${label} stays inside the viewport`).toBeLessThanOrEqual(width.viewport + 1);
}

test.describe.serial('Stripe ticketing browser contracts', () => {
  let originalEvent;
  test.beforeAll(async () => {
    originalEvent = (await adminDb().doc('config/event').get()).data();
    await adminDb().doc('config/event').set({ ...originalEvent, historicalDemo: false });
  });
  test.afterAll(async () => { if (originalEvent) await adminDb().doc('config/event').set(originalEvent); });

  test('the header and home lead offer tickets only once a catalog is published', async ({ page }) => {
    // The shape the public catalog read answers before staff publish a catalog.
    const UNPUBLISHED = { provider: 'stripe', mode: 'test', salesEnabled: false, catalogRevision: null, currency: null, ticketTypes: [], closedReason: 'Ticket sales are not configured.' };
    let response = UNPUBLISHED;
    let reads = 0;
    await mockEndpoint(page, 'ticketingCatalog', async () => { reads += 1; return response; });
    await page.goto('/');
    await expect.poll(() => reads).toBeGreaterThan(0);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Get tickets' })).toHaveCount(0);
    await expect(page.locator('a[href="/tickets"]')).toHaveCount(0);
    await screenshot(page, 'stripe-action-before-catalog', page.locator('header').first());

    // Paused sales keep the action, so a visitor can read when sales open.
    response = { ...PUBLIC, salesEnabled: false, closedReason: 'Ticket sales are paused.' };
    await page.reload();
    await expect(page.getByRole('link', { name: 'Get tickets' }).first()).toBeVisible();
    for (const link of await page.getByRole('link', { name: 'Get tickets' }).all()) await expect(link).toHaveAttribute('href', '/tickets');
    await screenshot(page, 'stripe-action-after-catalog', page.locator('header').first());
    await page.getByRole('link', { name: 'Get tickets' }).first().click();
    await expect(page.getByRole('heading', { name: 'Ticket sales are closed' })).toBeVisible();
    await expect(page.getByText('Ticket sales are paused.')).toBeVisible();
  });

  test('selection, lost handoff recovery, authoritative status, and printable ticket reflow', async ({ page }) => {
    test.setTimeout(180_000);
    let status = 'pending';
    const checkoutBodies = [];
    await mockEndpoint(page, 'ticketingCatalog', async () => PUBLIC);
    await mockEndpoint(page, 'ticketingCheckout', async (body, route) => {
      checkoutBodies.push(body);
      if (checkoutBodies.length === 1) { await route.abort('failed'); return null; }
      return { orderId: ORDER.orderId, status: 'pending', paymentStatus: 'pending', checkoutUrl: null, expiresAt: '2030-01-01T12:00:00Z' };
    });
    await mockEndpoint(page, 'ticketingOrderStatus', async () => ({ ...ORDER, status, paymentStatus: status === 'paid' ? 'succeeded' : 'pending', tickets: status === 'paid' ? [TICKET] : [] }));
    await signIn(page, ADMIN_EMAIL);
    await page.goto('/tickets');
    await expect(page.getByLabel('Quantity — General admission')).toBeVisible();
    await page.getByLabel('Quantity — General admission').selectOption('1');
    // The submit stays usable. Its validation gives keyboard focus to the
    // first attendee field rather than leaving a silent disabled control.
    await page.getByRole('button', { name: 'Continue to Stripe — $25.00' }).click();
    await expect(page.getByLabel('First name', { exact: true })).toBeFocused();
    await page.getByLabel('First name', { exact: true }).fill(TICKET.firstName);
    await page.getByLabel('Last name', { exact: true }).fill(TICKET.lastName);
    await page.getByLabel('Attendee email', { exact: true }).fill(TICKET.email);
    await page.getByRole('checkbox', { name: 'I have read and accept the refund policy' }).check();
    for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }], ['narrow', { width: 320, height: 800 }]]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => window.scrollTo(0, 0));
      await assertPageFits(page, `Purchase at ${viewport.width}px`);
      await screenshot(page, `stripe-purchase-${name}`);
    }
    await page.getByRole('button', { name: 'Continue to Stripe — $25.00' }).click();
    await expect(page.getByRole('button', { name: 'Resume existing checkout' })).toBeVisible();
    await expect(page.getByText(/We could not reach ticketing/)).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Resume existing checkout' }).click();
    await page.waitForURL(`**/tickets/status?orderId=${ORDER.orderId}`);
    await expect(page.getByRole('heading', { name: 'We are confirming your order' })).toBeVisible();
    expect(checkoutBodies).toHaveLength(2);
    expect(checkoutBodies[0].catalogRevision).toBe(CATALOG.revision);
    expect(checkoutBodies[1]).toEqual({ requestId: checkoutBodies[0].requestId, resume: true });
    expect(checkoutBodies[0]).not.toHaveProperty('unitAmount');
    expect(checkoutBodies[0].lines[0]).not.toHaveProperty('unitAmount');
    await expect(page.getByText(TICKET.externalId, { exact: true })).toHaveCount(0);
    status = 'paid';
    await page.getByRole('button', { name: 'Check payment status', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your order is confirmed' })).toBeVisible();
    await expect(page.getByText(TICKET.externalId, { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Claim this ticket with the attendee’s account' })).toHaveAttribute('href', `/ticket/claim?order=${ORDER.orderId}`);
    await assertPageFits(page, 'Confirmation at 320px');
    await screenshot(page, 'stripe-ticket-confirmation-mobile', page.locator('.ticket-document'));
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByRole('button', { name: 'Print tickets' })).toBeHidden();
    await expect(page.getByText(TICKET.externalId, { exact: true })).toBeVisible();
    await screenshot(page, 'stripe-ticket-print', page.locator('.ticket-document'));
  });

  test('reopening sales updates an unedited catalog editor without an unsaved-edits warning', async ({ page }) => {
    test.setTimeout(120_000);
    let saved = { ...CATALOG, salesPaused: true };
    const writes = [];
    await mockEndpoint(page, 'getTicketingStatus', async () => ({ provider: 'stripe', webhookSupported: true, webhookRegisteredAt: null, lastDeliveryAt: null, queue: { pending: 0, exhausted: 0 } }));
    await mockEndpoint(page, 'ticketingCommerceAdmin', async (body) => {
      if (body.action === 'pauseSales') saved = { ...saved, revision: saved.revision + 1, salesPaused: body.paused };
      if (body.action === 'saveCatalog') { writes.push(body); saved = { ...body.catalog, revision: saved.revision + 1 }; }
      if (body.action === 'orders') return { orders: [], nextCursor: null };
      if (body.action === 'tickets') return { tickets: [], nextCursor: null };
      return { provider: 'stripe', mode: 'test', catalog: saved, inventory: { held: 0, sold: 0 } };
    });
    await signIn(page, ADMIN_EMAIL);
    await page.goto('/admin/ticketing');
    await expect(page.getByRole('heading', { name: 'Stripe sales', exact: true })).toBeVisible();
    const endTour = page.getByRole('button', { name: 'End tour', exact: true });
    if (await endTour.isVisible()) await endTour.click();
    await page.getByText('Configure ticket catalog').click();
    await expect(page.getByRole('checkbox', { name: 'Pause new sales' })).toBeChecked();
    await page.getByRole('button', { name: 'Review reopening sales' }).click();
    const dialog = page.getByRole('dialog', { name: 'Reopen new ticket sales?' });
    await dialog.getByLabel('Reason for changing sales').fill('Launch approved.');
    await dialog.getByRole('button', { name: 'Reopen new sales' }).click();
    await expect(page.getByText('New sales enabled')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Pause new sales' })).not.toBeChecked();
    await expect(page.getByText(/The saved catalog has changed/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Discard unsaved edits and reload catalog' })).toHaveCount(0);
    await screenshot(page, 'stripe-catalog-after-reopen', page.locator('form').filter({ hasText: 'Ticket types' }));
    await page.getByRole('button', { name: 'Save catalog' }).click();
    await expect(page.getByText('Catalog saved. Existing orders keep the prices they were issued with.')).toBeVisible();
    expect(writes).toHaveLength(1);
    expect(writes[0].expectedRevision).toBe(CATALOG.revision + 1);
    expect(writes[0].catalog.salesPaused).toBe(false);
  });

  test('an empty cart asks for a ticket choice instead of offering a free reservation', async ({ page }) => {
    await mockEndpoint(page, 'ticketingCatalog', async () => PUBLIC);
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, ADMIN_EMAIL);
    await page.goto('/tickets');
    await expect(page.getByLabel('Quantity — General admission')).toBeVisible();
    await expect(page.getByText('Choose at least one ticket to continue.')).toBeVisible();
    await expect(page.getByText(/No payment is required/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Reserve tickets|Continue to Stripe/ })).toHaveCount(0);
    await screenshot(page, 'stripe-empty-cart-mobile', page.locator('section').filter({ hasText: 'Review your total' }));
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('Choose at least one ticket.');
    await expect(page.getByRole('alert')).toBeFocused();
    await page.getByLabel('Quantity — General admission').selectOption('1');
    await expect(page.getByText('Choose at least one ticket to continue.')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Continue to Stripe — $25.00' })).toBeVisible();
  });

  test('organizer review dialog traps focus, preserves cancellation meaning, and fits desktop/mobile', async ({ page }) => {
    test.setTimeout(180_000);
    const actions = [];
    let ticket = { ...TICKET };
    const detail = () => ({ order: ORDER, tickets: [ticket], audit: actions.filter((action) => action.action === 'cancelTickets').map((action, index) => ({ id: `audit-${index}`, action: 'cancelTickets', at: '2026-01-02T12:00:00Z', actorUid: 'synthetic-operator', reason: action.reason, ticketIds: action.ticketIds })), stripeDashboardUrl: 'https://dashboard.stripe.com/acct_synthetic/test/payments/pi_synthetic' });
    await mockEndpoint(page, 'getTicketingStatus', async () => ({ provider: 'stripe', webhookSupported: true, webhookRegisteredAt: null, lastDeliveryAt: null, queue: { pending: 0, exhausted: 0 } }));
    await mockEndpoint(page, 'ticketingCommerceAdmin', async (body) => {
      actions.push(body);
      if (body.action === 'catalog') return { provider: 'stripe', mode: 'test', catalog: CATALOG, inventory: { held: 0, sold: 1 } };
      if (body.action === 'orders') return { orders: [ORDER], nextCursor: null };
      if (body.action === 'tickets') return { tickets: [ticket], nextCursor: null };
      if (body.action === 'cancelTickets') ticket = { ...ticket, status: 'cancelled' };
      return detail();
    });
    await mockEndpoint(page, 'ticketingCheckIn', async () => ({ result: 'already_checked_in', ticket: { ...ticket, checkedInAt: '2026-01-02T10:00:00Z' } }));
    await signIn(page, ADMIN_EMAIL);
    await page.goto('/admin/ticketing');
    await expect(page.getByRole('heading', { name: 'Stripe sales', exact: true })).toBeVisible();
    const endTour = page.getByRole('button', { name: 'End tour', exact: true });
    if (await endTour.isVisible()) await endTour.click();
    await page.getByRole('button', { name: ORDER.orderId, exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Order details', exact: true })).toBeVisible();
    for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }], ['narrow', { width: 320, height: 800 }]]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => window.scrollTo(0, 0));
      await assertPageFits(page, `Organizer ticketing at ${viewport.width}px`);
      await screenshot(page, `stripe-organizer-${name}`);
    }
    await page.getByRole('checkbox', { name: /Select Synthetic Attendee/ }).check();
    const opener = page.getByRole('button', { name: 'Review ticket cancellation' });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Cancel the selected admission tickets?' });
    await expect(dialog).toBeVisible();
    expect(actions.filter((action) => action.action === 'cancelTickets')).toHaveLength(0);
    await expect(dialog.getByText(/No refund payment is created/)).toBeVisible();
    await expect(dialog.getByText(/Sold seats will not be returned/)).toBeVisible();
    // Opening focuses the heading; reverse navigation starts at the final
    // control, and repeated Tab navigation stays inside in both directions.
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'Go back' })).toBeFocused();
    for (const key of ['Tab', 'Shift+Tab']) {
      for (let index = 0; index < 8; index += 1) {
        await page.keyboard.press(key);
        const focus = await dialog.evaluate((element) => ({ inside: element.contains(document.activeElement), tag: document.activeElement?.tagName }));
        expect(focus.inside, `${key} stays inside the review dialog (active element: ${focus.tag})`).toBe(true);
      }
    }
    await screenshot(page, 'stripe-cancel-review-mobile', dialog);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    await opener.click();
    await dialog.getByLabel('Reason for this action').fill('The attendee cannot attend.');
    await dialog.getByRole('button', { name: 'Cancel 1 admission tickets' }).click();
    await expect(page.getByText('Selected tickets cancelled. No money was refunded and no seats were restocked.')).toBeVisible();
    expect(actions.filter((action) => action.action === 'cancelTickets')).toEqual([{ action: 'cancelTickets', orderId: ORDER.orderId, ticketIds: [TICKET.externalId], reason: 'The attendee cannot attend.', confirmed: true }]);
    await expect(page.getByRole('link', { name: /Open this payment in Stripe Dashboard/ })).toHaveAttribute('href', 'https://dashboard.stripe.com/acct_synthetic/test/payments/pi_synthetic');
  });
});
