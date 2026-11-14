// Real console routes, production bundles, synthetic identity and HTTP only.
// The before bundle reads console source/assets from the PR base. This PR's
// dependency lock is unchanged; neither bundle installs or links dependencies.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { test, expect } from '@playwright/test';

const { contrastRatio } = createRequire(import.meta.url)('../scripts/lib/shared-theme.cjs');
const ROOT = process.cwd();
const CONSOLE_SRC = path.join(ROOT, 'console/web/src');
const FIXTURE = path.join(ROOT, 'e2e/fixtures/console-feedback');
const FIREBASE = path.join(CONSOLE_SRC, 'firebase.js');
const EVIDENCE = path.join(ROOT, 'test-results/admin-visual-evidence');
const APP_PATH = '/organizations/visual-newsroom/applications/visual-gathering';
const TEAM_PATH = '/organizations/visual-newsroom/team';
const git = (args, encoding = 'utf8') => execFileSync('git', args, { cwd: ROOT, encoding });
let scratch;
const previews = {};

function application() {
  return { id: 'visual-gathering', orgId: 'visual-newsroom', status: 'draft', myRole: 'owner', operator: true,
    canEdit: true, canAccept: true, canWithdraw: true, acceptance: null, errors: {}, ownersNeeded: 0,
    address: 'community-gathering.example.test', signups: { open: true },
    progress: { organization: true, event: true, webAddress: true, team: true, tickets: true, email: true, review: true, agreement: false },
    answers: { organization: { name: 'Community Newsroom', website: 'https://newsroom.example.test', address: '1 Community Street' },
      event: { name: 'Community News Gathering', shortName: 'News Gathering', timezone: 'America/New_York',
        days: [{ date: '2027-05-01', startTime: '09:00', endTime: '17:00' }], venue: { name: 'Community Hall', address: '2 Community Street' } },
      webAddress: { name: 'community-gathering' }, tickets: { choice: 'manual' },
      email: { senderName: 'Community Newsroom', replyTo: 'events@example.test' } }, connections: {}, build: null };
}
function responseFor(name) {
  if (name === 'getTeam') return { organization: { id: 'visual-newsroom', name: 'Community Newsroom' },
    myRole: 'owner', operator: true, ownersNeeded: 0,
    members: [{ uid: 'visual-owner', email: 'organizer@example.test', role: 'owner' },
      { uid: 'other-owner', email: 'co-organizer@example.test', role: 'owner' },
      { uid: 'visual-editor', email: 'editor@example.test', role: 'editor' }],
    invites: [{ id: 'visual-invite', email: 'invited-editor@example.test', role: 'editor', expiresAt: '2027-05-01T12:00:00.000Z' }] };
  if (name === 'getApplication') return { application: application() };
  if (name === 'getConsoleSettings') return { settings: { gcpFolder: '', billingAccount: '', region: '' }, agreement: null };
  if (name === 'listSignupLinks') return { links: [] };
  if (name === 'listApplicationsForReview') return { applications: [{ id: 'visual-gathering',
    eventName: 'Community News Gathering', organizationName: 'Community Newsroom', updatedAt: '2026-11-01T12:00:00.000Z' }] };
  if (name === 'getApplicationForReview') return { application: { ...application(), status: 'submitted', revision: 1, history: [], review: null },
    organization: { name: 'Community Newsroom' }, team: { members: [], invites: [] }, connection: null, canRetryBuild: false, build: null };
  throw new Error(`Unexpected console fixture action: ${name}`);
}

test.beforeAll(async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'console-design-'));
  const event = process.env.GITHUB_EVENT_PATH ? JSON.parse(await fs.readFile(process.env.GITHUB_EVENT_PATH, 'utf8')) : null;
  const base = event?.pull_request?.base?.sha || git(['merge-base', 'HEAD', 'origin/main']).trim();
  expect(base).toMatch(/^[a-f0-9]{40}$/);
  console.log(`console-design: before console source ${base}; after ${git(['rev-parse', 'HEAD']).trim()}`);
  const { build, preview } = await import('vite');
  const { default: react } = await import('@vitejs/plugin-react');
  const savedNodeEnvironment = process.env.NODE_ENV;
  try {
    for (const phase of ['before', 'after']) {
      const publicDir = path.join(scratch, `${phase}-public`);
      await fs.mkdir(publicDir);
      if (phase === 'before') {
        const files = git(['ls-tree', '-r', '--name-only', base, '--', 'console/web/public']).trim().split('\n').filter(Boolean);
        for (const file of files) {
          const destination = path.join(publicDir, path.relative('console/web/public', file));
          await fs.mkdir(path.dirname(destination), { recursive: true });
          await fs.writeFile(destination, git(['show', `${base}:${file}`], null));
        }
      } else await fs.cp(path.join(ROOT, 'console/web/public'), publicDir, { recursive: true });
      const outDir = path.join(scratch, phase);
      await build({ configFile: false, root: FIXTURE, base: '/', publicDir, logLevel: 'warn',
        plugins: [{ name: 'console-design-source', enforce: 'pre',
          resolveId(source, importer) {
            if (importer && source.startsWith('.') && path.resolve(path.dirname(importer.split('?')[0]), source) === FIREBASE) {
              return path.join(FIXTURE, 'firebase.js');
            }
            return null;
          },
          load(id) {
            const file = id.split('?')[0];
            if (phase === 'before' && file.startsWith(`${CONSOLE_SRC}${path.sep}`)) {
              return git(['show', `${base}:${path.relative(ROOT, file)}`]);
            }
            return null;
          },
        }, react()],
        define: { 'import.meta.env.VITE_CONSOLE_API_BASE': JSON.stringify(''),
          'import.meta.env.VITE_CONSOLE_HELP_EMAIL': JSON.stringify('support@example.test'),
          'import.meta.env.VITE_CONSOLE_HELP_NAME': JSON.stringify('the hosting team') },
        build: { outDir, emptyOutDir: true },
      });
      const server = await preview({ configFile: false, root: FIXTURE, base: '/', build: { outDir },
        preview: { host: '127.0.0.1', port: 0, open: false } });
      previews[phase] = { server, origin: `http://127.0.0.1:${server.httpServer.address().port}` };
    }
  } finally {
    if (savedNodeEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedNodeEnvironment;
  }
  await fs.mkdir(EVIDENCE, { recursive: true });
});
test.afterAll(async () => {
  for (const { server } of Object.values(previews)) await new Promise((resolve) => server.httpServer.close(resolve));
  if (scratch) await fs.rm(scratch, { recursive: true });
});

async function open(page, phase, route = TEAM_PATH) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.unroute('**/*');
  await page.route('**/*', async (request) => {
    const url = new URL(request.request().url());
    if (url.origin !== previews[phase].origin) return request.abort();
    if (!url.pathname.startsWith('/api/')) return request.continue();
    return request.fulfill({ json: responseFor(url.pathname.split('/').at(-1)) });
  });
  await page.goto(`${previews[phase].origin}${route}`);
  await expect(page.locator('main h1')).toBeVisible();
  await page.evaluate(async () => { await globalThis.document.fonts.ready; });
  expect(errors).toEqual([]);
}

for (const width of [375, 1280]) for (const mode of ['light', 'dark']) {
  test(`console production design at ${width}px in ${mode}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 375 ? 844 : 1000 });
    await page.emulateMedia({ colorScheme: mode, reducedMotion: 'reduce' });
    for (const phase of ['before', 'after']) {
      const fontResponses = [];
      const fontResponse = (response) => {
        if (response.url().endsWith('/fonts/source-sans-3-latin.woff2')) fontResponses.push(response.status());
      };
      page.on('response', fontResponse);
      await open(page, phase);
      await expect(page.locator('html')).toHaveJSProperty('scrollWidth', width);
      await page.screenshot({ path: path.join(EVIDENCE, `console-design-${phase}-${width}-${mode}.png`), fullPage: true });
      page.off('response', fontResponse);
      if (phase === 'before') continue;
      expect(fontResponses).toContain(200);
      expect(await page.evaluate(() => [...globalThis.document.fonts].some((face) => face.family.replace(/["']/g, '') === 'Source Sans 3' && face.status === 'loaded'))).toBe(true);
      const colors = await page.evaluate(() => {
        const style = globalThis.getComputedStyle(globalThis.document.documentElement);
        return Object.fromEntries(['surface', 'surface-alt', 'ink', 'ink-muted', 'accent', 'danger', 'success', 'focus']
          .map((name) => [name, style.getPropertyValue(`--${name}`).trim().split(/\s+/).map(Number)]));
      });
      for (const ground of ['surface', 'surface-alt']) {
        for (const text of ['ink', 'ink-muted', 'accent', 'danger', 'success']) expect(contrastRatio(colors[text], colors[ground])).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(colors.focus, colors[ground])).toBeGreaterThanOrEqual(3);
      }
    }
  });
}

test('console captions follow all five page headings', async ({ page }) => {
  for (const route of [TEAM_PATH, '/review', '/review/settings', '/review/visual-gathering', '/review/links']) {
    await open(page, 'after', route);
    await expect(page.locator('main .folio')).toBeVisible();
    const heading = await page.locator('main h1').boundingBox();
    const caption = await page.locator('main .folio').boundingBox();
    expect(caption.y).toBeGreaterThanOrEqual(heading.y + heading.height);
  }
});

test('console controls keep focus, a static pressed tint and guarded movement', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await open(page, 'after');
  const button = page.getByRole('button', { name: 'Send invite', exact: true });
  await button.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(button).toBeFocused();
  await expect(button).toHaveCSS('outline-width', '3px');
  await button.scrollIntoViewIfNeeded();
  const box = await button.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const resting = await button.evaluate((element) => globalThis.getComputedStyle(element).backgroundColor);
  await page.mouse.down();
  await expect(button).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 1)');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(button).toHaveCSS('transform', 'none');
  await expect(button).toHaveCSS('transition-duration', '0s');
  await expect(button).not.toHaveCSS('background-color', resting);
  await page.mouse.move(1, 1);
  await page.mouse.up();
  await button.evaluate((element) => { element.disabled = true; });
  await expect(button).toHaveCSS('cursor', 'pointer');
  await expect(button).toHaveCSS('transform', 'none');
  await page.emulateMedia({ forcedColors: 'active' });
  await button.evaluate((element) => { element.disabled = false; });
  await button.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(button).toHaveCSS('outline-width', '3px');
});

test('console steps use rules and the base radius', async ({ page }) => {
  await open(page, 'after', `${APP_PATH}/organization`);
  const current = page.locator('.steps a[aria-current="step"]');
  await expect(current).toHaveCSS('box-shadow', 'none');
  await expect(current).toHaveCSS('border-inline-start-width', '4px');
  await expect(current.locator('.step-number')).toHaveCSS('border-radius', '6px');
  await page.emulateMedia({ forcedColors: 'active' });
  const markers = await page.locator('.steps a').evaluateAll((links) => links.map((link) => ({
    current: link.getAttribute('aria-current') === 'step',
    border: globalThis.getComputedStyle(link).borderInlineStartColor,
    ground: globalThis.getComputedStyle(globalThis.document.body).backgroundColor,
  })));
  expect(markers.some((marker) => !marker.current)).toBe(true);
  for (const marker of markers) {
    if (marker.current) expect(marker.border).not.toBe(marker.ground);
    else expect(marker.border).toBe(marker.ground);
  }
});
