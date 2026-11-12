// Production React catches render failures without a window error event.
// Build the real boundary/reporter and intercept every report on hosted CI.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, FUNCTIONS_ORIGIN, adminDb, callFunction, signIn } from './helpers.mjs';

const ROOT = process.cwd();
const FIXTURE = path.join(ROOT, 'e2e/fixtures/error-recovery');
const EVIDENCE = path.join(ROOT, 'test-results/admin-visual-evidence');
let server;
let output;
let origin;

test.beforeAll(async () => {
  const { build, preview } = await import('vite');
  const { default: appConfig } = await import('../apps/web/vite.config.js');
  const { default: tailwindConfig } = await import('../apps/web/tailwind.config.js');
  const { default: tailwindcss } = await import('tailwindcss');
  const { default: autoprefixer } = await import('autoprefixer');
  output = await fs.mkdtemp(path.join(os.tmpdir(), 'eventrunner-error-recovery-'));
  const config = {
    ...appConfig,
    configFile: false,
    root: FIXTURE,
    publicDir: path.join(ROOT, 'apps/web/public'),
    logLevel: 'error',
    css: { postcss: { plugins: [tailwindcss({
      ...tailwindConfig,
      content: [path.join(ROOT, 'apps/web/index.html'), path.join(ROOT, 'apps/web/src/**/*.{js,jsx}'), `!${path.join(ROOT, 'apps/web/src/**/*.test.{js,jsx}')}`],
    }), autoprefixer()] } },
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      'import.meta.env.PROD': 'true',
      'import.meta.env.DEV': 'false',
      'import.meta.env.VITE_DEMO_MODE': JSON.stringify('false'),
      'import.meta.env.VITE_FUNCTIONS_ORIGIN': JSON.stringify('/telemetry'),
    },
    build: { outDir: output, emptyOutDir: true },
    preview: { host: '127.0.0.1', port: 0, strictPort: true },
  };
  await build(config);
  server = await preview(config);
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  await fs.mkdir(EVIDENCE, { recursive: true });
});

test.afterAll(async () => {
  await new Promise((resolve, reject) => server ? server.httpServer.close((error) => error ? reject(error) : resolve()) : resolve());
  if (output) await fs.rm(output, { recursive: true, force: true });
});

async function intercept(page, receive = async () => ({ json: { received: true } })) {
  const reports = [];
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/telemetry/logClientError') {
      const report = route.request().postDataJSON();
      reports.push(report);
      return route.fulfill(await receive(report));
    }
    return route.continue();
  });
  return reports;
}

for (const [area, routePath, title] of [
  ['public', '/broken', 'This page could not be shown'],
  ['admin', '/admin/broken', 'This admin page could not be shown'],
]) {
  test(`production ${area} render failures report once and keep navigation`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const reports = await intercept(page);
    await page.goto(`${origin}${routePath}`);
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await expect(page.getByRole('navigation', { name: area === 'admin' ? 'Admin sections' : 'Main' })).toBeVisible();
    await expect.poll(() => reports.length).toBe(1);
    expect(reports[0].context.source).toBe('react-boundary');
    expect(reports[0].context.componentStack).toBeTruthy();
    expect(reports[0].message).toBe('Synthetic production render failure');
    await page.evaluate(() => globalThis.document.fonts.ready);
    await page.screenshot({ path: path.join(EVIDENCE, `error-recovery-${area}-390.png`) });
    await page.getByRole('link', { name: 'Working page' }).click();
    await expect(page.getByRole('heading', { name: 'Working page content' })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(reports).toHaveLength(1);
  });
}

test('production root and modal panels state the failed surface', async ({ page }) => {
  const reports = await intercept(page);
  await page.goto(`${origin}/layout-error`);
  await expect(page.getByRole('heading', { name: 'The site could not be shown' })).toBeVisible();
  await expect.poll(() => reports.length).toBe(1);
  await page.evaluate(() => globalThis.document.fonts.ready);
  await page.screenshot({ path: path.join(EVIDENCE, 'error-recovery-root.png') });
  for (const [routePath, title] of [
    ['/feedback-error', 'The feedback form could not open.'],
    ['/change-request-error', 'The change request form could not open.'],
  ]) {
    await page.goto(`${origin}${routePath}`);
    await expect(page.getByRole('heading', { name: 'Page content' })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText(title);
    await expect(page.getByRole('heading')).toHaveCount(1);
  }
});

test('production healthy step navigation retains the answer', async ({ page }) => {
  const reports = await intercept(page);
  await page.goto(`${origin}/steps/first`);
  await page.getByRole('textbox', { name: 'Answer' }).fill('Keep this answer');
  await page.getByRole('link', { name: 'Next step' }).click();
  await expect(page).toHaveURL(`${origin}/steps/second`);
  await expect(page.getByRole('textbox', { name: 'Answer' })).toHaveValue('Keep this answer');
  expect(reports).toHaveLength(0);
});

test('a production caught error reaches the emulator and the real System errors page once', async ({ page }) => {
  const reports = await intercept(page, async (report) => {
    const response = await callFunction('logClientError', report);
    expect(response.status).toBe(201);
    return { status: response.status, json: response.body };
  });
  const url = `${origin}/reported-render-error`;
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'This page could not be shown' })).toBeVisible();
  const saved = () => adminDb().collection('system_errors').where('url', '==', url).get();
  await expect.poll(async () => (await saved()).size).toBe(1);
  expect(reports).toHaveLength(1);
  const record = (await saved()).docs[0];
  expect(record.data().kind).toBe('client-error');
  expect(JSON.parse(record.data().context).source).toBe('react-boundary');

  await page.unrouteAll({ behavior: 'wait' });
  await signIn(page, ADMIN_EMAIL);
  const listed = page.waitForResponse((response) => response.url() === `${FUNCTIONS_ORIGIN}/listSystemErrors` && response.request().method() === 'POST');
  await page.goto('/admin/system-errors');
  const payload = await (await listed).json();
  expect(payload.rows.some((row) => row.id === record.id)).toBe(true);
  await expect(page.getByRole('heading', { name: 'A visitor had a problem', exact: true })).toHaveCount(payload.rows.filter((row) => row.kind === 'client-error').length);
});

test('production missing chunk reloads once and stays out of telemetry', async ({ page }) => {
  const reports = await intercept(page);
  let documents = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame() && frame.url() === `${origin}/chunk-error`) documents += 1;
  });
  await page.goto(`${origin}/chunk-error`, { waitUntil: 'commit' });
  await expect.poll(() => documents).toBe(2);
  await expect(page.getByRole('heading', { name: 'This page could not be shown' })).toBeVisible();
  expect(await page.evaluate(() => globalThis.sessionStorage.getItem('eventrunner:chunk-reload'))).toBe('1');
  expect(reports).toHaveLength(0);
});
