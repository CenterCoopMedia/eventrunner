#!/usr/bin/env node

/**
 * Hosted browser verification for the public marketing site and user guides.
 * Serves only the Pages allowlist, on loopback under the committed path base.
 * No live service, browser download, emulator, account, or production write.
 * Run after build-demo in the existing hosted demo job.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import publicFiles from '../lib/pages-public-files.cjs';
import manifestModule from '../lib/pages-manifest.cjs';
import siteModule from '../lib/pages-site.cjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DOCS = path.join(ROOT, 'docs');
const OUT = path.join(ROOT, 'test-results/public-site-evidence');
const SITE = siteModule.pagesSite({});
const { LEGACY_PAGES, REPO_BLOB } = manifestModule;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.mp4': 'video/mp4',
};
const VIEWS = [
  { width: 1440, height: 1000, label: 'desktop' },
  { width: 390, height: 844, label: 'phone' },
  { width: 320, height: 844, label: 'narrow' },
];
const PAGES = [
  ['', 'home'], ['features/', 'features'], ['how-it-works/', 'how-it-works'],
  ['project/', 'about'], ['support/', 'support'], ['videos/', 'videos'],
  ['privacy/', 'privacy'], ['terms-of-service/', 'terms'], ['docs/', 'guides'],
  ['docs/handbook/for-attendees/', 'attendee-guide'],
];

function assetFor(pathname) {
  if (!pathname.startsWith(SITE.base)) return null;
  let name;
  try { name = decodeURIComponent(pathname.slice(SITE.base.length)); }
  catch { return null; }
  if (!name || name.endsWith('/')) name += 'index.html';
  if (name.includes('\\') || name.split('/').some((part) => !part || part === '.' || part === '..')) return null;
  if (!publicFiles.isPublicFile(name)) return null;
  const filename = path.join(DOCS, ...name.split('/'));
  if (!fs.existsSync(filename)) return null;
  // A public filename must not grant access through a symlink in any segment.
  let current = DOCS;
  for (const part of name.split('/')) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) return null;
  }
  if (!fs.statSync(filename).isFile()) return null;
  return { filename, contentType: MIME[path.extname(name)] || 'application/octet-stream' };
}

async function serve() {
  const server = http.createServer((request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
    const asset = assetFor(new URL(request.url, 'http://127.0.0.1').pathname);
    if (!asset) { response.writeHead(404).end('Not found'); return; }
    response.writeHead(200, {
      'content-type': asset.contentType,
      'content-length': fs.statSync(asset.filename).size,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    });
    if (request.method === 'HEAD') response.end();
    else fs.createReadStream(asset.filename).pipe(response);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function ready(page, { javaScriptEnabled = true } = {}) {
  if (!javaScriptEnabled) {
    // Page callbacks such as requestAnimationFrame do not reliably run when
    // scripts are disabled. Poll from Node, using only synchronous DOM reads.
    await page.evaluate(() => {
      for (const image of globalThis.document.images) image.loading = 'eager';
    });
    await expect.poll(() => page.evaluate(() => ({
      fonts: globalThis.document.fonts.status,
      pendingImages: [...globalThis.document.images]
        .filter((image) => !image.complete || image.naturalWidth === 0)
        .map((image) => image.currentSrc || image.src),
    })), { timeout: 8000, message: 'The no-JavaScript page must finish loading its fonts and images' })
      .toEqual({ fonts: 'loaded', pendingImages: [] });
    return;
  }
  await page.evaluate(async () => {
    await globalThis.document.fonts.ready;
    // Full-page captures include content below the viewport. Ask the browser
    // to load and decode those images before checking their rendered layout.
    const images = [...globalThis.document.images];
    for (const image of images) image.loading = 'eager';
    await Promise.all(images.map((image) => image.decode()));
    await new Promise((resolve) => globalThis.requestAnimationFrame(resolve));
  });
}

async function checkLayout(page) {
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Skip to content', exact: true })).toHaveAttribute('href', '#main');
  const dimensions = await page.evaluate(() => {
    const doc = globalThis.document;
    return {
      width: globalThis.innerWidth,
      scrollWidth: Math.max(doc.documentElement.scrollWidth, doc.body.scrollWidth),
      background: globalThis.getComputedStyle(doc.body).backgroundColor,
    };
  });
  assert.ok(dimensions.scrollWidth <= dimensions.width + 1, `Horizontal overflow: ${dimensions.scrollWidth}px in ${dimensions.width}px viewport`);
  return dimensions;
}

const checkedLinks = new Set();
async function checkLocalLinks(page, origin) {
  const links = await page.evaluate(() => [
    ...[...globalThis.document.querySelectorAll('a[href]')].map((element) => ({ url: element.href, anchor: true })),
    ...[...globalThis.document.querySelectorAll('script[src], img[src], source[src], link[rel="stylesheet"]')]
      .map((element) => ({ url: element.src || element.href, anchor: false })),
    ...[...globalThis.document.querySelectorAll('video[poster]')]
      .map((element) => ({ url: element.poster, anchor: false })),
  ]);
  for (const link of links) {
    const url = new URL(link.url, page.url());
    if (![origin, SITE.origin].includes(url.origin)) continue;
    assert.ok(url.pathname.startsWith(SITE.base), `Local URL escapes site base: ${url.pathname}`);
    const local = `${origin}${url.pathname}${url.search}`;
    const key = `${local}${link.anchor ? url.hash : ''}`;
    if (checkedLinks.has(key)) continue;
    const response = await fetch(local, { method: 'HEAD' });
    assert.ok(response.ok, `Local link/resource returned ${response.status}: ${url.pathname}`);
    if (link.anchor && url.hash && !url.pathname.startsWith(SITE.demoBase)) {
      const found = await page.evaluate(async ({ target, fragment }) => {
        const html = await (await globalThis.fetch(target)).text();
        const doc = new globalThis.DOMParser().parseFromString(html, 'text/html');
        return Boolean(doc.getElementById(decodeURIComponent(fragment)));
      }, { target: local, fragment: url.hash.slice(1) });
      assert.ok(found, `Missing local anchor: ${url.pathname}${url.hash}`);
    }
    checkedLinks.add(key);
  }
}

async function checkExample(page) {
  const example = page.locator('[data-event-example]');
  const savedFilter = example.locator('[data-saved-filter]');
  const firstSave = example.locator('[data-session="listen"] .save-session');
  const secondSave = example.locator('[data-session="practice"] .save-session');
  await expect(example.locator('.example-controls')).toBeVisible();
  await example.getByRole('button', { name: 'Save Listening to your community', exact: true }).press('Enter');
  await expect(firstSave).toHaveAttribute('aria-pressed', 'true');
  await expect(firstSave).toHaveAccessibleName('Save Listening to your community');
  await expect(example.locator('[data-save-count]')).toHaveText('1');
  await example.getByRole('button', { name: 'Day two', exact: true }).click();
  await expect(example.locator('[data-day="one"]')).toBeHidden();
  await example.getByRole('button', { name: 'Save Put the ideas into practice', exact: true }).click();
  await expect(secondSave).toHaveAttribute('aria-pressed', 'true');
  await expect(example.locator('[data-save-count]')).toHaveText('2');
  await savedFilter.click();
  await expect(savedFilter).toHaveAttribute('aria-pressed', 'true');
  await expect(savedFilter).toHaveAccessibleName('My schedule, 2 saved sessions');
  await expect(example.locator('[data-session]:visible')).toHaveCount(2);
  await expect(example.locator('[data-day="one"]')).toBeVisible();
  await expect(example.locator('[data-day="two"]')).toBeVisible();
  await firstSave.press('Enter');
  await expect(firstSave).toHaveAttribute('aria-pressed', 'false');
  // Removing a saved row hides it from both the screen and accessibility tree.
  await expect(firstSave).toHaveAttribute('aria-label', 'Save Listening to your community');
  await expect(savedFilter).toBeFocused();
  await expect(example.locator('[data-session="listen"]')).toBeHidden();
  await expect(example.locator('[data-save-count]')).toHaveText('1');
  await secondSave.press('Enter');
  await expect(secondSave).toHaveAttribute('aria-pressed', 'false');
  await expect(savedFilter).toBeFocused();
  await expect(example.locator('[data-example-empty]')).toBeVisible();
  await expect(example.locator('[data-session]:visible')).toHaveCount(0);
  await savedFilter.press('Enter');
  await expect(savedFilter).toHaveAttribute('aria-pressed', 'false');
  await expect(example.locator('[data-day="two"]')).toBeVisible();
  await expect(example.locator('[data-example-empty]')).toBeHidden();
  await example.getByRole('button', { name: 'Day one', exact: true }).click();
  await expect(firstSave).toBeVisible();
  await expect(firstSave).toHaveAccessibleName('Save Listening to your community');
}

async function checkSearch(page) {
  const input = page.getByRole('searchbox', { name: 'Find a guide', exact: true });
  const entries = page.locator('[data-guide-entry]');
  const total = await entries.count();
  assert.ok(total > 0);
  await input.fill('Manage your sessions');
  await expect(page.locator('[data-guide-entry]:visible')).toHaveCount(1);
  await expect(page.locator('[data-guide-entry]:visible')).toContainText('Manage your sessions');
  // "privately" appears in the description, not its guide title.
  await input.fill('privately');
  await expect(page.locator('[data-guide-entry]:visible')).toHaveCount(1);
  await expect(page.locator('[data-guide-entry]:visible')).toContainText('Report a security concern');
  await input.fill('tickets');
  await expect(page.locator('[data-guide-entry]:visible')).toHaveCount(1);
  await expect(page.locator('[data-guide-entry]:visible')).toContainText('Admin guide');
  await input.fill('no-such-guide-73821');
  await expect(page.locator('[data-guide-entry]:visible')).toHaveCount(0);
  await expect(page.locator('[data-guide-search-status]')).toContainText('No guides match');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  await expect(page.locator('[data-guide-entry]:visible')).toHaveCount(total);
  await expect(page.locator('[data-guide-starts]')).toBeVisible();
  await expect(page.locator('[data-guide-entry]')).not.toContainText(['ADR 0001']);
}

async function main() {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') {
    throw new Error('Run this check only in GitHub-hosted CI, as required by AGENTS.md.');
  }
  fs.mkdirSync(OUT, { recursive: true });
  const report = {
    status: 'running', createdAt: new Date().toISOString(),
    sha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    basePath: SITE.base, controls: { chromiumSandbox: true, externalNetwork: 'blocked', serviceWorkers: 'blocked' },
    checks: [],
  };
  const save = () => fs.writeFileSync(path.join(OUT, 'manifest.json'), `${JSON.stringify(report, null, 2)}\n`);
  save();
  let browser;
  let server;
  try {
    server = await serve();
    browser = await chromium.launch({ chromiumSandbox: true });
    report.browser = { name: 'Chromium', version: browser.version() };
    const run = async (name, view, mode, action, options = {}) => {
      const record = {
        name, viewport: { width: view.width, height: view.height }, colorScheme: mode,
        javaScriptEnabled: options.javaScriptEnabled !== false, errors: [],
      };
      const context = await browser.newContext({
        viewport: record.viewport, colorScheme: mode, deviceScaleFactor: 1,
        reducedMotion: options.reducedMotion || 'no-preference',
        javaScriptEnabled: options.javaScriptEnabled !== false, serviceWorkers: 'block',
      });
      await context.routeWebSocket('**/*', (socket) => socket.close());
      await context.route('**/*', (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin === server.origin && ['GET', 'HEAD'].includes(request.method())) return route.continue();
        // Absolute canonical site links still use this checkout's exact bytes.
        const asset = url.origin === SITE.origin && ['GET', 'HEAD'].includes(request.method()) ? assetFor(url.pathname) : null;
        if (asset) return route.fulfill({ status: 200, contentType: asset.contentType, body: fs.readFileSync(asset.filename) });
        record.errors.push(`Blocked external request: ${url.origin}${url.pathname}`);
        return route.abort('blockedbyclient');
      });
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      page.setDefaultNavigationTimeout(15000);
      page.on('pageerror', (error) => record.errors.push(error.message));
      page.on('response', (response) => {
        if (response.status() >= 400) record.errors.push(`HTTP ${response.status()}: ${new URL(response.url()).pathname}`);
      });
      try {
        await action(page, record);
        if (options.screenshot) {
          record.screenshot = `${name}.png`;
          await page.screenshot({ path: path.join(OUT, record.screenshot), fullPage: true });
        }
      } catch (error) {
        record.errors.push(error.message);
        record.failure = { url: page.url(), stack: error.stack || error.message };
        record.screenshot = `${name}--failure.png`;
        await page.screenshot({ path: path.join(OUT, record.screenshot), fullPage: true }).catch(() => {});
      } finally {
        await context.close();
        record.passed = record.errors.length === 0;
        report.checks.push(record);
        save();
        console.log(`${record.passed ? 'PASS' : 'FAIL'} ${name}`);
      }
    };
    const visit = async (page, route, options = {}) => {
      const response = await page.goto(`${server.origin}${SITE.base}${route}`, { waitUntil: 'load' });
      assert.equal(response.status(), 200, `Page did not load: ${route || '/'}`);
      await ready(page, options);
    };

    for (const view of VIEWS) {
      for (const mode of ['light', 'dark']) {
        for (const [route, label] of PAGES) {
          const screenshot = ['home', 'guides'].includes(label)
            || (mode === 'light' && view.width !== 320);
          await run(`${label}--${view.label}--${mode}`, view, mode, async (page, record) => {
            await visit(page, route);
            record.layout = await checkLayout(page);
            await checkLocalLinks(page, server.origin);
          }, { screenshot });
        }
      }
    }

    for (const view of VIEWS.slice(0, 2)) {
      await run(`example-interactions--${view.label}`, view, 'light', async (page) => {
        await visit(page, '');
        await checkExample(page);
        await checkLayout(page);
      });
      await run(`guide-search--${view.label}`, view, 'light', async (page) => {
        await visit(page, 'docs/');
        await checkSearch(page);
        await checkLayout(page);
      });
    }
    await run('guide-mobile-navigation', VIEWS[1], 'dark', async (page) => {
      await visit(page, 'docs/handbook/for-attendees/');
      const disclosure = page.locator('[data-docs-navigation]');
      await expect(disclosure).not.toHaveAttribute('open', '');
      await disclosure.locator('summary').press('Enter');
      await expect(disclosure).toHaveAttribute('open', '');
      const current = disclosure.locator('a[aria-current="page"]');
      await expect(current).toHaveCount(1);
      await expect(current).toHaveAttribute('href', `${SITE.docsBase}handbook/for-attendees/`);
      await expect(current).toBeVisible();
      await checkLayout(page);
    }, { screenshot: true });

    await run('engineering-bookmark-handoffs', VIEWS[0], 'light', async (page) => {
      for (const legacy of LEGACY_PAGES) {
        await visit(page, `docs/${legacy.route}`);
        await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /\bnoindex\b/);
        await expect(page.getByRole('link', { name: 'Read this document on GitHub', exact: true })).toHaveAttribute('href', `${REPO_BLOB}${legacy.source}`);
        await expect(page.locator('[data-guide-entry], [data-docs-navigation]')).toHaveCount(0);
        await checkLayout(page);
      }
    });

    await run('reduced-motion', VIEWS[1], 'dark', async (page) => {
      await visit(page, '');
      await checkExample(page);
      const motion = await page.evaluate(() => ({
        requested: globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches,
        active: globalThis.document.getAnimations().filter((animation) => animation.playState === 'running').length,
        transitions: [...globalThis.document.querySelectorAll('button, .btn')].map((element) => globalThis.getComputedStyle(element).transitionDuration),
      }));
      assert.equal(motion.requested, true);
      assert.equal(motion.active, 0, 'Reduced-motion view must have no running animations');
      assert.ok(motion.transitions.every((value) => value.split(',').every((duration) => parseFloat(duration) === 0)), 'Reduced-motion controls must have no transition duration');
    }, { reducedMotion: 'reduce' });

    await run('javascript-off-reading', VIEWS[1], 'light', async (page) => {
      await visit(page, '', { javaScriptEnabled: false });
      await expect(page.locator('[data-event-example] [data-session]:visible')).toHaveCount(5);
      await expect(page.locator('.example-controls')).toBeHidden();
      await checkLayout(page);
      await visit(page, 'docs/', { javaScriptEnabled: false });
      await expect(page.locator('[data-guide-search-form]')).toBeHidden();
      await expect(page.locator('[data-guide-entry]:visible')).toHaveCount(manifestModule.pagesInOrder().length);
      await checkLayout(page);
      await visit(page, 'docs/handbook/for-attendees/', { javaScriptEnabled: false });
      const disclosure = page.locator('[data-docs-navigation]');
      await expect(disclosure).toHaveAttribute('open', '');
      await expect(disclosure.locator('a[aria-current="page"]')).toBeVisible();
      await checkLayout(page);
    }, { javaScriptEnabled: false, screenshot: true });

    const homeLight = report.checks.find((entry) => entry.name === 'home--desktop--light');
    const homeDark = report.checks.find((entry) => entry.name === 'home--desktop--dark');
    if (homeLight?.layout && homeDark?.layout) {
      assert.notEqual(homeLight.layout.background, homeDark.layout.background, 'The page must respond to the system display mode');
    }
    report.checkedLocalLinksAndResources = checkedLinks.size;
    report.status = report.checks.every((entry) => entry.passed) ? 'passed' : 'failed';
  } catch (error) {
    report.status = 'failed';
    report.error = error.message;
  } finally {
    if (browser) await browser.close();
    if (server) await server.close();
    report.finishedAt = new Date().toISOString();
    save();
  }
  console.log(`Public site: ${report.status}; ${report.checks.filter((entry) => entry.passed).length}/${report.checks.length} checks; ${path.relative(ROOT, OUT)}`);
  return report.status === 'passed' ? 0 : 1;
}

main().then((code) => { process.exitCode = code; }).catch((error) => {
  console.error(`check-public-site: ${error.message}`);
  process.exitCode = 1;
});
