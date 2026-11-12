// Hosted-only delivery checks: build real routes with the existing synthetic
// identity fixture, then observe emitted chunks over HTTP. No live backend.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';

const ROOT = process.cwd();
const FIXTURE = path.join(ROOT, 'e2e/fixtures/console-workspace');
const FIREBASE = path.join(ROOT, 'console/web/src/firebase.js');
const ORG = { id: 'route-newsroom', name: 'Synthetic newsroom', role: 'owner' };
const APPLICATION = {
  id: 'route-event', orgId: ORG.id, status: 'draft', myRole: 'owner', operator: false,
  canEdit: true, canWithdraw: false, canAccept: false, errors: {}, ownersNeeded: 0,
  progress: { organization: true, event: true, webAddress: true, tickets: true, email: true, team: true },
  answers: {
    organization: { name: ORG.name, website: '', address: '' },
    event: { name: 'Synthetic gathering' }, tickets: { choice: 'none' },
  },
  connections: { canChange: false, canDisconnect: false, stripe: { connected: false }, eventbrite: { connected: false } },
};
const TEAM = {
  organization: ORG, myRole: 'owner', operator: false, invites: [], ownersNeeded: 0,
  members: [
    { uid: 'visual-console-operator', email: 'organizer@example.test', role: 'owner' },
    { uid: 'another-organizer', email: 'another@example.test', role: 'owner' },
  ],
};

let directory;
let server;
let origin;
let manifest;

function chunk(suffix) {
  const entry = Object.entries(manifest).find(([source]) => source.endsWith(suffix));
  expect(entry, `Missing deferred route ${suffix}`).toBeTruthy();
  expect(entry[1].isDynamicEntry).toBe(true);
  return `/${entry[1].file}`;
}

test.beforeAll(async () => {
  const { build, preview } = await import('vite');
  const { default: consoleConfig } = await import('../console/web/vite.config.js');
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'console-routes-'));
  await build({
    configFile: false, root: FIXTURE, logLevel: 'warn',
    plugins: [{
      name: 'console-route-fixture', enforce: 'pre',
      resolveId(source, importer) {
        if (importer && source.startsWith('.') && path.resolve(path.dirname(importer.split('?')[0]), source) === FIREBASE) {
          return path.join(FIXTURE, 'firebase.js');
        }
        return null;
      },
    }, ...consoleConfig.plugins],
    optimizeDeps: consoleConfig.optimizeDeps,
    define: { 'import.meta.env.VITE_CONSOLE_API_BASE': JSON.stringify('') },
    build: { outDir: directory, emptyOutDir: true, manifest: true },
  });
  manifest = JSON.parse(await fs.readFile(path.join(directory, '.vite/manifest.json'), 'utf8'));
  server = await preview({
    configFile: false, root: FIXTURE, logLevel: 'warn',
    optimizeDeps: consoleConfig.optimizeDeps,
    build: { outDir: directory }, preview: { host: '127.0.0.1', port: 0 },
  });
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
});

test.afterAll(async () => {
  if (server) await new Promise((resolve) => server.httpServer.close(resolve));
  if (directory) await fs.rm(directory, { recursive: true, force: true });
});

function observeScripts(page) {
  const scripts = [];
  page.on('response', (response) => {
    if (response.request().resourceType() === 'script') scripts.push({ path: new URL(response.url()).pathname, status: response.status() });
  });
  return scripts;
}

async function api(route) {
  const action = new URL(route.request().url()).pathname.split('/').at(-1);
  const responses = {
    listOrganizations: { operator: false, organizations: [ORG] },
    listApplications: { applications: [{ id: APPLICATION.id, eventName: 'Synthetic gathering', status: 'draft' }] },
    getTeam: TEAM, getApplication: { application: APPLICATION },
  };
  expect(Object.hasOwn(responses, action), `Unexpected fixture action ${action}`).toBe(true);
  await route.fulfill({ json: responses[action] });
}

test('an applicant reaches setup without review chunks, with focus after a delayed import', async ({ page }, testInfo) => {
  const setup = chunk('/pages/setup/Setup.jsx');
  const review = ['ReviewQueue', 'ReviewApplication', 'ConsoleSettings', 'SignupLinks'].map((name) => chunk(`/pages/review/${name}.jsx`));
  const scripts = observeScripts(page);
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname.startsWith('/api/')) return api(route);
    if (url.pathname === setup) await waiting;
    return route.continue();
  });
  try {
    // The synthetic applicant is already signed in; the normal sign-in route returns them home.
    await page.goto(`${origin}/signin`);
    await page.getByRole('link', { name: ORG.name, exact: true }).click();
    await page.getByRole('link', { name: 'Synthetic gathering', exact: true }).click();
    await page.getByRole('link', { name: 'Continue the setup' }).click();
    await expect(page.getByRole('status')).toHaveText('Loading.');
    await expect(page.getByRole('main')).toBeFocused();
    release();
    await expect(page.getByRole('heading', { name: 'Your organization', exact: true })).toBeFocused();
    expect(scripts.some((entry) => entry.path === setup)).toBe(true);
    expect(scripts.filter((entry) => review.includes(entry.path))).toEqual([]);
  } finally {
    release();
    await testInfo.attach('console-applicant-network', { body: JSON.stringify(scripts, null, 2), contentType: 'application/json' });
  }
});

test('an unavailable route keeps the shell and reloads successfully when the chunk returns', async ({ page }, testInfo) => {
  const team = chunk('/pages/Team.jsx');
  const scripts = observeScripts(page);
  let available = false;
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname.startsWith('/api/')) return api(route);
    if (url.pathname === team && !available) return route.fulfill({ status: 404, contentType: 'text/plain', body: 'Synthetic missing module' });
    return route.continue();
  });
  try {
    await page.goto(`${origin}/organizations/${ORG.id}`);
    await page.getByRole('link', { name: 'Team', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'This page did not load' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await page.getByRole('link', { name: 'Event Runner', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your organizations', exact: true })).toBeFocused();
    await page.getByRole('link', { name: ORG.name, exact: true }).click();
    await page.getByRole('link', { name: 'Team', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'This page did not load' })).toBeVisible();
    available = true;
    await page.getByRole('button', { name: 'Reload page' }).click();
    await expect(page.getByRole('heading', { name: 'Team', exact: true })).toBeVisible();
    expect(scripts.filter((entry) => entry.path === team).map((entry) => entry.status)).toEqual([404, 200]);
  } finally {
    await testInfo.attach('console-reload-network', { body: JSON.stringify(scripts, null, 2), contentType: 'application/json' });
  }
});
