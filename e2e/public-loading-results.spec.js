import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { APP_BASE_URL, FUNCTIONS_ORIGIN, adminAuth, adminDb, ensureUser } from './helpers.mjs';

test.use({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', reducedMotion: 'reduce', trace: 'off', screenshot: 'off' });

const LATE = 'This is taking longer than usual. We’re still waiting for a response.';
const CLAIM = '/ticket/claim?order=loading-fixture&source=confirmation';
const FORM = { standard: { organization: { enabled: true, required: true } }, custom: [], revision: 7 };
const STRIPE_CATALOG = {
  provider: 'stripe', mode: 'test', salesEnabled: true, catalogRevision: 1, currency: 'usd',
  maxPerOrder: 4, refundPolicy: 'Contact the organizer to request a refund.', taxTreatment: 'inclusive',
  ticketTypes: [{ id: 'general', name: 'General admission', unitAmount: 2500, available: true, remaining: 10 }],
};
const CORS = {
  'access-control-allow-origin': APP_BASE_URL,
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, x-firebase-appcheck',
};

async function holdRequest(page, url, matches, respond = (route) => route.continue()) {
  const seen = Promise.withResolvers();
  const release = Promise.withResolvers();
  await page.route(url, async (route) => {
    if (!matches(route.request())) return route.fallback();
    seen.resolve();
    await release.promise;
    await respond(route);
  });
  return { seen: seen.promise, release: release.resolve };
}

async function holdEndpoint(page, name, json) {
  const url = `${FUNCTIONS_ORIGIN}/${name}`;
  await page.route(url, (route) => route.request().method() === 'OPTIONS'
    ? route.fulfill({ status: 204, headers: CORS })
    : route.fallback());
  return holdRequest(page, url, (request) => request.method() !== 'OPTIONS',
    (route) => route.fulfill({ headers: CORS, json }));
}

async function signInFixture(page, uid) {
  await page.goto('/signin');
  await expect(page.getByLabel('Email address')).toBeVisible();
  const moduleUrl = `/@fs/${resolve('e2e/browser-auth.js').replaceAll('\\', '/')}`;
  await page.evaluate(async ({ moduleUrl, token }) => {
    const { signInWithEmulatorToken } = await import(moduleUrl);
    await signInWithEmulatorToken(token);
  }, { moduleUrl, token: await adminAuth().createCustomToken(uid) });
  await expect(page.getByRole('button', { name: 'Sign out', exact: true }).first()).toBeVisible();
}

async function useClientSnapshot(page) {
  // A deployed client has an active event on first paint. The committed
  // historical demo snapshot would hide Login's check until Firestore arrives.
  await page.route('**/src/generated/eventConfig.js*', async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    await route.fulfill({ response, body: source.replace('historicalDemo: true', 'historicalDemo: false') });
  });
}

function statusLine(page, text) {
  return page.getByRole('main').getByRole('status').filter({ hasText: text });
}

async function expectSpokenStatus(status, text) {
  await expect(status).toHaveCount(1);
  await expect(status).toHaveText(text);
  await expect(status).toHaveAttribute('aria-live', 'polite');
  await expect(status).toHaveAttribute('aria-atomic', 'true');
  await expect(status.locator('xpath=ancestor::*[@aria-busy="true"]')).toHaveCount(0);
  await expect(status).toMatchAriaSnapshot(`- status: "${text}"`);
}

async function expectStages(page, label, busy) {
  await expect(page.locator('.loading-status__label').filter({ hasText: label })).toBeVisible();
  await expect(busy).toHaveAttribute('aria-busy', 'true');
  await page.clock.fastForward(1100);
  await expectSpokenStatus(statusLine(page, label), label);
  await page.clock.fastForward(9000);
  const late = statusLine(page, LATE);
  await expectSpokenStatus(late, LATE);
  await expect(statusLine(page, label)).toHaveCount(0);
  await late.evaluate((node) => {
    if (node.waitUpdates) return;
    node.waitUpdates = [];
    new globalThis.MutationObserver(() => node.waitUpdates.push(node.textContent))
      .observe(node, { childList: true, characterData: true, subtree: true });
  });
}

async function expectResult(page, busy, result) {
  await expect(busy).toHaveAttribute('aria-busy', 'false');
  const status = statusLine(page, result);
  await expectSpokenStatus(status, result);
  await expect(statusLine(page, LATE)).toHaveCount(0);
  expect((await status.evaluate((node) => node.waitUpdates)).filter((update) => update === result)).toEqual([result]);
}

test.describe('public wait results', () => {
  const email = 'public-loading-results@example.test';
  const speakerId = 'public-loading-results-speaker';
  const sessionId = 'public-loading-results-session';
  let uid;
  let originalEvent;
  let originalForm;

  test.beforeAll(async () => {
    const db = adminDb();
    originalEvent = (await db.doc('config/event').get()).data();
    originalForm = (await db.doc('config/registration_form').get()).data();
    uid = await ensureUser(email);
    await Promise.all([
      db.doc('config/event').update({ historicalDemo: false }),
      db.doc('config/registration_form').set(FORM),
      db.doc(`users/${uid}`).set({ uid, email, displayName: 'Loading Fixture', profileVisibility: 'private', registrationStatus: 'approved', speakerId }),
      db.doc(`speakers/${speakerId}`).set({ uid, email, firstName: 'Loading', lastName: 'Fixture', slug: speakerId, status: 'approved' }),
      db.doc(`cmsSchedule/${sessionId}`).set({ title: 'Loading fixture session', dayId: 'day-1', startTime: '10:00', endTime: '11:00', type: 'workshop', visible: true, speakerIds: [speakerId] }),
    ]);
  });

  test.afterAll(async () => {
    const db = adminDb();
    await Promise.all([
      originalEvent && db.doc('config/event').set(originalEvent),
      originalForm ? db.doc('config/registration_form').set(originalForm) : db.doc('config/registration_form').delete(),
      db.doc(`cmsSchedule/${sessionId}`).delete(),
      db.doc(`speakers/${speakerId}`).delete(),
      uid && db.doc(`users/${uid}`).delete(),
    ]);
    if (uid) await adminAuth().deleteUser(uid);
  });

  test('sign-in announces a restored session after the held account lookup', async ({ page }) => {
    await useClientSnapshot(page);
    await signInFixture(page, uid);
    await page.clock.install();
    const auth = await holdRequest(page, (url) => url.pathname.endsWith('/accounts:lookup'),
      (request) => request.method() === 'POST');
    await page.goto('/signin');
    const busy = page.getByRole('region', { name: 'Sign-in options' });
    await expectStages(page, 'Checking your sign-in…', busy);
    await auth.seen;
    auth.release();
    await expectResult(page, busy, 'You are signed in.');
    await expect(busy.getByRole('button', { name: 'Sign out' })).toBeVisible();
  });

  test('sign-in offers its options when the check runs long, and the late answer still wins', async ({ page }) => {
    // Issue 1357: Firebase's first auth state has no time limit. A held
    // account lookup keeps it open past the sign-in page's wait.
    const stalled = 'We could not confirm your sign-in yet. You can sign in below or try again.';
    await useClientSnapshot(page);
    await signInFixture(page, uid);
    await page.clock.install();
    const auth = await holdRequest(page, (url) => url.pathname.endsWith('/accounts:lookup'),
      (request) => request.method() === 'POST');
    await page.goto('/signin');
    const busy = page.getByRole('region', { name: 'Sign-in options' });
    await expectStages(page, 'Checking your sign-in…', busy);
    await auth.seen;
    await page.clock.fastForward(5000);
    await expect(busy).toHaveAttribute('aria-busy', 'false');
    await expectSpokenStatus(statusLine(page, stalled), stalled);
    await expect(busy.getByLabel('Email address')).toBeVisible();
    await expect(busy.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(busy.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
    auth.release();
    await expectSpokenStatus(statusLine(page, 'You are signed in.'), 'You are signed in.');
    await expect(busy.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await expect(busy.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  });

  test('sign-in announces its options after a held SDK load', async ({ page }) => {
    await useClientSnapshot(page);
    await page.clock.install();
    const auth = await holdRequest(page, '**/src/firebase.js*', () => true);
    await page.goto('/signin', { waitUntil: 'commit' });
    const busy = page.getByRole('region', { name: 'Sign-in options' });
    await expectStages(page, 'Checking your sign-in…', busy);
    await auth.seen;
    auth.release();
    await expectResult(page, busy, 'Sign-in options are ready.');
    await expect(busy.getByLabel('Email address')).toBeVisible();
  });

  test('claim announces the sign-in options after a held SDK load', async ({ page }) => {
    await page.clock.install();
    const auth = await holdRequest(page, '**/src/firebase.js*', () => true);
    await page.goto(CLAIM, { waitUntil: 'commit' });
    const busy = page.getByRole('region', { name: 'Ticket claim', exact: true });
    await expectStages(page, 'Checking your sign-in…', busy);
    await auth.seen;
    auth.release();
    await expectResult(page, busy, 'Sign-in options are ready to claim your ticket.');
    await expect(page.getByLabel('Email address')).toBeVisible();
    await expect(page).toHaveURL(new URL(CLAIM, APP_BASE_URL).href);
  });

  test('an account profile arriving late opens the original claim form', async ({ page }) => {
    await signInFixture(page, uid);
    await page.clock.install();
    const profile = await holdFirestoreDoc(page, `users/${uid}`);
    await page.goto(CLAIM);
    const busy = page.getByRole('region', { name: 'Ticket claim', exact: true });
    await expectStages(page, 'Setting up your account…', busy);
    await profile.seen;
    profile.release();
    await expectResult(page, busy, 'The ticket claim form is ready.');
    await expect(page.getByLabel('Order number')).toHaveValue('loading-fixture');
    await expect(page).toHaveURL(new URL(CLAIM, APP_BASE_URL).href);
  });

  for (const [title, url, endpoint, body, name, label, result] of [
    ['An empty ticket list', '/tickets/mine', 'ticketingMyTickets', { tickets: [], nextCursor: null }, 'Tickets', 'Loading your tickets…', 'You have no tickets for this account.'],
    ['Claimed tickets', '/tickets/mine', 'ticketingMyTickets', {
      tickets: [{ id: 'loading-fixture-ticket', ticketClass: 'General admission', status: 'valid', claimedByMe: true }],
      nextCursor: null,
    }, 'Tickets', 'Loading your tickets…', 'Your tickets are ready.'],
    ['Change requests', '/profile/change-requests', 'listMyChangeRequests', { requests: [] }, 'Change requests', 'Loading your change requests…', 'Your change requests are ready.'],
  ]) {
    test(`${title} announces the result after the read body arrives`, async ({ page }) => {
      await signInFixture(page, uid);
      await page.clock.install();
      const read = await holdEndpoint(page, endpoint, body);
      await page.goto(url);
      const busy = page.getByRole('region', { name, exact: true });
      await expectStages(page, label, busy);
      await read.seen;
      const response = page.waitForResponse((res) => res.url() === `${FUNCTIONS_ORIGIN}/${endpoint}` && res.request().method() === 'POST');
      read.release();
      expect(await (await response).finished()).toBeNull();
      await expectResult(page, busy, result);
    });
  }

  test('the ticket catalog announces its result after a hold', async ({ page }) => {
    await page.clock.install();
    const catalog = await holdEndpoint(page, 'ticketingCatalog', { provider: 'none' });
    await page.goto('/tickets');
    const busy = page.getByRole('region', { name: 'Ticket information' });
    await expectStages(page, 'Loading ticket information…', busy);
    await catalog.seen;
    catalog.release();
    await expectResult(page, busy, 'Ticket information is ready.');
  });

  test('the catalog stays silent when the read completes in under 300 ms', async ({ page }) => {
    await page.clock.install();
    await page.route(`${FUNCTIONS_ORIGIN}/ticketingCatalog`, (route) => route.fulfill({
      status: 503, headers: CORS, json: { error: { message: 'Ticket information is temporarily unavailable.' } },
    }));
    await page.goto('/tickets');
    await expect(page.getByRole('alert')).toHaveText('Ticket information is temporarily unavailable.');
    const catalog = await holdEndpoint(page, 'ticketingCatalog', { provider: 'none' });
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
    await page.getByRole('button', { name: 'Retry ticket information' }).dispatchEvent('click');
    const status = page.getByRole('main').getByRole('status');
    const busy = page.getByRole('region', { name: 'Ticket information' });
    await expect(busy).toHaveAttribute('aria-busy', 'true');
    await catalog.seen;
    await expect(status).toHaveText('');
    await page.clock.runFor(250);
    catalog.release();
    await expect(busy).toHaveAttribute('aria-busy', 'false');
    await page.clock.fastForward(1000);
    await expect(status).toHaveText('');
  });

  test('the catalog and the initial registration questions each name their held read', async ({ page }) => {
    await signInFixture(page, uid);
    await page.clock.install();
    const catalog = await holdEndpoint(page, 'ticketingCatalog', STRIPE_CATALOG);
    const form = await holdFirestoreDoc(page, 'config/registration_form');
    await page.goto('/tickets');
    const busy = page.getByRole('region', { name: 'Ticket information' });
    await expectStages(page, 'Loading ticket information…', busy);
    await catalog.seen;
    catalog.release();
    await expect(statusLine(page, LATE)).toHaveCount(0);
    await expectStages(page, 'Loading registration questions…', busy);
    await form.seen;
    form.release();
    await expectResult(page, busy, 'The ticket registration form is ready.');
    await expect(page.getByLabel('Quantity — General admission')).toBeVisible();
  });

  test('registration waits for a newer form after checkout refuses the current revision', async ({ page }) => {
    await signInFixture(page, uid);
    const catalog = await holdEndpoint(page, 'ticketingCatalog', STRIPE_CATALOG);
    catalog.release();
    const checkout = `${FUNCTIONS_ORIGIN}/ticketingCheckout`;
    await page.route(checkout, (route) => route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: CORS })
      : route.fulfill({ status: 409, headers: CORS, json: { error: { code: 'form-changed', message: 'The registration questions changed.' } } }));
    await page.clock.install();
    await page.goto('/tickets');
    await page.getByLabel('Quantity — General admission').selectOption('1');
    await page.getByRole('button', { name: 'Next: Attendees' }).click();
    await page.getByLabel('First name', { exact: true }).fill('Fixture');
    await page.getByLabel('Attendee email', { exact: true }).fill(email);
    await page.getByRole('button', { name: 'Next: Questions' }).click();
    await page.getByLabel('Organization (required)').fill('Fixture newsroom');
    await page.getByRole('button', { name: 'Next: Review' }).click();
    await page.getByRole('checkbox', { name: 'I have read and accept the refund policy' }).check();
    await page.getByRole('button', { name: /Continue to Stripe/ }).click();
    const busy = page.getByRole('region', { name: 'Ticket information' });
    await expectStages(page, 'Loading the updated questions…', busy);
    await expect(page.getByLabel('Organization (required)')).toHaveCount(0);
    const form = adminDb().doc('config/registration_form');
    try {
      await form.set({ ...FORM, revision: 8, standard: { ...FORM.standard, jobTitle: { enabled: true, required: true } } });
      await expectResult(page, busy, 'The ticket registration form is ready.');
      await expect(page.getByLabel('Organization (required)')).toHaveValue('Fixture newsroom');
      await expect(page.getByLabel('Job title (required)')).toBeVisible();
    } finally {
      await form.set(FORM);
    }
  });

  test('speaker next steps and the Materials tab announce the result of each held read', async ({ page }) => {
    await signInFixture(page, uid);
    await page.clock.install();
    const checklistRead = await holdEndpoint(page, 'listSessionMaterials', { materials: [] });
    await page.goto('/speaker/dashboard');
    const checklist = page.getByRole('region', { name: 'Speaker checklist' });
    await expectStages(page, 'Checking your next steps…', checklist);
    await checklistRead.seen;
    checklistRead.release();
    await expectResult(page, checklist, 'Your next steps are ready.');

    const materialsRead = await holdEndpoint(page, 'listSessionMaterials', { materials: [] });
    await page.getByRole('tab', { name: 'Materials' }).click();
    const materials = page.getByRole('region', { name: 'Session materials' });
    await expectStages(page, 'Loading materials…', materials);
    await materialsRead.seen;
    materialsRead.release();
    await expectResult(page, materials, 'Session materials are ready.');
  });

  test('photo crop announces successful image decode', async ({ page }) => {
    await signInFixture(page, uid);
    await page.clock.install();
    await page.goto('/profile');
    const name = 'loading-photo.png';
    const fixture = `${APP_BASE_URL}/__loading_photo__.png`;
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGOwKKrBihiGlgQAp2xJgcACTO8AAAAASUVORK5CYII=', 'base64');
    await page.evaluate(({ fixture, name }) => {
      const create = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (object) => object instanceof File && object.name === name ? fixture : create(object);
    }, { fixture, name });
    const image = await holdRequest(page, fixture, () => true,
      (route) => route.fulfill({ contentType: 'image/png', body: png }));
    await page.getByLabel(/upload a photo|replace photo/i).setInputFiles({ name, mimeType: 'image/png', buffer: png });
    const busy = page.getByRole('application', { name: /position the crop/i });
    await expectStages(page, 'Loading the image…', busy);
    await image.seen;
    image.release();
    await expectResult(page, busy, 'The image is ready to crop.');
    await expect(page.getByRole('button', { name: 'Use this crop' })).toBeEnabled();
  });
});

function holdFirestoreDoc(page, path) {
  return holdRequest(page, '**/google.firestore.v1.Firestore/Listen/channel**', (request) =>
    request.method() === 'POST' && Array.from(new URLSearchParams(request.postData()).values())
      .some((entry) => entry.includes(`/documents/${path}"`)));
}
