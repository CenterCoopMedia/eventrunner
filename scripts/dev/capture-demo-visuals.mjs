#!/usr/bin/env node

/**
 * Reproducible, read-only public demo evidence from committed Git objects.
 *
 * node scripts/dev/capture-demo-visuals.mjs --base <PR-base-SHA> --out <directory>
 * Add --plan to verify sources and list the matrix without starting a browser.
 * DEMO_VISUAL_BASE_SHA supplies --base in CI. A manual run without a base
 * records after-only evidence explicitly; a PR run must name its base.
 *
 * A focused 51-image comparison: 12 before and 39 after. Newsroom/light Home
 * and ordinary/preview Program cover all four widths on both sources. After
 * adds every preset/mode on phone and desktop without repeating baseline
 * tuples, plus five Menu/settings/filters/no-results interaction captures.
 * Viewport-only PNGs retain the actual first-screen composition. The manifest reports
 * overflow, images, requests and first-session geometry; these diagnostics
 * supplement, and never weaken or replace, the existing browser assertions.
 *
 * Only docs/demo blobs from base and checked-out HEAD are served, on loopback.
 * No checkout, build, emulator, credentials, deploy or live website is used.
 * Exact canonical demo asset URLs are fulfilled from the same Git snapshot;
 * every other external request and every WebSocket is blocked. Fullscreen is
 * denied by Permissions-Policy so the app's real in-page preview fallback
 * keeps the requested viewport. Chromium's sandbox remains enabled. The
 * script uses the installed browser and never downloads or installs one.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_STYLES } from './capture-specimen.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const WIDTHS = Object.freeze([485, 639, 640, 1165]);
export const HEIGHT = 900;
export const MODES = Object.freeze(['light', 'dark']);
export const BASE_PATH = '/eventrunner/demo/';
export const CANONICAL_ORIGIN = 'https://centercoopmedia.github.io';
export const NO_RESULTS_QUERY = 'visual-no-session-match-398399';
const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

export function parseArgs(argv, env = process.env) {
  const options = { base: env.DEMO_VISUAL_BASE_SHA || null, out: null, plan: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--plan') options.plan = true;
    else if (flag === '--help') options.help = true;
    else if (flag === '--base' || flag === '--out') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
      options[flag.slice(2)] = value;
    } else throw new Error(`Unknown option: ${flag}`);
  }
  if (options.help) return options;
  if (options.base && !SHA.test(options.base)) throw new Error('--base must be a full commit SHA');
  if (env.GITHUB_EVENT_NAME === 'pull_request' && !options.base) throw new Error('PR capture requires its base SHA');
  if (!options.out && !options.plan) throw new Error('--out is required');
  return options;
}

/** Baseline preview follows ordinary; expanded after-only cases each reload. */
export function captureMatrix(source = 'after') {
  if (!['before', 'after'].includes(source)) throw new Error('Unknown capture source');
  return WIDTHS.flatMap((width) => {
    const base = { width, height: HEIGHT, preset: 'newsroom', mode: 'light', route: 'program', presentation: 'ordinary', state: 'default' };
    const baseline = [{ ...base, route: 'home' }, base, { ...base, presentation: 'preview' }];
    if (source === 'before') return baseline;
    const extremes = width === 485 || width === 1165;
    const themes = extremes ? DEFAULT_STYLES.flatMap((preset) => MODES
      .filter((mode) => preset !== 'newsroom' || mode !== 'light')
      .map((mode) => ({ ...base, preset, mode }))) : [];
    const states = [
      ...(width === 485 ? ['menu-open', 'demo-settings-open', 'filters-open'] : []),
      ...(extremes ? ['no-results'] : []),
    ].map((state) => ({ ...base, state }));
    return [...baseline, ...themes, ...states];
  });
}

export function captureName(shot) {
  const state = shot.state && shot.state !== 'default' ? `--${shot.state}` : '';
  return `${shot.route}--${shot.preset}--${shot.mode}--${shot.width}x${shot.height}--${shot.presentation}${state}.png`;
}

export function captureUrl(origin, shot) {
  return `${origin}${BASE_PATH}?style=${shot.preset}&mode=${shot.mode}#/${shot.route === 'program' ? 'schedule' : ''}`;
}

/** ls-tree is parsed before serving; symlinks and non-blob entries are refused. */
export function parseTreeEntries(output) {
  const entries = new Map();
  for (const entry of output.toString('utf8').split('\0').filter(Boolean)) {
    const match = /^(100644|100755) blob ([0-9a-f]{40}(?:[0-9a-f]{24})?)\t(.+)$/s.exec(entry);
    if (!match) throw new Error('Demo snapshot contains an unsupported Git entry');
    const [, , blob, name] = match;
    if (name.startsWith('/') || name.includes('\\') || name.split('/').some((part) => !part || part === '.' || part === '..')) {
      throw new Error('Demo snapshot contains an unsafe path');
    }
    entries.set(name, blob);
  }
  if (!entries.has('index.html')) throw new Error('Committed docs/demo/index.html is missing');
  return entries;
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 });
}

export function readSnapshot(revision, label, runGit = git) {
  if (revision !== 'HEAD' && !SHA.test(revision)) throw new Error('Snapshot must be HEAD or a full commit SHA');
  const sha = runGit(['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`]).toString().trim();
  if (!SHA.test(sha)) throw new Error('Git returned an invalid source SHA');
  const treeSha = runGit(['rev-parse', '--verify', `${sha}:docs/demo`]).toString().trim();
  if (!SHA.test(treeSha)) throw new Error('Git returned an invalid demo tree SHA');
  const entries = parseTreeEntries(runGit(['ls-tree', '-r', '-z', `${sha}:docs/demo`]));
  const cache = new Map();
  return {
    label, sha, treeSha, fileCount: entries.size,
    read(name) {
      const blob = entries.get(name);
      if (!blob) return null;
      if (!cache.has(blob)) cache.set(blob, runGit(['cat-file', 'blob', blob]));
      return { body: cache.get(blob), contentType: MIME[path.extname(name)] || 'application/octet-stream' };
    },
  };
}

/** Accept only this snapshot's loopback origin or the exact canonical demo. */
export function requestDecision(rawUrl, localOrigin, method = 'GET') {
  if (method !== 'GET' && method !== 'HEAD') return { kind: 'blocked' };
  let url;
  try { url = new URL(rawUrl); } catch { return { kind: 'blocked' }; }
  const local = url.origin === localOrigin;
  if (!local && url.origin !== CANONICAL_ORIGIN) return { kind: 'blocked' };
  if (!url.pathname.startsWith(BASE_PATH)) return { kind: 'blocked' };
  let name;
  try { name = decodeURIComponent(url.pathname.slice(BASE_PATH.length)) || 'index.html'; }
  catch { return { kind: 'blocked' }; }
  if (name.includes('\\') || name.split('/').some((part) => !part || part === '.' || part === '..')) return { kind: 'blocked' };
  return { kind: local ? 'local' : 'snapshot-alias', name };
}

function headersFor(contentType) {
  return {
    'content-type': contentType, 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'permissions-policy': 'fullscreen=(), camera=(), microphone=(), geolocation=()',
    'access-control-allow-origin': '*',
  };
}

export async function serveSnapshot(snapshot) {
  let origin;
  const server = http.createServer((request, response) => {
    const decision = requestDecision(`${origin}${request.url}`, origin, request.method);
    const asset = decision.kind === 'local' ? snapshot.read(decision.name) : null;
    if (!asset) { response.writeHead(404).end('Not found'); return; }
    response.writeHead(200, headersFor(asset.contentType));
    response.end(request.method === 'HEAD' ? undefined : asset.body);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, close: () => new Promise((resolve) => server.close(resolve)) };
}

/** Avoid persisting request query strings in diagnostics. */
function requestLabel(rawUrl) {
  try { const url = new URL(rawUrl); return `${url.origin}${url.pathname}`; }
  catch { return 'invalid URL'; }
}

async function settlePage(page, shot) {
  await page.waitForFunction(({ preset, mode }) => (
    globalThis.document.documentElement.dataset.theme === preset &&
    globalThis.document.documentElement.dataset.mode === mode
  ), shot);
  if (shot.state === 'no-results') {
    await page.getByText(new RegExp(`No sessions on .+ match “${NO_RESULTS_QUERY}”`)).waitFor();
  } else {
    await page.locator(shot.route === 'program' ? '.session-block, .schedule-grid__entry' : '.event-hero__title').first().waitFor();
  }
  await page.evaluate(async () => {
    await globalThis.document.fonts.ready;
    await new Promise((resolve) => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve)));
    globalThis.scrollTo(0, 0);
  });
  await page.waitForFunction(() => [...globalThis.document.images].every((img) => {
    const box = img.getBoundingClientRect();
    return box.bottom <= 0 || box.top >= globalThis.innerHeight || img.complete;
  }));
}

async function applyCaptureState(page, shot) {
  if (shot.state === 'menu-open') {
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('navigation', { name: 'Main' }).waitFor();
  } else if (shot.state === 'demo-settings-open') {
    await page.getByRole('button', { name: 'Demo settings', exact: true }).click();
    await page.getByLabel('Site style', { exact: true }).waitFor();
  } else if (shot.state === 'filters-open') {
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    await page.locator('.schedule-facets').waitFor();
  } else if (shot.state === 'no-results') {
    await page.getByRole('searchbox', { name: 'Search this day', exact: true }).fill(NO_RESULTS_QUERY);
  }
}

async function measurePage(page) {
  return page.evaluate((noResultsQuery) => {
    const doc = globalThis.document;
    const box = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
    };
    const viewport = {
      width: globalThis.innerWidth, height: globalThis.innerHeight,
      clientWidth: doc.documentElement.clientWidth, scrollWidth: doc.documentElement.scrollWidth,
      scrollHeight: doc.documentElement.scrollHeight, deviceScaleFactor: globalThis.devicePixelRatio,
      scrollX: globalThis.scrollX, scrollY: globalThis.scrollY,
    };
    const images = [...doc.images].map((img) => ({
      // Public, committed demo assets only; omit query strings.
      src: (img.currentSrc || img.src).split('?')[0], alt: img.alt,
      complete: img.complete, naturalWidth: img.naturalWidth, box: box(img),
    }));
    const firstSession = box(doc.querySelector('.session-block, .schedule-grid__entry'));
    const settings = [...doc.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Demo settings');
    return {
      viewport, theme: doc.documentElement.dataset.theme, mode: doc.documentElement.dataset.mode,
      presentation: [...doc.querySelectorAll('button')].some((button) => button.textContent.trim() === 'Exit preview') ? 'preview' : 'ordinary',
      nativeFullscreen: Boolean(doc.fullscreenElement),
      overflow: {
        horizontal: viewport.scrollWidth > viewport.clientWidth,
        pixels: Math.max(0, viewport.scrollWidth - viewport.clientWidth),
      },
      missingImages: images.filter((img) => img.complete && img.naturalWidth === 0),
      pendingImages: images.filter((img) => !img.complete),
      firstSession,
      scheduleView: doc.querySelector('.schedule-grid') ? 'grid'
        : doc.querySelector('.session-block') ? 'list'
          : doc.querySelector('.schedule-screen') ? 'empty' : null,
      firstSessionInViewport: firstSession ? firstSession.y < viewport.height && firstSession.bottom > 0 : null,
      hero: box(doc.querySelector('.event-hero')),
      menu: box(doc.querySelector('.site-header-menu')),
      search: box(doc.querySelector('input[type="search"]')),
      searchValue: doc.querySelector('input[type="search"]')?.value || '',
      disclosures: {
        menu: doc.querySelector('.site-header-menu')?.getAttribute('aria-expanded') || null,
        demoSettings: settings?.getAttribute('aria-expanded') || null,
        filters: doc.querySelector('.schedule-filters-toggle')?.getAttribute('aria-expanded') || null,
      },
      noResults: [...doc.querySelectorAll('.schedule-screen p')].some((element) => (
        element.textContent.startsWith('No sessions on ') && element.textContent.includes(noResultsQuery)
      )),
    };
  }, NO_RESULTS_QUERY);
}

/** Capture creation must be trustworthy; visual findings stay explicit data. */
export function validateCapture(shot, metrics) {
  const errors = [];
  if (metrics.viewport.width !== shot.width || metrics.viewport.height !== shot.height) errors.push('actual viewport differs from requested viewport');
  if (metrics.theme !== shot.preset || metrics.mode !== shot.mode) errors.push('rendered preset or mode differs from requested display');
  if (metrics.presentation !== shot.presentation) errors.push('rendered preview state differs from requested state');
  if (metrics.nativeFullscreen) errors.push('native fullscreen changed the controlled capture');
  if (shot.route === 'program' && shot.state !== 'no-results' && !metrics.firstSession) errors.push('Program has no first session');
  const disclosure = { 'menu-open': 'menu', 'demo-settings-open': 'demoSettings', 'filters-open': 'filters' }[shot.state];
  if (disclosure && metrics.disclosures?.[disclosure] !== 'true') errors.push('requested disclosure is not expanded');
  if (shot.state === 'no-results' && (!metrics.noResults || metrics.searchValue !== NO_RESULTS_QUERY || metrics.firstSession)) {
    errors.push('requested no-results search state was not reached');
  }
  return errors;
}

async function captureSource(browser, snapshot, out, manifest, saveManifest) {
  const server = await serveSnapshot(snapshot);
  const matrix = captureMatrix(snapshot.label);
  fs.mkdirSync(path.join(out, snapshot.label));
  try {
    for (const width of WIDTHS) {
      const context = await browser.newContext({
        viewport: { width, height: HEIGHT }, screen: { width, height: HEIGHT },
        deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC',
        reducedMotion: 'reduce', serviceWorkers: 'block', permissions: [],
      });
      let requests = { blocked: new Set(), aliases: new Set(), failed: new Set() };
      await context.route('**/*', async (route) => {
        const request = route.request();
        const decision = requestDecision(request.url(), server.origin, request.method());
        if (decision.kind === 'local') { await route.continue(); return; }
        if (decision.kind === 'snapshot-alias') {
          requests.aliases.add(requestLabel(request.url()));
          const asset = snapshot.read(decision.name);
          if (asset) { await route.fulfill({ body: asset.body, headers: headersFor(asset.contentType) }); return; }
        }
        requests.blocked.add(requestLabel(request.url()));
        await route.abort('blockedbyclient');
      });
      await context.routeWebSocket('**/*', (socket) => {
        requests.blocked.add(requestLabel(socket.url()));
        socket.close({ code: 1008, reason: 'External network is disabled for static demo capture' });
      });
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(15_000);
        page.setDefaultNavigationTimeout(30_000);
        let pageErrors = [];
        page.on('pageerror', (error) => pageErrors.push(error.message));
        page.on('response', (response) => {
          if (response.status() >= 400) requests.failed.add(`${response.status()} ${requestLabel(response.url())}`);
        });
        for (const shot of matrix.filter((item) => item.width === width)) {
          const record = {
            source: snapshot.label, sourceSha: snapshot.sha, demoTreeSha: snapshot.treeSha,
            ...shot, requestedViewport: { width, height: HEIGHT, deviceScaleFactor: 1 },
            file: `${snapshot.label}/${captureName(shot)}`,
          };
          try {
            if (shot.presentation === 'ordinary') {
              requests = { blocked: new Set(), aliases: new Set(), failed: new Set() };
              pageErrors = [];
              await page.goto(captureUrl(server.origin, shot), { waitUntil: 'load' });
              if (shot.state !== 'default') {
                await settlePage(page, { ...shot, state: 'default' });
                await applyCaptureState(page, shot);
              }
            } else {
              await page.getByRole('button', { name: 'Preview full screen', exact: true }).click();
              await page.getByRole('button', { name: 'Exit preview', exact: true }).waitFor();
            }
            await settlePage(page, shot);
            record.metrics = await measurePage(page);
            record.errors = validateCapture(shot, record.metrics);
            await page.screenshot({ path: path.join(out, record.file), fullPage: false, animations: 'disabled' });
            record.captured = true;
          } catch (error) {
            record.errors = [...(record.errors || []), error.message];
            record.captured = false;
          }
          record.network = Object.fromEntries(Object.entries(requests).map(([key, values]) => [key, [...values]]));
          record.pageErrors = [...pageErrors];
          manifest.captures.push(record);
          saveManifest();
          console.log(`${snapshot.label}: ${captureName(shot)} ${record.captured && record.errors.length === 0 ? 'captured' : 'FAILED'}`);
        }
      } finally { await context.close(); }
    }
  } finally { await server.close(); }
}

export async function main(argv, env = process.env) {
  const options = parseArgs(argv, env);
  if (options.help) {
    console.log('Usage: node scripts/dev/capture-demo-visuals.mjs [--base <full-SHA>] (--out <directory> | --plan)');
    return 0;
  }
  const snapshots = [
    ...(options.base ? [readSnapshot(options.base, 'before')] : []),
    readSnapshot('HEAD', 'after'),
  ];
  if (git(['status', '--porcelain', '--untracked-files=all', '--', 'docs/demo']).toString().trim()) {
    throw new Error('docs/demo has uncommitted changes; commit the intended source before capturing');
  }
  const manifest = {
    version: 1, status: options.plan ? 'plan-only' : 'running',
    createdAt: new Date().toISOString(),
    comparison: options.base ? 'PR base versus checked-out HEAD' : 'after-only; no baseline supplied',
    sources: snapshots.map(({ label, sha, treeSha, fileCount }) => ({ label, sha, demoTreeSha: treeSha, fileCount, expectedCaptures: captureMatrix(label).length })),
    prHeadSha: env.DEMO_VISUAL_HEAD_SHA || null,
    expectedCaptures: snapshots.reduce((count, snapshot) => count + captureMatrix(snapshot.label).length, 0),
    coverage: {
      widths: WIDTHS, height: HEIGHT,
      baseline: 'before/after newsroom/light: Home ordinary and Program ordinary/preview at all four widths',
      themeSamples: { source: 'after', route: 'program', presentation: 'ordinary', widths: [485, 1165], presets: DEFAULT_STYLES, modes: MODES, duplicateBaselineTuples: false },
      interactionSamples: { source: 'after', preset: 'newsroom', mode: 'light', route: 'program', at485: ['menu-open', 'demo-settings-open', 'filters-open', 'no-results'], at1165: ['no-results'] },
    },
    controls: { chromiumSandbox: true, serviceWorkers: 'blocked', externalNetwork: 'blocked; canonical demo asset aliases use same-snapshot blobs', preview: 'in-page fallback; native fullscreen denied by Permissions-Policy', screenshot: 'viewport only, device scale 1', visualDiagnostics: 'reported without changing existing E2E assertions' },
    captures: [],
  };
  if (options.plan) { console.log(JSON.stringify(manifest, null, 2)); return 0; }
  const out = path.resolve(options.out);
  if (fs.existsSync(out) && fs.readdirSync(out).length) throw new Error('Output directory must be empty so evidence cannot mix runs');
  fs.mkdirSync(out, { recursive: true });
  const saveManifest = () => fs.writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  saveManifest();
  let browser;
  try {
    const { chromium } = await import('@playwright/test');
    browser = await chromium.launch({ chromiumSandbox: true });
    manifest.browser = { name: 'Chromium', version: browser.version() };
    for (const snapshot of snapshots) await captureSource(browser, snapshot, out, manifest, saveManifest);
    manifest.status = manifest.captures.every((capture) => capture.captured && capture.errors.length === 0) ? 'captured' : 'incomplete';
    return manifest.status === 'captured' ? 0 : 1;
  } catch (error) {
    manifest.status = 'incomplete';
    manifest.error = error.message;
    return 1;
  } finally {
    manifest.finishedAt = new Date().toISOString();
    saveManifest();
    if (browser) await browser.close();
    console.log(`Demo evidence: ${manifest.status}; ${manifest.captures.filter((capture) => capture.captured).length}/${manifest.expectedCaptures} PNGs; ${path.join(out, 'manifest.json')}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(`capture-demo-visuals: ${error.message}`);
    process.exitCode = 1;
  });
}
