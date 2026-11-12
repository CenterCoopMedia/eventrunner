import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { test, expect } from '@playwright/test';

const ROOT = process.cwd();
const FIXTURE = path.join(ROOT, 'apps/web/test-fixtures/app-boot');
const EVIDENCE = path.join(ROOT, 'test-results/admin-visual-evidence');
const BASE = '/nested/event/';
let server;
let output;
let origin;
let shellSize;

test.beforeAll(async () => {
  const { build, preview } = await import('vite');
  const { default: appConfig } = await import('../apps/web/vite.config.js');
  const source = await fs.readFile(path.join(ROOT, 'apps/web/index.html'), 'utf8');
  // Exercise the actual HTML, changing only its entry to a small production
  // React fixture. It imports the real LoadingState and its clock handoff.
  await fs.writeFile(path.join(FIXTURE, 'index.html'), source.replace('src="/src/main.jsx"', 'src="/main.jsx"'));
  output = await fs.mkdtemp(path.join(os.tmpdir(), 'eventrunner-app-boot-'));
  const config = {
    ...appConfig,
    configFile: false,
    mode: 'production',
    root: FIXTURE,
    base: BASE,
    publicDir: path.join(ROOT, 'apps/web/public'),
    logLevel: 'error',
    css: { postcss: { plugins: [] } },
    build: { outDir: output, emptyOutDir: true },
    preview: { host: '127.0.0.1', port: 0, strictPort: true },
  };
  const previousNodeEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    await build(config);
    server = await preview(config);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    await fs.rm(path.join(FIXTURE, 'index.html'), { force: true });
  }
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const html = await fs.readFile(path.join(output, 'index.html'));
  shellSize = { sourceBytes: Buffer.byteLength(source), productionBytes: html.length, productionGzipBytes: gzipSync(html).length };
  await fs.mkdir(EVIDENCE, { recursive: true });
});

test.afterAll(async () => {
  await new Promise((resolve, reject) => server ? server.httpServer.close((error) => error ? reject(error) : resolve()) : resolve());
  if (output) await fs.rm(output, { recursive: true, force: true });
});

async function recordTimeline(page) {
  await page.addInitScript(() => {
    const timeline = { changes: [], paints: [] };
    globalThis.bootTimeline = timeline;
    new PerformanceObserver((list) => {
      timeline.paints.push(...list.getEntries().map(({ name, startTime }) => ({ name, startTime })));
    }).observe({ type: 'paint', buffered: true });
    let previous;
    new MutationObserver(() => {
      const boot = globalThis.document.getElementById('app-boot');
      const state = {
        boot: Boolean(boot),
        text: boot?.querySelector('[role="status"]')?.textContent ?? '',
        reload: Boolean(boot?.querySelector('button:not([hidden])')),
        stage: globalThis.document.querySelector('.loading-state')?.dataset.loadingStage ?? null,
        ready: globalThis.document.querySelector('h1')?.textContent === 'Page ready',
      };
      const key = JSON.stringify(state);
      if (key !== previous) timeline.changes.push({ at: performance.now(), ...state });
      previous = key;
    }).observe(globalThis.document, { childList: true, subtree: true, attributes: true, characterData: true });
  });
}

async function holdAssets(page, { css = false } = {}) {
  let releaseEntry;
  let releaseCss;
  let entryHeld = true;
  let cssHeld = css;
  const entry = new Promise((resolve) => { releaseEntry = resolve; });
  const stylesheet = new Promise((resolve) => { releaseCss = resolve; });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname.endsWith('.js') && entryHeld) await entry;
    if (url.pathname.endsWith('.css') && cssHeld) await stylesheet;
    return route.continue();
  });
  return {
    entry() { entryHeld = false; releaseEntry(); },
    css() { cssHeld = false; releaseCss(); },
  };
}

async function evidence(page, name, extra = {}) {
  const timeline = await page.evaluate(() => globalThis.bootTimeline);
  await fs.writeFile(path.join(EVIDENCE, `app-boot-${name}.json`), JSON.stringify({ shellSize, ...extra, ...timeline }, null, 2));
  return timeline;
}

test('a fast production load paints content without fallback text', async ({ page }) => {
  await recordTimeline(page);
  await page.goto(`${origin}${BASE}`);
  await expect(page.getByRole('heading', { name: 'Page ready' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => globalThis.bootTimeline.paints.length)).toBeGreaterThan(0);
  const timeline = await evidence(page, 'fast');
  expect(timeline.changes.some(({ text }) => text)).toBe(false);
  const ready = timeline.changes.find((state) => state.ready);
  const firstContentfulPaint = timeline.paints.find(({ name }) => name === 'first-contentful-paint');
  expect(ready.at).toBeLessThan(1000);
  expect(firstContentfulPaint.startTime).toBeGreaterThanOrEqual(ready.at);
  expect(firstContentfulPaint.startTime).toBeLessThan(1000);
  await expect(page.locator('#app-boot')).toHaveCount(0);
});

for (const colorScheme of ['light', 'dark']) {
  test(`delayed entry states the wait and recovers in ${colorScheme} system colors`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await recordTimeline(page);
    const release = await holdAssets(page);
    try {
      const url = `${origin}${BASE}?loading=1#schedule`;
      await page.goto(url, { waitUntil: 'commit' });
      const status = page.locator('#app-boot [role="status"]');
      await expect(status).toHaveText('Opening this site…');
      await expect(status).toHaveAttribute('aria-live', 'polite');
      await expect(status).toHaveAttribute('aria-atomic', 'true');
      await expect(page.locator('#app-boot svg, #app-boot img, #app-boot canvas')).toHaveCount(0);
      const initialTop = await status.evaluate((element) => element.getBoundingClientRect().top);
      const colors = await page.locator('#app-boot').evaluate((element) => {
        const style = globalThis.getComputedStyle(element);
        return { text: style.color, background: style.backgroundColor, animation: style.animationName, font: style.fontFamily };
      });
      const luminance = (color) => color.match(/[\d.]+/g).slice(0, 3).map(Number)
        .map((channel) => channel / 255)
        .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
        .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
      const levels = [luminance(colors.text), luminance(colors.background)].sort((a, b) => a - b);
      expect((levels[1] + 0.05) / (levels[0] + 0.05)).toBeGreaterThanOrEqual(4.5);
      expect(colors.animation).toBe('none');
      expect(colors.font).toContain('system-ui');
      await page.screenshot({ path: path.join(EVIDENCE, `app-boot-${colorScheme}-opening.png`) });
      await expect(page.getByRole('button', { name: 'Reload this page' })).toBeVisible();
      await expect(status).toContainText('taking longer than usual');
      expect(await status.evaluate((element) => element.getBoundingClientRect().top)).toBe(initialTop);
      await page.screenshot({ path: path.join(EVIDENCE, `app-boot-${colorScheme}-slow.png`) });
      const delayed = await evidence(page, `${colorScheme}-delayed`, { colors });
      const line = delayed.changes.find(({ text }) => text);
      const reload = delayed.changes.find((state) => state.reload);
      expect(line.at).toBeGreaterThanOrEqual(990);
      expect(line.at).toBeLessThan(1800);
      expect(reload.at).toBeGreaterThanOrEqual(9990);
      expect(reload.at).toBeLessThan(11000);
      if (colorScheme === 'dark') {
        // The plain button reloads this prefixed URL, including query/hash.
        // Keep the original entry held until the press actually navigates.
        const onNavigation = (request) => {
          if (request.isNavigationRequest()) release.entry();
        };
        page.on('request', onNavigation);
        await page.getByRole('button', { name: 'Reload this page' }).click();
        page.off('request', onNavigation);
        await expect(page).toHaveURL(url);
        await expect(page.locator('.loading-state')).toBeVisible();
        expect(await page.evaluate(() => performance.getEntriesByType('navigation')[0].type)).toBe('reload');
      } else {
        release.entry();
        await expect(page.getByRole('status', { name: 'Opening the page…' })).toBeVisible();
        await expect(page.locator('.loading-state')).toHaveAttribute('data-loading-stage', 'slow');
        const handoff = await evidence(page, 'handoff', { colors });
        const firstReact = handoff.changes.find(({ stage }) => stage);
        expect(firstReact.stage).toBe('slow');
        expect(handoff.changes.filter(({ at }) => at >= line.at).every((state) => state.text || state.stage)).toBe(true);
      }
      await expect(page.locator('#app-boot')).toHaveCount(0);
      await page.evaluate(() => globalThis.finishBootFixture());
      await expect(page.getByRole('heading', { name: 'Page ready' })).toBeVisible();
      await expect(page.getByRole('status')).toHaveCount(0);
    } finally {
      release.entry();
      release.css();
    }
  });
}

test('a blocking production stylesheet delays the fallback paint too', async ({ page }) => {
  await recordTimeline(page);
  const release = await holdAssets(page, { css: true });
  try {
    await page.goto(`${origin}${BASE}`, { waitUntil: 'commit' });
    await page.waitForFunction(() => performance.now() >= 1500);
    const blocked = await page.evaluate(() => ({
      paints: performance.getEntriesByType('paint').map(({ name, startTime }) => ({ name, startTime })),
      elapsed: performance.now(),
    }));
    expect(blocked.paints).toEqual([]);
    release.css();
    await expect(page.locator('#app-boot [role="status"]')).toHaveText('Opening this site…');
    await expect.poll(() => page.evaluate(() => globalThis.bootTimeline.paints.length)).toBeGreaterThan(0);
    const timeline = await evidence(page, 'stylesheet', { blocked });
    expect(timeline.paints.find(({ name }) => name === 'first-contentful-paint').startTime).toBeGreaterThanOrEqual(blocked.elapsed);
    release.entry();
    await expect(page.getByRole('heading', { name: 'Page ready' })).toBeVisible();
  } finally {
    release.entry();
    release.css();
  }
});
