#!/usr/bin/env node
'use strict';

/**
 * Capture the specimen book in every site style and both display modes.
 *
 * The book (apps/web/src/pages/specimen/) draws every device the system
 * has. This script opens it once per (style, mode, width) and writes a
 * full-page PNG for each one, so review evidence is a command rather than a
 * one-off script somebody writes again next time.
 *
 * It needs a served build. Two ways to give it one:
 *
 *   --base-url <url>   a server you already started. The URL points at the
 *                      root of the built app, and the demo build uses a
 *                      hash router, so the book is at <url>#/specimen.
 *   --dist <dir>       a built directory. The script serves it itself on
 *                      --port and stops the server when it is done.
 *
 * Build the demo first, for example:
 *
 *   VITE_DEMO_MODE=1 npm run build -w apps/web -- \
 *     --base /eventrunner/demo/ --outDir /tmp/specimen-demo
 *   node scripts/dev/capture-specimen.mjs --dist /tmp/specimen-demo \
 *     --out docs/plans/evidence/specimen
 *
 * Options:
 *   --out <dir>        where the PNGs go. Required.
 *   --styles <list>    comma-separated style ids. Default: every style.
 *   --modes <list>     light, dark, or both. Default: both.
 *   --widths <list>    comma-separated viewport widths. Default: 1440,390.
 *   --only <id>        capture one section instead of the whole page. The
 *                      id is a section id, for example specimen-controls.
 *   --port <number>    the port --dist is served on. Default: 8901.
 *   --base-path <p>    the path the built app is served under. Default is
 *                      taken from the build's own base, /eventrunner/demo/.
 *   --scale <n>        device scale factor. Default: 1. The book is a long
 *                      page, so a full-page PNG at 1440 runs to about 2MB;
 *                      --scale 0.5 brings one under 1.5MB, and --only keeps
 *                      a section capture small at full scale.
 *   --timeout-ms <n>   per-page timeout. Default: 45000.
 *
 * Each file is named <style>--<mode>--<width>.png, and a section capture
 * adds the section: <style>--<mode>--<width>--<section>.png.
 *
 * Requires the `playwright` package and a Chromium binary through
 * PLAYWRIGHT_BROWSERS_PATH. It never runs `playwright install`: a missing
 * browser fails fast with a message rather than reaching for the network.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..');

/** The six site styles, in picker order. */
export const DEFAULT_STYLES = Object.freeze([
  'civic',
  'newsroom',
  'broadsheet',
  'atlas',
  'field-guide',
  'zine',
]);

export const DEFAULT_MODES = Object.freeze(['light', 'dark']);
export const DEFAULT_WIDTHS = Object.freeze([1440, 390]);
export const DEFAULT_BASE_PATH = '/eventrunner/demo/';
export const DEFAULT_PORT = 8901;

const CONTENT_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
});

/** Split a comma-separated option into trimmed, non-empty parts. */
export function splitList(value) {
  if (typeof value !== 'string') return [];
  return value.split(',').map((part) => part.trim()).filter(Boolean);
}

/**
 * Read the command line.
 *
 * @param {string[]} argv
 * @returns {{ ok: true, options: object } | { ok: false, error: string }}
 */
export function parseArgs(argv) {
  const options = {
    baseUrl: null,
    dist: null,
    out: null,
    styles: [...DEFAULT_STYLES],
    modes: [...DEFAULT_MODES],
    widths: [...DEFAULT_WIDTHS],
    only: null,
    port: DEFAULT_PORT,
    basePath: DEFAULT_BASE_PATH,
    scale: 1,
    timeoutMs: 45000,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = () => argv[i += 1];
    if (flag === '--help' || flag === '-h') options.help = true;
    else if (flag === '--base-url') options.baseUrl = next();
    else if (flag === '--dist') options.dist = next();
    else if (flag === '--out') options.out = next();
    else if (flag === '--styles') options.styles = splitList(next());
    else if (flag === '--modes') options.modes = splitList(next());
    else if (flag === '--widths') options.widths = splitList(next()).map(Number);
    else if (flag === '--only') options.only = next();
    else if (flag === '--port') options.port = Number(next());
    else if (flag === '--base-path') options.basePath = next();
    else if (flag === '--scale') options.scale = Number(next());
    else if (flag === '--timeout-ms') options.timeoutMs = Number(next());
    else return { ok: false, error: `unknown option ${flag}` };
  }
  if (options.help) return { ok: true, options };
  if (!options.out) return { ok: false, error: '--out is required' };
  if (!options.baseUrl && !options.dist) {
    return { ok: false, error: 'give either --base-url or --dist' };
  }
  if (options.baseUrl && options.dist) {
    return { ok: false, error: 'give --base-url or --dist, not both' };
  }
  if (options.styles.length === 0) return { ok: false, error: '--styles is empty' };
  if (options.modes.length === 0) return { ok: false, error: '--modes is empty' };
  const badMode = options.modes.find((mode) => !DEFAULT_MODES.includes(mode));
  if (badMode) return { ok: false, error: `unknown mode ${badMode}` };
  if (options.widths.some((width) => !Number.isFinite(width) || width <= 0)) {
    return { ok: false, error: '--widths takes positive numbers' };
  }
  if (!Number.isFinite(options.scale) || options.scale <= 0) {
    return { ok: false, error: '--scale takes a positive number' };
  }
  if (!options.basePath.endsWith('/')) options.basePath += '/';
  return { ok: true, options };
}

/**
 * The file name for one capture.
 *
 * @param {{ style: string, mode: string, width: number, section?: string|null }} shot
 * @returns {string}
 */
export function captureName({ style, mode, width, section = null }) {
  const stem = `${style}--${mode}--${width}`;
  return section ? `${stem}--${section}.png` : `${stem}.png`;
}

/**
 * The URL for one capture. The demo build routes on the hash, so the style
 * and the mode go in the query string ahead of the hash, which is where
 * DemoBanner reads them from.
 *
 * @param {{ baseUrl: string, style: string, mode: string }} args
 * @returns {string}
 */
export function captureUrl({ baseUrl, style, mode }) {
  const root = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${root}?style=${encodeURIComponent(style)}&mode=${encodeURIComponent(mode)}#/specimen`;
}

/** Serve one built directory under one base path. */
function serveDist({ dist, port, basePath }) {
  const root = path.resolve(dist);
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    let relative = url.pathname;
    if (relative.startsWith(basePath)) relative = relative.slice(basePath.length);
    relative = relative.replace(/^\/+/, '');
    if (relative === '') relative = 'index.html';
    const target = path.resolve(root, relative);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
      response.writeHead(403).end('forbidden');
      return;
    }
    const file = fs.existsSync(target) && fs.statSync(target).isFile()
      ? target
      : path.join(root, 'index.html');
    if (!fs.existsSync(file)) {
      response.writeHead(404).end('not found');
      return;
    }
    response.writeHead(200, {
      'content-type': CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream',
    });
    fs.createReadStream(file).pipe(response);
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch (error) {
    throw new Error(
      'playwright is not available. Install the workspace dependencies and set '
        + `PLAYWRIGHT_BROWSERS_PATH to an existing browser directory. (${error.message})`,
    );
  }
}

/**
 * Hide every element the page fixes to the viewport, and give back the
 * function that shows them again.
 *
 * Position is a computed value, so there is no selector for it: the page
 * itself is asked which of its elements are fixed. Visibility rather than
 * display, so nothing reflows and the section is captured at the size it
 * really has.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<() => Promise<void>>}
 */
async function hideFixedFurniture(page) {
  await page.evaluate(() => {
    globalThis.__specimenHidden = [...document.body.querySelectorAll('*')].filter(
      (el) => getComputedStyle(el).position === 'fixed',
    );
    for (const el of globalThis.__specimenHidden) el.style.visibility = 'hidden';
  });
  return async () => {
    await page.evaluate(() => {
      for (const el of globalThis.__specimenHidden ?? []) el.style.visibility = '';
      globalThis.__specimenHidden = undefined;
    });
  };
}

async function capture({ options, baseUrl, log }) {
  const { chromium } = await loadPlaywright();
  let browser;
  try {
    browser = await chromium.launch();
  } catch (error) {
    throw new Error(
      'could not start Chromium. Set PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers; '
        + `this script never runs "playwright install". (${error.message})`,
    );
  }
  const outDir = path.resolve(options.out);
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  try {
    for (const width of options.widths) {
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
        deviceScaleFactor: options.scale,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(options.timeoutMs);
      for (const style of options.styles) {
        for (const mode of options.modes) {
          const url = captureUrl({ baseUrl, style, mode });
          await page.goto(url, { waitUntil: 'load' });
          await page.waitForSelector('h1:text("Specimen book")');
          await page.evaluate(() => globalThis.document.fonts.ready);
          const file = path.join(
            outDir,
            captureName({ style, mode, width, section: options.only }),
          );
          if (options.only) {
            // A section capture is a picture of one section, and anything
            // the page fixes to the viewport — the back-to-top control —
            // lands on top of it wherever the shot happens to stop. The
            // furniture is hidden for the shot and put back after, so the
            // evidence shows the section and nothing else.
            const target = page.locator(`#${options.only}`).locator('xpath=ancestor::section[1]');
            // The section is brought into view FIRST. The back-to-top
            // control mounts on scroll, so a page still at the top has
            // nothing to hide and the control arrives inside the shot.
            await target.scrollIntoViewIfNeeded();
            await page.waitForTimeout(150);
            const restore = await hideFixedFurniture(page);
            await target.screenshot({ path: file });
            await restore();
          } else {
            await page.screenshot({ path: file, fullPage: true });
          }
          written.push(file);
          log.log(`wrote ${path.relative(REPO_ROOT, file)}`);
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  return written;
}

/**
 * @param {string[]} argv
 * @param {{ log?: Console }} [deps]
 * @returns {Promise<number>} the process exit code
 */
export async function main(argv, { log = console } = {}) {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    log.error(`capture-specimen: ${parsed.error}`);
    return 2;
  }
  const { options } = parsed;
  if (options.help) {
    log.log('Usage: node scripts/dev/capture-specimen.mjs --out <dir> (--dist <dir> | --base-url <url>)');
    return 0;
  }

  let server = null;
  let baseUrl = options.baseUrl;
  if (options.dist) {
    if (!fs.existsSync(path.join(options.dist, 'index.html'))) {
      log.error(`capture-specimen: no index.html in ${options.dist}. Build the demo first.`);
      return 3;
    }
    server = await serveDist(options);
    baseUrl = `http://127.0.0.1:${options.port}${options.basePath}`;
    log.log(`serving ${options.dist} at ${baseUrl}`);
  }

  try {
    const written = await capture({ options, baseUrl, log });
    log.log(`capture-specimen: wrote ${written.length} files to ${options.out}`);
    return 0;
  } catch (error) {
    log.error(`capture-specimen: ${error?.message ?? error}`);
    return 1;
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
  }
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((error) => {
      console.error(`capture-specimen: ${error?.stack ?? error}`);
      process.exitCode = 1;
    });
}

export default main;
