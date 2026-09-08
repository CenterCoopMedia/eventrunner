// Browser integration tests for #114. The host API is injected; Firebase,
// authentication, application registration, and diagnostic endpoints are real
// emulator paths. This suite does not claim native browser-host acceptance.
import { test, expect } from '@playwright/test';
import {
  ADMIN_EMAIL, PROJECT_ID, adminDb, adminIdToken, callFunction,
  ensureUser, idTokenFor, mailFileSize, waitForOtpCode,
} from './helpers.mjs';
import { installWebMcpHarness } from './webmcp-harness.mjs';

const PUBLIC_NAMES = [
  'check_public_schedule', 'get_event_context',
  'get_public_release_context', 'inspect_public_page',
];
const ADMIN_ENDPOINTS = {
  check_event_readiness: 'webMcpCheckEventReadiness',
  check_media_usage: 'webMcpCheckMediaUsage',
  check_ticketing_health: 'webMcpCheckTicketingHealth',
  inspect_publish_queue: 'webMcpInspectPublishQueue',
  inspect_system_errors: 'webMcpInspectSystemErrors',
  validate_current_page_draft: 'webMcpValidateCurrentPageDraft',
};
const ADMIN_NAMES = Object.keys(ADMIN_ENDPOINTS).sort();
const PRIVATE_CANARY = 'PRIVATE-WEBMCP-E2E-MUST-NOT-APPEAR';
const NON_ADMIN_EMAIL = 'webmcp-viewer@example.test';

const names = (page) => page.evaluate(() => globalThis.__eventrunnerWebMcpTest.names());
const invoke = (page, name) => page.evaluate(
  (toolName) => globalThis.__eventrunnerWebMcpTest.invoke(toolName), name,
);

function expectBounded(value, limit) {
  expect(Array.isArray(value.items)).toBe(true);
  expect(value.items.length).toBeLessThanOrEqual(limit);
  expect(Number.isInteger(value.total)).toBe(true);
  expect(Number.isInteger(value.truncated)).toBe(true);
  expect(value.truncated).toBeGreaterThanOrEqual(0);
  expect(value.total).toBe(value.items.length + value.truncated);
}

async function expectToolSet(page, expected) {
  await expect.poll(() => names(page)).toEqual([...expected].sort());
  const descriptors = await page.evaluate(() => globalThis.__eventrunnerWebMcpTest.descriptors());
  for (const definition of descriptors) {
    expect(definition.inputSchema).toEqual({ type: 'object', properties: {}, additionalProperties: false });
    expect(definition.annotations.readOnlyHint).toBe(true);
  }
}

async function signIn(page, email) {
  const since = mailFileSize();
  await page.goto('/signin');
  await page.locator('#signin-email').fill(email);
  await page.getByRole('button', { name: /email me a code/i }).click();
  await expect(page.locator('#signin-code')).toBeVisible();
  await page.locator('#signin-code').fill(await waitForOtpCode(since, email, 30_000));
  await page.getByRole('button', { name: /^sign in$/i }).click();
  // A new user can go straight to /profile. Do not race that redirect by
  // requiring the brief intermediate home route.
  await page.waitForURL((url) => url.pathname !== '/signin');
}

test.describe.serial('Read-only WebMCP browser integration', () => {
  let featuresRef;
  let eventName;
  let pageId;
  const restores = [];

  async function replaceFixture(ref, data) {
    const previous = await ref.get();
    restores.push(() => previous.exists ? ref.set(previous.data()) : ref.delete());
    await ref.set(data);
  }

  test.beforeAll(async () => {
    const loopback = /^(?:127\.0\.0\.1|localhost|\[::1\]):\d+$/;
    if (!PROJECT_ID.startsWith('demo-') ||
        !loopback.test(process.env.FIRESTORE_EMULATOR_HOST || '') ||
        !loopback.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '') ||
        process.env.EVENT_EMAIL_PROVIDER !== 'console') {
      throw new Error('Run WebMCP tests through npm run test:e2e with a local demo project and console email.');
    }
    const db = adminDb();
    const event = await db.doc('config/event').get();
    eventName = event.data().name;
    featuresRef = db.doc('config/features');
    const features = await featuresRef.get();
    await replaceFixture(featuresRef, { ...features.data(), webmcpPublic: true, webmcpAdmin: true });

    // Use a real seeded page and restore its draft after the suite. No publish
    // queue, attendee, invitation, email, or provider fixture is changed.
    const pages = await db.collection('cmsPages').get();
    const publicPage = pages.docs.find((doc) => /^[A-Za-z0-9_-]{1,64}$/.test(doc.id) && doc.id !== 'new');
    if (!publicPage) throw new Error('The emulator seed has no page to validate.');
    pageId = publicPage.id;
    await replaceFixture(db.doc(`cmsPages_drafts/${pageId}`), publicPage.data());
    await replaceFixture(db.doc('system_errors/webmcp-e2e-redaction'), {
      resolved: false, kind: 'webmcp-e2e-check', createdAt: new Date(),
      message: PRIVATE_CANARY, email: PRIVATE_CANARY, token: PRIVATE_CANARY,
      path: PRIVATE_CANARY, uid: PRIVATE_CANARY,
    });
  });

  test.beforeEach(async () => {
    await featuresRef.update({ webmcpPublic: true, webmcpAdmin: true });
  });

  test.afterEach(async ({ page }, testInfo) => {
    const evidence = await page.evaluate(() => {
      const host = globalThis.__eventrunnerWebMcpTest;
      return host ? {
        host: host.evidence, tools: host.names(),
        registrations: host.registrations, removals: host.removals, failures: host.failures,
      } : null;
    }).catch(() => null);
    if (evidence) {
      await testInfo.attach('webmcp-injected-host', {
        body: JSON.stringify(evidence, null, 2), contentType: 'application/json',
      });
      expect(evidence.failures).toEqual([]);
    }
  });

  test.afterAll(async () => {
    const results = await Promise.allSettled(restores.reverse().map((restore) => restore()));
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length) throw new Error(`Could not restore ${failures.length} WebMCP emulator fixtures.`);
  });

  test('unsupported browsers keep normal content and navigation', async ({ page }) => {
    await page.addInitScript(installWebMcpHarness, { supported: false });
    await page.goto('/');
    await expect(page.locator('article[data-content-source="live"]')).toBeVisible();
    await expectToolSet(page, []);
    await page.locator('a[href="/schedule"]').first().click();
    await expect(page).toHaveURL(/\/schedule$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectToolSet(page, []);
  });

  test('public tools match live content and follow SPA navigation without duplicates', async ({ page }) => {
    await page.addInitScript(installWebMcpHarness);
    await page.goto('/');
    await expectToolSet(page, PUBLIC_NAMES);
    await expect.poll(() => invoke(page, 'get_public_release_context')).toMatchObject({
      build: 'client', configSource: 'live', contentSource: 'live',
    });
    const event = await invoke(page, 'get_event_context');
    expect(event.name).toBe(eventName);
    expectBounded(event.days, 10);
    expectBounded(event.enabledFeatures, 10);
    expect(event.enabledFeatures.items).not.toContain('webmcpAdmin');
    const schedule = await invoke(page, 'check_public_schedule');
    expect(schedule.publishedOnly).toBe(true);
    expectBounded(schedule.entries, 20);
    expectBounded(schedule.issues, 20);
    expect(await invoke(page, 'inspect_public_page')).toMatchObject({ route: '/', contentSource: 'live' });

    const documentId = await page.evaluate(() => globalThis.__eventrunnerWebMcpTest.documentId);
    await page.locator('a[href="/schedule"]').first().click();
    await expect(page).toHaveURL(/\/schedule$/);
    await expect.poll(() => invoke(page, 'inspect_public_page')).toMatchObject({ route: '/schedule' });
    expect(await page.evaluate(() => globalThis.__eventrunnerWebMcpTest.documentId)).toBe(documentId);
    expect(await page.evaluate(() => globalThis.__eventrunnerWebMcpTest.registrations)).toHaveLength(4);
    await expectToolSet(page, PUBLIC_NAMES);
  });

  test('public flag changes remove and restore the registered set without a reload', async ({ page }) => {
    await page.addInitScript(installWebMcpHarness);
    await page.goto('/');
    await expectToolSet(page, PUBLIC_NAMES);
    const documentId = await page.evaluate(() => globalThis.__eventrunnerWebMcpTest.documentId);
    await featuresRef.update({ webmcpPublic: false });
    await expectToolSet(page, []);
    await featuresRef.update({ webmcpPublic: true });
    await expectToolSet(page, PUBLIC_NAMES);
    expect(await page.evaluate(() => globalThis.__eventrunnerWebMcpTest.documentId)).toBe(documentId);
  });

  test('an anonymous preview or admin URL cannot expose admin tools', async ({ page }) => {
    await page.addInitScript(installWebMcpHarness);
    await page.goto('/?preview=1');
    await expectToolSet(page, PUBLIC_NAMES);
    expect((await invoke(page, 'check_public_schedule')).publishedOnly).toBe(true);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/signin$/);
    await expect(page.locator('#signin-email')).toBeVisible();
    await expectToolSet(page, PUBLIC_NAMES);
  });

  test('each endpoint rejects missing authentication and a signed-in non-admin', async () => {
    const token = await idTokenFor(await ensureUser(NON_ADMIN_EMAIL));
    for (const [name, endpoint] of Object.entries(ADMIN_ENDPOINTS)) {
      const body = name === 'validate_current_page_draft' ? { pageId } : {};
      expect((await callFunction(endpoint, body)).status, `${name}: anonymous`).toBe(401);
      expect((await callFunction(endpoint, body, token)).status, `${name}: non-admin`).toBe(403);
    }
  });

  test('the signed-in non-admin page registers no diagnostic tools', async ({ page }) => {
    test.setTimeout(90_000);
    await page.addInitScript(installWebMcpHarness);
    await signIn(page, NON_ADMIN_EMAIL);
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: /don.t have admin access/i })).toBeVisible();
    await expectToolSet(page, []);
  });

  test('admin tools invoke real diagnostics, redact output, and clean up on route exit and sign-out', async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(installWebMcpHarness);
    await signIn(page, ADMIN_EMAIL);
    await page.goto(`/admin/pages/${pageId}`);
    await expect(page.getByRole('button', { name: /^sign out$/i })).toBeVisible();
    await expectToolSet(page, ADMIN_NAMES);
    const results = {};
    for (const name of ADMIN_NAMES) {
      results[name] = await invoke(page, name);
      expect(results[name].ok, `${name} succeeds through the authenticated endpoint`).toBe(true);
      expect(JSON.stringify(results[name])).not.toContain(PRIVATE_CANARY);
    }
    expectBounded(results.inspect_publish_queue.rows, 10);
    expectBounded(results.inspect_system_errors.rows, 20);
    expectBounded(results.validate_current_page_draft.issues, 20);
    expect(results.check_media_usage.assets.checked).toBeLessThanOrEqual(50);
    const canaryRow = results.inspect_system_errors.rows.items.find((row) => row.kind === 'webmcp-e2e-check');
    expect(canaryRow).toBeDefined();
    expect(Object.keys(canaryRow).sort()).toEqual(['createdAt', 'kind', 'lastSeenAt', 'state']);

    // Compare with the same domain validator through its normal server path.
    const token = await adminIdToken();
    const direct = await callFunction('webMcpValidateCurrentPageDraft', { pageId }, token);
    expect(direct.status).toBe(200);
    expect(results.validate_current_page_draft).toEqual({ ok: true, ...direct.body });
    const invalid = await callFunction('webMcpInspectSystemErrors', { path: 'users' }, token);
    expect(invalid.status).toBe(400);

    await featuresRef.update({ webmcpAdmin: false });
    await expectToolSet(page, []);
    await featuresRef.update({ webmcpAdmin: true });
    await expectToolSet(page, ADMIN_NAMES);

    // A client-side route change must tear down the admin set. A page.goto
    // here would discard the document and could hide broken effect cleanup.
    const documentId = await page.evaluate(() => globalThis.__eventrunnerWebMcpTest.documentId);
    await page.getByRole('link', { name: /^view site$/i }).click();
    await expect(page).not.toHaveURL(/\/admin(?:\/|$)/);
    await expectToolSet(page, PUBLIC_NAMES);
    expect(await page.evaluate(() => globalThis.__eventrunnerWebMcpTest.documentId)).toBe(documentId);
    await page.goBack();
    await expectToolSet(page, ADMIN_NAMES);
    expect(await page.evaluate(() => globalThis.__eventrunnerWebMcpTest.documentId)).toBe(documentId);
    await page.getByRole('button', { name: /^sign out$/i }).click();
    await expect(page).toHaveURL(/\/signin$/);
    await expectToolSet(page, PUBLIC_NAMES);
    expect(await page.evaluate(() => globalThis.__eventrunnerWebMcpTest.documentId)).toBe(documentId);
  });
});
