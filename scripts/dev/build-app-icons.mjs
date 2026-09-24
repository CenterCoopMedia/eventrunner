#!/usr/bin/env node
// Renders apps/web/public/branding/app-icon-192.png and app-icon-512.png:
// the neutral app icons a deployment ships until an operator uploads a
// square PNG to the square icon slot (#218).
//
// Drawn in code from the default mark's numbers (scripts/lib/app-icons.cjs
// PLACEHOLDER_MARK) for the same reason as og-default.png: nothing in this
// repo's dependencies rasterizes SVG. The output is committed, and the
// publish and deploy scripts copy those bytes as they are.
//
// After a change to mark.svg, a unit test fails until you do these steps in
// order: update PLACEHOLDER_MARK in scripts/lib/app-icons.cjs to match the
// new mark.svg (and renderPlaceholderIcon, if the shapes change), run this
// script, and commit both PNGs. Running this script alone does not clear
// the test that compares PLACEHOLDER_MARK with mark.svg.
//
//   node scripts/dev/build-app-icons.mjs
//   node scripts/dev/build-app-icons.mjs --check   # compare pixels, write nothing

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  APP_ICON_SIZES, PLACEHOLDER_DIR, appIconPath, renderPlaceholderIcon,
} = require('../lib/app-icons.cjs');
const { decodePng, encodePng } = require('../lib/png.cjs');

const check = process.argv.includes('--check');
let stale = 0;
for (const size of APP_ICON_SIZES) {
  const file = path.join(PLACEHOLDER_DIR, path.basename(appIconPath(size)));
  const image = renderPlaceholderIcon(size);
  if (!check) {
    const png = encodePng(image);
    writeFileSync(file, png);
    console.log(`build-app-icons: wrote ${file} (${size}x${size}, ${(png.length / 1024).toFixed(1)} kB)`);
    continue;
  }
  let current = null;
  try {
    current = decodePng(readFileSync(file));
  } catch (err) {
    console.error(`build-app-icons --check: ${file} cannot be read: ${err.message}`);
  }
  if (current && current.width === size && current.height === size && current.rgba.equals(image.rgba)) {
    console.log(`build-app-icons --check: ${path.basename(file)} matches a fresh render`);
  } else {
    stale += 1;
    if (current) console.error(`build-app-icons --check: ${path.basename(file)} does not match a fresh render`);
  }
}
if (stale > 0) process.exit(1);
