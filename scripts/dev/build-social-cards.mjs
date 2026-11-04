#!/usr/bin/env node
// Renders the social cards that pages link from their meta tags:
//
//   docs/social-preview.png               the product landing page
//   docs/og-default.png                   any documentation page
//   console/web/public/og-console.png     the client console (ADR 0007 §1)
//
// Both are drawn from the site's own materials — docs/tokens.css for the
// palette, docs/fonts for the faces, and the same four-stroke mark
// docs/favicon.svg and the masthead carry — so a link preview looks like the
// page behind it. Nothing here is a picture: it is the mark, the wordmark, a
// sentence, and two rules.
//
// A dev script, not part of any build: these are brand assets and they are
// committed. Re-run it when the mark, the wordmark, or the palette changes.
//
//   node scripts/dev/build-social-cards.mjs
//   node scripts/dev/build-social-cards.mjs --check   # compare, write nothing
//
// Requires the repo's Playwright chromium (npx playwright install chromium).

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOCS = path.join(ROOT, 'docs');

const WIDTH = 1200;
const HEIGHT = 630;

/** One woff2 as a data: URI, so the page needs no file access of its own. */
function face(file) {
  const bytes = readFileSync(path.join(DOCS, 'fonts', file)).toString('base64');
  return `url(data:font/woff2;base64,${bytes}) format('woff2')`;
}

/** The palette, read out of the generated stylesheet rather than restated. */
function palette() {
  const css = readFileSync(path.join(DOCS, 'tokens.css'), 'utf8');
  const light = css.slice(css.indexOf('color-scheme: light'), css.indexOf('@media'));
  const read = (name) => {
    const match = light.match(new RegExp(`${name}:\\s*([^;]+);`));
    if (!match) throw new Error(`docs/tokens.css declares no ${name}`);
    return match[1].trim();
  };
  return {
    surface: read('--brand-surface-rgb'),
    ink: read('--brand-ink-rgb'),
    inkMuted: read('--brand-ink-muted-rgb'),
    rule: read('--rule-hairline-rgb'),
    accent: read('--brand-primary-rgb'),
  };
}

const MARK = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <rect x="2.5" y="2" width="3" height="20"/>
  <rect x="5.5" y="2" width="16" height="3"/>
  <rect x="5.5" y="11" width="9.5" height="2"/>
  <rect x="5.5" y="19.5" width="13" height="2.5"/>
</svg>`;

/**
 * The console card carries the accent: the top rule, the folio and a tile
 * behind the mark, the same tile as console/web/public/favicon.svg.
 *
 * @param {{ line: string, title: string, blurb: string, foot?: string, accent?: boolean }} card
 * @returns {string} a complete document
 */
function page({ line, title, blurb, foot = 'An initiative of the Center for Cooperative Media at Montclair State University', accent = false }) {
  const { surface, ink, inkMuted, rule, accent: accentRgb } = palette();
  const lead = accent ? accentRgb : ink;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
@font-face { font-family: "Bricolage Grotesque"; font-weight: 700 800; src: ${face('bricolage-grotesque-latin.woff2')}; }
@font-face { font-family: "Source Sans 3"; font-weight: 400 700; src: ${face('source-sans-3-latin.woff2')}; }
* { box-sizing: border-box; margin: 0; }
body {
  width: ${WIDTH}px; height: ${HEIGHT}px;
  display: flex; flex-direction: column; justify-content: space-between;
  padding: 72px 80px;
  background: rgb(${surface}); color: rgb(${ink});
  font-family: "Source Sans 3", sans-serif;
  -webkit-font-smoothing: antialiased;
}
.top { border-block-start: 3px solid rgb(${lead}); padding-block-start: 20px; }
.folio {
  font-size: 20px; font-weight: 500; letter-spacing: 0.08em;
  text-transform: uppercase; color: rgb(${accent ? accentRgb : inkMuted});
}
.tile { width: 92px; height: 92px; flex: none; border-radius: 15px; background: rgb(${accentRgb}); display: grid; place-items: center; }
.lockup .tile svg { width: 64px; height: 64px; fill: rgb(${surface}); }
.lockup { display: flex; align-items: center; gap: 24px; margin-block-start: 56px; }
.lockup svg { width: 92px; height: 92px; flex: none; fill: rgb(${ink}); }
.lockup h1 {
  font-family: "Bricolage Grotesque", sans-serif; font-weight: 800;
  font-size: 84px; line-height: 1.02; letter-spacing: -0.02em;
}
p { max-width: 22em; margin-block-start: 32px; font-size: 30px; line-height: 1.45; color: rgb(${inkMuted}); }
.foot {
  border-block-start: 1px solid rgb(${rule}); padding-block-start: 20px;
  font-size: 20px; color: rgb(${inkMuted});
}
</style></head><body>
<div class="top">
  <div class="folio">${line}</div>
  <div class="lockup">${accent ? `<div class="tile">${MARK}</div>` : MARK}<h1>${title}</h1></div>
  <p>${blurb}</p>
</div>
<div class="foot">${foot}</div>
</body></html>`;
}

const CARDS = [
  {
    file: 'docs/social-preview.png',
    line: 'Event CMS',
    title: 'Event Runner',
    blurb: 'A white-label event CMS. One Firebase project per event. Your staff run the site '
      + 'from the admin panel, without a developer in the room.',
  },
  {
    file: 'docs/og-default.png',
    line: 'Documentation',
    title: 'Event Runner',
    blurb: 'Guides, runbooks, and decision records for the white-label event CMS operated by '
      + 'the Center for Cooperative Media.',
  },
  {
    file: 'console/web/public/og-console.png',
    line: 'Console',
    title: 'Event Runner',
    blurb: 'Answer a few questions, accept the agreement and start building your event site.',
    foot: 'console.eventrunner.org',
    accent: true,
  },
];

const check = process.argv.includes('--check');
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
const tab = await context.newPage();
let stale = 0;

for (const card of CARDS) {
  await tab.setContent(page(card));
  // A string, not a closure: this runs in the page, and the identifiers in it
  // are the page's, not this file's.
  await tab.evaluate('document.fonts.ready');
  const shot = await tab.screenshot({ type: 'png' });
  const target = path.join(ROOT, card.file);
  if (check) {
    if (!readFileSync(target).equals(shot)) {
      console.error(`stale: ${card.file}`);
      stale += 1;
    }
    continue;
  }
  writeFileSync(target, shot);
  console.log(`wrote ${card.file} (${WIDTH}x${HEIGHT}, ${shot.length} bytes)`);
}

await browser.close();
process.exitCode = stale > 0 ? 1 : 0;
