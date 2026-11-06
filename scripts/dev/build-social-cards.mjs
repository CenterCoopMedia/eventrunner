#!/usr/bin/env node
// Render the Badger cards and icons from design/brand SVG sources with system Chrome.
// Source Sans 3 is inlined from docs/fonts; no browser package is required.
//
//   node scripts/dev/build-social-cards.mjs
//   node scripts/dev/build-social-cards.mjs --check   # compare in a temp directory
//
// CHROME overrides the executable. Otherwise use the macOS Google Chrome path,
// then google-chrome or chromium on PATH. This is a manual brand asset build.
// Run it in a local terminal outside the agent sandbox.

import { accessSync, constants, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BRAND = path.join(ROOT, 'design', 'brand');
const check = process.argv.includes('--check');
const temp = mkdtempSync(path.join(os.tmpdir(), 'eventrunner-brand-'));
let stale = 0;
let renderCount = 0;

function chromePath() {
  if (process.env.CHROME) return process.env.CHROME;
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  try { accessSync(mac, constants.X_OK); return mac; } catch { /* Try PATH. */ }
  for (const name of ['google-chrome', 'chromium']) {
    const found = spawnSync('which', [name], { encoding: 'utf8' });
    if (found.status === 0) return found.stdout.trim();
  }
  throw new Error('Chrome was not found. Set CHROME to the system Chrome executable.');
}

const xml = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const inner = (svg) => svg.replace(/^<svg\b[^>]*>\s*/, '').replace(/\s*<\/svg>\s*$/, '');
const mark = inner(readFileSync(path.join(BRAND, 'badger-mark.svg'), 'utf8'));
const face = inner(readFileSync(path.join(BRAND, 'badger-face.svg'), 'utf8'));
const font = '../../docs/fonts/source-sans-3-latin.woff2';
const FOOT = 'An initiative of the Center for Cooperative Media at Montclair State University';

// Preserve the original card text exactly. Only line breaks depend on the layout.
const CARDS = [
  {
    source: 'social-preview.svg', file: 'docs/social-preview.png',
    line: 'Conference websites', title: 'Event Runner',
    blurb: 'Conference websites your team can run, with direct help from the person who '
      + 'runs the service.',
    foot: 'eventrunner.org',
  },
  {
    source: 'og-default.svg', file: 'docs/og-default.png',
    line: 'Documentation', title: 'Event Runner',
    blurb: 'Guides, runbooks, and decision records for the white-label event CMS operated by '
      + 'the Center for Cooperative Media.',
    foot: FOOT,
  },
  {
    source: 'og-console.svg', file: 'console/web/public/og-console.png',
    line: 'Console', title: 'Event Runner',
    blurb: 'Answer a few questions, accept the agreement and start building your event site.',
    foot: 'console.eventrunner.org',
  },
];

function lines(text, limit = 50) {
  const result = [''];
  for (const word of text.split(' ')) {
    const last = result.length - 1;
    if (result[last] && `${result[last]} ${word}`.length > limit) result.push(word);
    else result[last] += `${result[last] ? ' ' : ''}${word}`;
  }
  return result;
}

/** The chosen dark-panels composition (concept og-a), shared by all three cards. */
function cardSvg(card) {
  const [first, second] = card.title.split(' ');
  const blurb = lines(card.blurb, 44).map((line, i) => `    <tspan x="68" dy="${i ? 32 : 0}">${xml(line)}</tspan>`).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${xml(`${card.title}: ${card.blurb}`)}" color="rgb(238 238 236)">
  <defs>
    <style>@font-face { font-family: 'Source Sans 3'; font-style: normal; font-weight: 200 900; src: url('${font}') format('woff2'); } text { font-family: 'Source Sans 3', sans-serif; }</style>
    <radialGradient id="shadow"><stop stop-color="rgb(80 83 89)" stop-opacity="0.65"/><stop offset="1" stop-color="rgb(80 83 89)" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1200" height="630" fill="rgb(25 26 28)"/>
  <g fill="none" stroke="rgb(64 66 70)" stroke-width="3">
    <rect x="566" y="122" width="560" height="222" rx="32"/>
    <rect x="862" y="302" width="300" height="136" rx="28" fill="rgb(25 26 28)"/>
    <rect x="546" y="382" width="316" height="116" rx="28" fill="rgb(25 26 28)"/>
  </g>
  <g fill="rgb(128 178 238)">
    <rect x="596" y="150" width="138" height="22" rx="10"/>
    <rect x="1055" y="342" width="78" height="20" rx="10"/>
    <rect x="578" y="436" width="118" height="22" rx="10"/>
    <rect x="690" y="218" width="23" height="23" rx="6"/>
    <rect x="986" y="337" width="23" height="23" rx="6"/>
  </g>
  <rect x="1005" y="188" width="23" height="23" rx="6" fill="rgb(174 178 184)" opacity="0.65"/>
  <ellipse cx="908" cy="538" rx="124" ry="23" fill="url(#shadow)"/>
  <g transform="translate(650 54) scale(16.25)">
${mark}
  </g>
  <text x="68" y="96" font-size="22" font-weight="600" fill="rgb(128 178 238)">${xml(card.line)}</text>
  <g fill="currentColor" font-size="128" font-weight="700" letter-spacing="-3">
    <text x="62" y="250">${xml(first)}</text>
    <text x="62" y="359">${xml(second)}</text>
  </g>
  <text x="68" y="416" font-size="25" fill="rgb(174 178 184)">
${blurb}
  </text>
  <text x="68" y="591" font-size="18" fill="rgb(174 178 184)">${xml(card.foot)}</text>
</svg>
`;
}

/** Each favicon has a dark-mode variant; PNGs skip the media query so they never depend on the renderer. */
function faviconSvg(consoleIcon, png = false) {
  const label = consoleIcon ? 'Event Runner console' : 'Event Runner';
  const colors = consoleIcon
    ? `--tile: rgb(26 82 150); --badger-ink: rgb(250 250 249); --badger-surface: rgb(26 82 150); --badger-accent: rgb(128 178 238);`
    : `--badger-ink: rgb(23 24 26); --badger-surface: rgb(250 250 249); --badger-accent: rgb(26 82 150);`;
  const darkColors = consoleIcon
    ? '--tile: rgb(128 178 238); --badger-ink: rgb(25 26 28); --badger-surface: rgb(250 250 249); --badger-accent: rgb(26 82 150);'
    : '--badger-ink: rgb(238 238 236); --badger-surface: rgb(25 26 28); --badger-accent: rgb(128 178 238);';
  const dark = png ? '' : ` @media (prefers-color-scheme: dark) { :root { ${darkColors} } }`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" role="img" aria-label="${label}">
  <!-- Derived from design/brand/badger-face.svg by build-social-cards.mjs. -->
  <style>:root { ${colors} color: var(--badger-ink); }${dark}</style>
${consoleIcon ? '  <rect width="24" height="24" rx="4" fill="var(--tile)"/>\n  <g transform="translate(3 3) scale(0.75)">\n' : ''}${face}${consoleIcon ? '\n  </g>' : ''}
</svg>
`;
}

/** App icons use an opaque tile, with the whole face inside the central safe circle. */
function appIconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" style="--badger-ink: rgb(250 250 249); --badger-surface: rgb(26 82 150); --badger-accent: rgb(128 178 238); color: var(--badger-ink)">
  <rect width="24" height="24" fill="rgb(26 82 150)"/>
  <g transform="translate(4.56 4.56) scale(0.62)">${face}</g>
</svg>`;
}

function saveOrCheck(file, bytes) {
  const target = path.join(ROOT, file);
  if (check) {
    let existing;
    try { existing = readFileSync(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!existing?.equals(Buffer.from(bytes))) { console.error(`stale: ${file}`); stale += 1; }
  } else {
    writeFileSync(target, bytes);
    console.log(`wrote ${file}`);
  }
}

function inlineFonts(svg) {
  return svg.replace(/url\(['"]?([^)'"\s]+\.woff2)['"]?\)/g, (_, relative) => {
    const bytes = readFileSync(path.resolve(BRAND, relative)).toString('base64');
    return `url(data:font/woff2;base64,${bytes})`;
  });
}

function render(chrome, svg, width, height) {
  const id = renderCount++;
  const html = path.join(temp, `render-${id}.html`);
  const png = path.join(temp, `render-${id}.png`);
  writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden}svg{display:block;width:100%;height:100%}</style></head><body>${inlineFonts(svg)}</body></html>`);
  const result = spawnSync(chrome, [
    '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${path.join(temp, `profile-${id}`)}`,
    '--hide-scrollbars', '--force-device-scale-factor=1', '--default-background-color=00000000',
    '--run-all-compositor-stages-before-draw', '--virtual-time-budget=1000',
    `--screenshot=${png}`, `--window-size=${width},${height}`, pathToFileURL(html).href,
  ], { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
  // Headless Chrome on macOS can crash in teardown after the screenshot is written,
  // so a written PNG counts; the size check below still guards it.
  if (!existsSync(png)) throw new Error(`Chrome render failed: ${result.error?.message || result.stderr || result.signal || result.status}`);
  const bytes = readFileSync(png);
  if (bytes.subarray(1, 4).toString('latin1') !== 'PNG' || bytes.readUInt32BE(16) !== width || bytes.readUInt32BE(20) !== height) {
    throw new Error(`Chrome returned the wrong PNG dimensions for ${width}x${height}`);
  }
  return bytes;
}

try {
  const chrome = chromePath();
  const jobs = [];
  for (const card of CARDS) {
    const svg = cardSvg(card);
    saveOrCheck(`design/brand/${card.source}`, svg);
    jobs.push([card.file, svg, 1200, 630]);
  }
  const consoleFavicon = faviconSvg(true);
  const docsFavicon = faviconSvg(false);
  saveOrCheck('console/web/public/favicon.svg', consoleFavicon);
  saveOrCheck('docs/favicon.svg', docsFavicon);
  for (const [file, svg, size] of [
    ['console/web/public/favicon-32.png', faviconSvg(true, true), 32],
    ['docs/favicon-32.png', faviconSvg(false, true), 32],
    ['console/web/public/apple-touch-icon.png', appIconSvg(), 180],
    ['docs/apple-touch-icon.png', appIconSvg(), 180],
    ['console/web/public/icon-192.png', appIconSvg(), 192],
    ['console/web/public/icon-512.png', appIconSvg(), 512],
  ]) jobs.push([file, svg, size, size]);
  for (const [file, svg, width, height] of jobs) saveOrCheck(file, render(chrome, svg, width, height));
  if (check) console.log(stale ? `${stale} stale brand files` : 'All brand SVGs and PNGs match.');
  process.exitCode = stale ? 1 : 0;
} finally {
  rmSync(temp, { recursive: true, force: true });
}
