#!/usr/bin/env node
// Renders apps/web/public/branding/og-default.png — the neutral social
// sharing image a deployment falls back to before an operator uploads one.
//
// Why a raster at all: the slot already ships an SVG
// (apps/web/public/branding/og-default.svg), and the Open Graph and Twitter
// crawlers do not reliably accept SVG. A card that fails to render is worse
// than a plain one, so the fallback the server points at has to be a PNG.
// The SVG stays: it is what the app renders in-page, where SVG is fine.
//
// Why it is drawn here rather than converted: nothing in this repo's
// dependencies rasterizes SVG, and the docs cards
// (scripts/dev/build-social-cards.mjs) need a Playwright browser that a
// credential-free, offline checkout does not have. So the same composition
// is drawn straight into a pixel buffer and encoded with node:zlib — no
// dependency, no download, byte-identical on every machine.
//
// Brand neutral by construction: grayscale only, no wordmark, no event
// name. It is a placeholder, and it must not look like anyone's brand.
//
// A dev script, not part of any build. The output is committed. Re-run it
// when og-default.svg changes:
//
//   node scripts/dev/build-og-placeholder.mjs
//   node scripts/dev/build-og-placeholder.mjs --check   # compare, write nothing

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, crc32 } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'apps', 'web', 'public', 'branding', 'og-default.png');

const WIDTH = 1200;
const HEIGHT = 630;
// Coverage is sampled on a 3x3 grid per pixel, which is what keeps the ring
// and the rounded corners from stairstepping. Sampling, not a second buffer:
// a supersampled 3600x1890 image would be 20 MB of RAM for the same result.
const SAMPLES = 3;

// The palette of og-default.svg, restated as the numbers it already uses.
// Grayscale only (docs/interface-guidelines.md: no brand colour in a
// placeholder — it would read as an event's own).
const GROUND = [240, 240, 238];
const RULE = [148, 150, 154];
const INK = [91, 93, 97];

/** Signed distance from a point to a rounded rectangle: negative inside. */
function roundedRectDistance(x, y, { left, top, width, height, radius }) {
  const halfW = width / 2;
  const halfH = height / 2;
  const dx = Math.abs(x - (left + halfW)) - (halfW - radius);
  const dy = Math.abs(y - (top + halfH)) - (halfH - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - radius;
}

/** Signed distance to a circle: negative inside. */
function circleDistance(x, y, { cx, cy, r }) {
  return Math.hypot(x - cx, y - cy) - r;
}

/**
 * The composition, as a list of tests. Each returns true when the sample at
 * (x, y) is inside that shape; later entries paint over earlier ones.
 */
const SHAPES = [
  // The frame: a 4px rule inset from the edge.
  {
    color: RULE,
    hit: (x, y) => {
      const d = roundedRectDistance(x, y, { left: 80, top: 80, width: 1040, height: 470, radius: 24 });
      return d <= 2 && d >= -2;
    },
  },
  // The ring and its centre, the same mark the other placeholders carry.
  {
    color: INK,
    hit: (x, y) => {
      const d = circleDistance(x, y, { cx: 600, cy: 265, r: 80 });
      return d <= 8 && d >= -8;
    },
  },
  { color: INK, hit: (x, y) => circleDistance(x, y, { cx: 600, cy: 265, r: 28 }) <= 0 },
  // Two bars standing in for a title and a line under it.
  {
    color: INK,
    hit: (x, y) => roundedRectDistance(x, y, { left: 420, top: 410, width: 360, height: 24, radius: 12 }) <= 0,
  },
  {
    color: RULE,
    hit: (x, y) => roundedRectDistance(x, y, { left: 480, top: 456, width: 240, height: 16, radius: 8 }) <= 0,
  },
];

/** The image as raw RGB rows, each prefixed with PNG filter type 0. */
function renderScanlines() {
  const stride = WIDTH * 3;
  const raw = Buffer.alloc((stride + 1) * HEIGHT);
  const step = 1 / SAMPLES;
  const offset = step / 2;

  for (let y = 0; y < HEIGHT; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < WIDTH; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const px = x + offset + sx * step;
          const py = y + offset + sy * step;
          let color = GROUND;
          for (const shape of SHAPES) {
            if (shape.hit(px, py)) color = shape.color;
          }
          r += color[0];
          g += color[1];
          b += color[2];
        }
      }
      const total = SAMPLES * SAMPLES;
      const at = rowStart + 1 + x * 3;
      raw[at] = Math.round(r / total);
      raw[at + 1] = Math.round(g / total);
      raw[at + 2] = Math.round(b / total);
    }
  }
  return raw;
}

/** One PNG chunk: length, type, payload, CRC. */
function chunk(type, payload) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(payload.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), payload])) >>> 0, 0);
  return Buffer.concat([head, payload, crc]);
}

function encodePng(raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH, 0);
  ihdr.writeUInt32BE(HEIGHT, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const png = encodePng(renderScanlines());

if (process.argv.includes('--check')) {
  let current;
  try {
    current = readFileSync(OUT);
  } catch {
    console.error('build-og-placeholder --check: apps/web/public/branding/og-default.png is missing');
    process.exit(1);
  }
  if (!current.equals(png)) {
    console.error('build-og-placeholder --check: og-default.png does not match a fresh render');
    process.exit(1);
  }
  console.log('build-og-placeholder --check: og-default.png matches a fresh render');
} else {
  writeFileSync(OUT, png);
  console.log(`build-og-placeholder: wrote ${OUT} (${WIDTH}x${HEIGHT}, ${(png.length / 1024).toFixed(1)} kB)`);
}
