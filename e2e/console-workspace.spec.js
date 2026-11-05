// Hosted visual evidence for the client console. The isolated Vite server
// renders the production routes without an Auth SDK or a live backend.
// Its Firebase replacement is test-only; the console build never loads it.
import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';

const ROOT = process.cwd();
const FIXTURE = path.join(ROOT, 'e2e/fixtures/console-workspace');
const FIREBASE = path.join(ROOT, 'console/web/src/firebase.js');
const EVIDENCE = path.join(ROOT, 'test-results/admin-visual-evidence');
const APPLICATION_PATH = '/organizations/visual-newsroom/applications/visual-gathering';
const ORGANIZATIONS = [
  { id: 'visual-newsroom', name: 'Community Newsroom', role: 'owner', createdAt: '2026-10-08T12:00:00.000Z' },
  { id: 'visual-collaborative', name: 'Independent Media Collaborative', role: 'editor', createdAt: '2026-10-15T12:00:00.000Z' },
  { id: 'visual-network', name: 'Regional Reporting and Community Engagement Network', role: 'editor', createdAt: '2026-10-22T12:00:00.000Z' },
];

function application(status = 'ready') {
  return {
    id: 'visual-gathering', orgId: 'visual-newsroom', status,
    answers: { event: { name: 'Community News Gathering' }, tickets: { choice: 'spreadsheet' } },
    address: 'community-gathering.example.test',
    acceptance: status === 'draft' ? null : { name: 'Alex Organizer', at: '2026-11-01T12:00:00.000Z' },
    myRole: 'owner', operator: true, canEdit: status === 'draft', canWithdraw: status === 'draft',
    errors: {}, build: status === 'building' ? { failed: false, current: 'web-address' } : null,
    connections: { canChange: false, canDisconnect: false, stripe: { connected: false }, eventbrite: { connected: false } },
  };
}

let server;
let origin;

test.beforeAll(async () => {
  const { createServer } = await import('vite');
  const { default: react } = await import('@vitejs/plugin-react');
  server = await createServer({
    configFile: false,
    root: FIXTURE,
    plugins: [
      {
        name: 'console-visual-fixture',
        enforce: 'pre',
        resolveId(source, importer) {
          if (importer && source.startsWith('.') && path.resolve(path.dirname(importer.split('?')[0]), source) === FIREBASE) {
            return path.join(FIXTURE, 'firebase.js');
          }
          return null;
        },
      },
      react(),
    ],
    server: { host: '127.0.0.1', port: 0, fs: { allow: [ROOT] } },
    define: {
      'import.meta.env.VITE_CONSOLE_API_BASE': JSON.stringify(''),
      'import.meta.env.VITE_CONSOLE_HELP_EMAIL': JSON.stringify('support@example.test'),
      'import.meta.env.VITE_CONSOLE_HELP_NAME': JSON.stringify('the hosting team'),
    },
  });
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  await fs.mkdir(EVIDENCE, { recursive: true });
});

test.afterAll(async () => { await server?.close(); });

test('console directories and application progress are readable across widths and color schemes', async ({ page }) => {
  test.setTimeout(120_000);
  let currentApplication = application();
  let releaseDirectory;
  const directoryReady = new Promise((resolve) => { releaseDirectory = resolve; });
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const action = url.pathname.split('/').at(-1);
    if (action === 'listOrganizations') await directoryReady;
    const responses = {
      listOrganizations: { operator: true, organizations: ORGANIZATIONS.slice(0, 2), allOrganizations: ORGANIZATIONS },
      getApplication: { application: currentApplication },
      getTeam: { organization: ORGANIZATIONS[0] },
      listApplications: { applications: [currentApplication] },
    };
    expect(Object.hasOwn(responses, action), `Unexpected console request: ${action}`).toBe(true);
    await route.fulfill({ json: responses[action] });
  });

  for (const width of [1440, 390, 320]) {
    for (const colorScheme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await page.goto(origin);
      if (width === 1440 && colorScheme === 'light') {
        await expect(page.getByRole('status')).toHaveText('Loading your organizations.');
        await expect(page.locator('.console-spinner')).toHaveCSS('animation-name', 'none');
        const loadingWidth = await page.locator('.masthead-inner').evaluate((element) => element.clientWidth);
        await page.screenshot({ path: path.join(EVIDENCE, 'console-organizations-loading-1440-light.png'), fullPage: true });
        releaseDirectory();
        await expect(page.getByRole('heading', { name: 'All organizations' })).toBeVisible();
        await expect(page.locator('.masthead-inner')).toHaveJSProperty('clientWidth', loadingWidth);
      }
      await expect(page.getByRole('heading', { name: 'All organizations' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Review requests' })).toHaveAttribute('href', '/review');
      const directory = page.getByRole('list', { name: 'Your organizations' });
      const organizationLink = directory.getByRole('link', { name: 'Community Newsroom', exact: true });
      await expect(organizationLink).toHaveAccessibleDescription('Owner');
      await expect(page.locator('html')).toHaveJSProperty('scrollWidth', width);
      await page.screenshot({ path: path.join(EVIDENCE, `console-organizations-${width}-${colorScheme}.png`), fullPage: true });

      if (width === 1440 && colorScheme === 'light') {
        await page.getByRole('button', { name: 'Sign out' }).focus();
        await page.keyboard.press('Tab');
        await expect(organizationLink).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('heading', { level: 1, name: 'Community Newsroom' })).toBeVisible();
      }

      await page.goto(`${origin}${APPLICATION_PATH}`);
      await expect(page.getByRole('heading', { level: 1, name: 'Community News Gathering' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Open your admin panel' })).toHaveAttribute('href', 'https://community-gathering.example.test/admin');
      await expect(page.getByRole('complementary', { name: 'Setup progress' }).locator('[aria-current="step"]')).toHaveText('Your site is readyNow');
      await expect(page.getByRole('link', { name: 'Read the agreement' })).toHaveAttribute('href', `${APPLICATION_PATH}/accepted-agreement`);
      await expect(page.locator('html')).toHaveJSProperty('scrollWidth', width);
      await page.screenshot({ path: path.join(EVIDENCE, `console-application-${width}-${colorScheme}.png`), fullPage: true });
    }
  }

  currentApplication = application('draft');
  await page.goto(`${origin}${APPLICATION_PATH}`);
  await expect(page.getByRole('link', { name: 'Continue the setup' })).toHaveAttribute('href', `${APPLICATION_PATH}/organization`);
  await expect(page.getByRole('button', { name: 'Withdraw the request' })).toBeVisible();
  currentApplication = application('building');
  await page.goto(`${origin}${APPLICATION_PATH}`);
  await expect(page.getByText('You can close this page')).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Setup progress' }).locator('[aria-current="step"]')).toHaveText('We are building your siteNow');
  await expect(page.getByRole('status')).toHaveText('Now: Setting up your web address. Next: Setting up email and tickets.');
  await expect(page.locator('.console-spinner')).toHaveCSS('animation-name', 'none');
  await page.screenshot({ path: path.join(EVIDENCE, 'console-building-320-dark-reduced-motion.png'), fullPage: true });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('.console-spinner')).toHaveCSS('animation-name', 'console-spin');
  currentApplication = { ...application('building'), build: { failed: true, needsReconnect: false } };
  await page.goto(`${origin}${APPLICATION_PATH}`);
  await expect(page.getByText('The build did not finish', { exact: true })).toBeVisible();
  await expect(page.locator('.console-spinner')).toHaveCount(0);
  expect(browserErrors).toEqual([]);
});
