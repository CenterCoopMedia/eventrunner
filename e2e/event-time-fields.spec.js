// Dates and times on the event's clock (issue #476), in a real browser
// against the emulators. The pitch call deadline saves through the real
// updatePitchCall; the ticket catalog runs on synthetic HTTP contracts, as in
// stripe-ticketing-ui.spec.js. Captures go to EVENT_TIME_EVIDENCE_DIR when set.
/* global document, window */
import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { ADMIN_EMAIL, APP_BASE_URL, adminDb, callFunction, ensureUser, idTokenFor, signIn } from './helpers.mjs';

const EVIDENCE = process.env.EVENT_TIME_EVIDENCE_DIR;
const HEADERS = { 'access-control-allow-origin': APP_BASE_URL, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type, x-firebase-appcheck' };
const TYPE = { id: 'general', name: 'General admission', description: '', unitAmount: 2500, capacity: 20, active: true, visibility: 'public', minPerOrder: 1, maxPerOrder: 4, salesStartAt: null, salesEndAt: '2027-01-16T04:59:00.000Z' };
const CATALOG = { schemaVersion: 1, revision: 1, published: true, salesPaused: false, currency: 'usd', capacity: 20, maxPerOrder: 4, refundPolicy: 'Contact the organizer.', taxTreatment: 'inclusive', commercialTermsConfirmed: true, salesStartAt: '2026-11-16T14:00:00.000Z', salesEndAt: null, ticketTypes: [TYPE] };
const VIEWPORTS = [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]];

async function capture(locator, name) {
  if (!EVIDENCE) return;
  await fs.mkdir(EVIDENCE, { recursive: true });
  await locator.page().evaluate(() => document.fonts.ready);
  await locator.screenshot({ path: path.join(EVIDENCE, `${name}.png`), animations: 'disabled' });
}

async function fits(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
}

async function mock(page, name, handler) {
  await page.route(`**/${name}**`, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: HEADERS });
    const body = route.request().method() === 'POST' ? route.request().postDataJSON() : {};
    await route.fulfill({ status: 200, headers: HEADERS, json: await handler(body) });
  });
}

// What a screen reader is handed for the focused element: its role, its
// accessible name from aria-labelledby or its label, and its checked state.
async function focusedControl(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    const text = (id) => document.getElementById(id)?.textContent.trim() ?? '';
    const name = el.getAttribute('aria-labelledby')?.split(' ').map(text).join(' ')
      || (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent.trim())
      || el.textContent.trim();
    const role = el.tagName === 'INPUT' ? `${el.type}` : el.tagName.toLowerCase();
    return `${role}: ${name}${el.type === 'radio' || el.type === 'checkbox' ? (el.checked ? ' (checked)' : ' (not checked)') : ''}`;
  });
}

// Tab until the focus leaves the current control; a date input's day, month
// and year are stops inside one control, so they count once.
async function tabPath(page, stops) {
  const path = [await focusedControl(page)];
  for (let i = 0; i < 20 && path.length < stops; i += 1) {
    await page.keyboard.press('Tab');
    const now = await focusedControl(page);
    if (now !== path[path.length - 1]) path.push(now);
  }
  return path;
}

async function endTour(page) {
  const button = page.getByRole('button', { name: 'End tour', exact: true });
  if (await button.isVisible()) await button.click();
}

test.describe.serial('event-time fields', () => {
  // The browser sits 14 hours from the event. Every value below is on the
  // event's clock, so a read of the browser's own zone would fail them.
  test.use({ timezoneId: 'Asia/Tokyo' });
  let originalEvent;
  let originalCall;
  test.beforeAll(async () => {
    originalEvent = (await adminDb().doc('config/event').get()).data();
    originalCall = await adminDb().doc('config/pitch_call').get();
    await adminDb().doc('config/event').set({ ...originalEvent, timezone: 'America/New_York', historicalDemo: false });
  });
  test.afterAll(async () => {
    await adminDb().doc('config/event').set(originalEvent);
    if (originalCall.exists) await adminDb().doc('config/pitch_call').set(originalCall.data());
    else await adminDb().doc('config/pitch_call').delete();
  });

  test('the pitch deadline is set from the keyboard on the event’s clock and read back in words', async ({ page }) => {
    test.setTimeout(120_000);
    page.on('pageerror', (err) => console.error('Browser error:', err.message));
    const ref = adminDb().doc('config/pitch_call');
    await ref.set({ enabled: true, closesAt: '2027-02-01T04:59:59.000Z' });
    await signIn(page, ADMIN_EMAIL);
    await page.setViewportSize(VIEWPORTS[0][1]);
    await page.goto('/admin/pitches');
    await expect(page.getByRole('heading', { name: 'Session pitches', exact: true })).toBeVisible();
    await endTour(page);
    await page.getByText('Manage the call for sessions', { exact: true }).click();
    const deadline = page.getByRole('group', { name: 'Deadline', exact: true });
    const date = deadline.getByLabel('Date', { exact: true });
    const time = deadline.getByLabel('Time', { exact: true });
    await expect(date).toHaveValue('2027-01-31');
    await expect(time).toHaveValue('23:59:59');
    await expect(page.getByText('Intake closes Sunday, January 31, 2027 at 11:59:59 PM Eastern Standard Time (UTC−05:00).')).toBeVisible();
    await expect(page.getByText('2027-02-01T04:59:59.000Z')).toHaveCount(0);

    const main = page.locator('main');
    for (const [name, viewport] of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => window.scrollTo(0, 0));
      expect(await fits(page), `pitches page fits at ${viewport.width}px`).toBe(true);
      await capture(main, `pitch-call-after-${name}`);
    }

    // Wide: one line of panel description, and the filter and search inputs on one baseline.
    await page.setViewportSize(VIEWPORTS[0][1]);
    const description = page.getByText('Only operators can open or close intake.', { exact: true });
    const lineHeight = await description.evaluate((node) => parseFloat(window.getComputedStyle(node).lineHeight));
    expect((await description.boundingBox()).height).toBeLessThan(lineHeight * 1.5);
    const filter = await page.getByLabel('Filter by decision').boundingBox();
    const search = await page.getByLabel('Search pitches', { exact: true }).boundingBox();
    expect(Math.abs((filter.y + filter.height) - (search.y + search.height))).toBeLessThanOrEqual(1);
    // Narrow: the filter stacks above the search, each at the full width.
    await page.setViewportSize(VIEWPORTS[1][1]);
    const filterNarrow = await page.getByLabel('Filter by decision').boundingBox();
    const searchNarrow = await page.getByLabel('Search pitches', { exact: true }).boundingBox();
    expect(searchNarrow.y).toBeGreaterThan(filterNarrow.y + filterNarrow.height);
    expect(Math.abs(searchNarrow.width - filterNarrow.width)).toBeLessThanOrEqual(1);
    // 200% zoom on a 1280px screen is a 640px CSS viewport.
    await page.setViewportSize({ width: 640, height: 450 });
    expect(await fits(page), 'pitches page fits at 200% zoom').toBe(true);
    await page.setViewportSize(VIEWPORTS[0][1]);

    // A time the clocks skip is refused in place and nothing is saved.
    await date.fill('2027-03-14');
    await time.fill('02:30');
    await expect(page.getByText(/2:30 AM does not exist on March 14, 2027/)).toBeVisible();
    await page.getByRole('button', { name: 'Save call settings' }).click();
    await expect(time).toBeFocused();
    expect((await ref.get()).data().closesAt).toBe('2027-02-01T04:59:59.000Z');

    // The keyboard path: type the date and time into the segmented inputs, then press Save.
    await date.focus();
    await page.keyboard.type('01152027');
    await time.focus();
    await page.keyboard.type('1159P');
    await expect(date).toHaveValue('2027-01-15');
    await expect(time).toHaveValue('23:59');
    await expect(page.getByText('Intake closes Friday, January 15, 2027 at 11:59 PM Eastern Standard Time (UTC−05:00).')).toBeVisible();
    const save = page.getByRole('button', { name: 'Save call settings' });
    await save.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Call settings saved.', { exact: true })).toBeVisible();
    await expect.poll(async () => (await ref.get()).data().closesAt).toBe('2027-01-16T04:59:00.000Z');
    // The live snapshot carried the new value back; the message and the focus stay.
    await expect(page.getByText('Call settings saved.', { exact: true })).toBeVisible();
    await expect(save).toBeFocused();
    await expect(date).toHaveValue('2027-01-15');
  });

  test('catalog sales windows are entered on the event’s clock and stored as UTC instants', async ({ page }) => {
    test.setTimeout(120_000);
    page.on('pageerror', (err) => console.error('Browser error:', err.message));
    const saves = [];
    let catalog = CATALOG;
    await mock(page, 'getTicketingStatus', async () => ({ provider: 'stripe', webhookSupported: true, webhookRegisteredAt: null, lastDeliveryAt: null, queue: { pending: 0, exhausted: 0 } }));
    await mock(page, 'ticketingCommerceAdmin', async (body) => {
      if (body.action === 'catalog') return { provider: 'stripe', mode: 'test', catalog, inventory: { held: 0, sold: 0 } };
      if (body.action === 'saveCatalog') { saves.push(body.catalog); catalog = { ...body.catalog, revision: catalog.revision + 1 }; return { provider: 'stripe', mode: 'test', catalog, inventory: { held: 0, sold: 0 } }; }
      if (body.action === 'orders') return { orders: [], nextCursor: null };
      if (body.action === 'tickets') return { tickets: [], nextCursor: null };
      return {};
    });
    await signIn(page, ADMIN_EMAIL);
    await page.setViewportSize(VIEWPORTS[0][1]);
    await page.goto('/admin/ticketing');
    await endTour(page);
    await page.getByText('Configure ticket catalog', { exact: true }).click();
    const typeGroup = page.getByRole('group', { name: 'General admission' });
    await expect(page.getByRole('group', { name: 'Event sales start', exact: true }).getByLabel('Date', { exact: true })).toHaveValue('2026-11-16');
    await expect(page.getByRole('group', { name: 'Event sales start', exact: true }).getByLabel('Time', { exact: true })).toHaveValue('09:00');
    await expect(typeGroup.getByRole('group', { name: 'Ticket sales end', exact: true }).getByLabel('Date', { exact: true })).toHaveValue('2027-01-15');
    await expect(typeGroup.getByRole('group', { name: 'Ticket sales end', exact: true }).getByLabel('Time', { exact: true })).toHaveValue('23:59');
    await expect(typeGroup.getByText('Sales end Friday, January 15, 2027 at 11:59 PM Eastern Standard Time (UTC−05:00).')).toBeVisible();

    const windows = page.getByRole('group', { name: 'Event sales start' }).locator('xpath=..');
    for (const [name, viewport] of VIEWPORTS) {
      await page.setViewportSize(viewport);
      expect(await fits(page), `ticketing page fits at ${viewport.width}px`).toBe(true);
      await page.getByRole('group', { name: 'Event sales start' }).scrollIntoViewIfNeeded();
      await capture(windows, `catalog-window-after-${name}`);
      await capture(typeGroup, `catalog-type-window-after-${name}`);
    }
    await page.setViewportSize({ width: 640, height: 450 });
    expect(await fits(page), 'ticketing page fits at 200% zoom').toBe(true);
    await page.setViewportSize(VIEWPORTS[0][1]);

    // The repeated hour asks which one before the catalog can save.
    await page.getByRole('group', { name: 'Event sales end', exact: true }).getByLabel('Date', { exact: true }).fill('2027-11-07');
    await page.getByRole('group', { name: 'Event sales end', exact: true }).getByLabel('Time', { exact: true }).fill('01:30');
    await page.getByRole('button', { name: 'Save catalog' }).click();
    await expect(page.getByText('Correct the marked sales times before saving.')).toBeVisible();
    expect(saves).toHaveLength(0);
    await page.getByRole('radio', { name: /EST \(UTC−05:00\), after the clocks go back/ }).check();
    await typeGroup.getByRole('group', { name: 'Ticket sales end', exact: true }).getByLabel('Time', { exact: true }).fill('22:00');
    await page.getByRole('button', { name: 'Save catalog' }).click();
    await expect(page.getByText('Catalog saved. Existing orders keep the prices they were issued with.')).toBeVisible();
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({ salesStartAt: '2026-11-16T14:00:00.000Z', salesEndAt: '2027-11-07T06:30:00.000Z' });
    expect(saves[0].ticketTypes[0].salesEndAt).toBe('2027-01-16T03:00:00.000Z');
  });
  test('a call with no deadline is chosen and closed by keyboard alone, and /pitch shows no deadline', async ({ page }) => {
    test.setTimeout(180_000);
    page.on('pageerror', (err) => console.error('Browser error:', err.message));
    const ref = adminDb().doc('config/pitch_call');
    await ref.set({ enabled: true, closesAt: '2027-02-01T04:59:59.000Z', externalFormUrl: null });
    await signIn(page, ADMIN_EMAIL);
    await page.setViewportSize(VIEWPORTS[0][1]);
    await page.goto('/admin/pitches');
    await expect(page.getByRole('heading', { name: 'Session pitches', exact: true })).toBeVisible();
    await endTour(page);

    // Keyboard only from here: open the panel and walk its controls with Tab.
    await page.getByText('Manage the call for sessions', { exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    expect(await tabPath(page, 6)).toEqual([
      'checkbox: Accept session pitches (checked)',
      'radio: At a set date and time (checked)',
      'date: Deadline Date',
      'time: Deadline Time',
      'select: Where people pitch',
      'button: Save call settings',
    ]);

    // What a screen reader is told about each date-time control.
    const deadline = page.getByRole('group', { name: 'Deadline', exact: true });
    const date = deadline.getByLabel('Date', { exact: true });
    await expect(date).toHaveAccessibleName('Deadline Date');
    await expect(date).toHaveAccessibleDescription('Intake closes at this date and time. Event time zone: Eastern Time (America/New_York). Intake closes Sunday, January 31, 2027 at 11:59:59 PM Eastern Standard Time (UTC−05:00).');
    await expect(deadline.getByLabel('Time', { exact: true })).toHaveAccessibleName('Deadline Time');
    await expect(deadline.getByRole('status')).toHaveText('Intake closes Sunday, January 31, 2027 at 11:59:59 PM Eastern Standard Time (UTC−05:00).');
    await expect(page.getByRole('group', { name: 'When intake closes' })).toBeVisible();

    // Arrow keys move the choice inside the radio group, as the platform does.
    await page.getByRole('radio', { name: 'At a set date and time' }).focus();
    await page.keyboard.press('ArrowDown');
    const openChoice = page.getByRole('radio', { name: 'Open until I close it' });
    await expect(openChoice).toBeChecked();
    await expect(openChoice).toBeFocused();
    await expect(openChoice).toHaveAccessibleDescription('Intake stays open until an operator clears “Accept session pitches” and saves. The public page shows no deadline.');
    await expect(page.getByRole('group', { name: 'Deadline', exact: true })).toHaveCount(0);
    expect(await tabPath(page, 3)).toEqual([
      'radio: Open until I close it (checked)',
      'select: Where people pitch',
      'button: Save call settings',
    ]);
    await page.keyboard.press('Enter');
    await expect(page.getByText('Call settings saved.', { exact: true })).toBeVisible();
    await expect.poll(async () => (await ref.get()).data()).toEqual({ enabled: true, closesAt: null, externalFormUrl: null });
    await expect(page.getByRole('button', { name: 'Save call settings' })).toBeFocused();
    expect(await fits(page), 'pitches page fits at 1280px with no deadline').toBe(true);
    await capture(page.locator('main'), 'pitch-call-no-deadline-desktop');
    for (const [name, viewport] of [['phone', VIEWPORTS[1][1]], ['zoom-200', { width: 640, height: 450 }]]) {
      await page.setViewportSize(viewport);
      expect(await fits(page), `pitches page fits at ${viewport.width}px with no deadline`).toBe(true);
      await capture(page.locator('main'), `pitch-call-no-deadline-${name}`);
    }
    await page.setViewportSize(VIEWPORTS[0][1]);

    // The public page: open, with no deadline line and no countdown.
    const visitor = await page.context().browser().newPage();
    await visitor.goto(`${APP_BASE_URL}/pitch`);
    await expect(visitor.getByText('Submissions are open', { exact: true })).toBeVisible();
    await expect(visitor.getByText('There is no set deadline. The organizers close submissions when they are ready.')).toBeVisible();
    await expect(visitor.getByText(/Deadline:/)).toHaveCount(0);
    await expect(visitor.locator('time')).toHaveCount(0);

    // The server takes a pitch while the call is open.
    const submitterUid = await ensureUser('e2e-no-deadline-submitter@example.test');
    const token = await idTokenFor(submitterUid);
    const keys = [`no-deadline-${Date.now()}-a`, `no-deadline-${Date.now()}-b`];
    const body = (submissionKey) => ({ title: 'A session with no deadline', description: 'Synthetic pitch for the no-deadline check.', organization: null, format: null, submissionKey, consent: true });
    try {
      expect((await callFunction('submitSessionPitch', body(keys[0]), token)).status).toBe(201);

      // Staff close the call by hand: clear the checkbox with Space, then save with Enter.
      const accept = page.getByLabel('Accept session pitches');
      await accept.focus();
      await page.keyboard.press('Space');
      await expect(accept).not.toBeChecked();
      await page.getByRole('button', { name: 'Save call settings' }).focus();
      await page.keyboard.press('Enter');
      await expect.poll(async () => (await ref.get()).data()).toEqual({ enabled: false, closesAt: null, externalFormUrl: null });
      await expect(visitor.getByText('Submissions are closed', { exact: true })).toBeVisible();
      await expect(visitor.getByRole('button', { name: 'Submit pitch' })).toBeDisabled();
      expect((await callFunction('submitSessionPitch', body(keys[1]), token)).status).toBe(404);
    } finally {
      await visitor.close();
      for (const key of keys) await adminDb().collection('session_pitches').doc(createHash('sha256').update(`${submitterUid}\0${key}`).digest('hex')).delete();
      await adminDb().collection('session_pitch_rate_limits').doc(createHash('sha256').update(submitterUid).digest('hex')).delete();
    }
  });
});
