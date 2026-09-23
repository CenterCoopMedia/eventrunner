'use strict';

/**
 * The two raster app icons the web manifest lists (#218): 192 and 512
 * pixels square, the sizes Chrome and Android need before a site can be
 * installed. Both write paths use this module: scripts/publish-site.cjs
 * (the Cloud Run job, live config/theme) and scripts/write-site-files.cjs
 * (the deploy build job, the generated snapshot's theme).
 *
 * The source is the square icon slot, `config/theme.logos.mark`. When it
 * names an uploaded PNG (`branding/{assetId}/{name}.png`, the shape
 * functions/src/media/upload.cjs gives every upload), that object is
 * fetched over its public download URL and resampled to both sizes. In
 * every other case the two committed neutral placeholders ship instead,
 * byte for byte: an empty slot, the seeded placeholder, an SVG, JPEG, or
 * WebP (nothing here rasterizes those), or an upload that fails to
 * download or decode. An icon is cosmetic, so a problem with it logs its
 * reason and never fails a publish or a deploy. Only a failed file write
 * throws.
 *
 * The placeholder is drawn in code from the default mark's own numbers
 * (apps/web/public/branding/mark.svg), full bleed so the ground fills the
 * square, and committed as two PNGs by scripts/dev/build-app-icons.mjs. The
 * scripts copy those committed bytes and never re-encode them:
 * scripts/build-demo.cjs `--check` compares the demo byte for byte, and
 * deflate output may change between zlib builds.
 *
 * `maskable` is true only for the placeholder, whose ring sits well inside
 * the 40% safe zone. An uploaded mark's safe zone is unknown, so its icons
 * are listed with purpose `any` alone.
 */

const fs = require('node:fs');
const path = require('node:path');

const { PngError, encodePng, decodePng, resizeSquare } = require('./png.cjs');
const { PLACEHOLDER_LOGOS } = require('./theme.cjs');

const APP_ICON_SIZES = Object.freeze([192, 512]);

/** Manifest-relative path of one icon, the same in dist and in public/. */
function appIconPath(size) {
  return `branding/app-icon-${size}.png`;
}

/** Where the committed placeholder icons live (Vite copies them into dist). */
const PLACEHOLDER_DIR = path.resolve(__dirname, '..', '..', 'apps', 'web', 'public', 'branding');

/**
 * The default mark (apps/web/public/branding/mark.svg) as numbers on its
 * 64 grid. The rounded ground rect is not used: the icon fills the square,
 * and a launcher applies its own mask.
 */
const PLACEHOLDER_MARK = Object.freeze({
  grid: 64,
  ground: Object.freeze([91, 93, 97]),
  ink: Object.freeze([250, 250, 249]),
  ring: Object.freeze({ radius: 17, width: 4 }),
  dot: Object.freeze({ radius: 6 }),
});

const MIN_MARK_SIDE = 512;
const MAX_MARK_SIDE = 4096;
const MAX_MARK_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

const REASONS = Object.freeze({
  placeholder: 'the square icon slot is empty or still the placeholder',
  notUploaded: 'the square icon is not an uploaded file in the branding folder',
  notPng: 'the square icon is an SVG, JPEG, or WebP file; app icons need a PNG',
  noBucket: 'no storage bucket was given',
  tooManyBytes: 'the square icon is larger than 5 MB',
  'not-png': 'the square icon is not a PNG file',
  unsupported: 'the square icon uses a PNG format this build cannot read',
  damaged: 'the square icon file is damaged',
});

/** A reason the placeholder ships, in the words the job log prints. */
class AppIconError extends Error {}

/**
 * Draw the placeholder icon: the default mark's ring and dot, centred on a
 * ground that fills the square. Each pixel is the share of a 4 by 4 grid of
 * samples that lands on ink. Used by the dev script and the tests only.
 *
 * @param {number} size
 * @returns {{ width: number, height: number, rgba: Buffer }}
 */
function renderPlaceholderIcon(size) {
  const { grid, ground, ink, ring, dot } = PLACEHOLDER_MARK;
  const unit = size / grid;
  const centre = size / 2;
  const outer = (ring.radius + ring.width / 2) * unit;
  const inner = (ring.radius - ring.width / 2) * unit;
  const dotRadius = dot.radius * unit;
  const samples = 4;
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let hits = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const d = Math.hypot(x + (sx + 0.5) / samples - centre, y + (sy + 0.5) / samples - centre);
          if (d <= dotRadius || (d >= inner && d <= outer)) hits += 1;
        }
      }
      const share = hits / (samples * samples);
      const at = (y * size + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        rgba[at + channel] = Math.round(ground[channel] + (ink[channel] - ground[channel]) * share);
      }
      rgba[at + 3] = 255;
    }
  }
  return { width: size, height: size, rgba };
}

/**
 * The committed placeholder icons, as the bytes to write.
 *
 * @param {string} [dir]
 * @returns {Array<{ path: string, bytes: Buffer }>}
 */
function readPlaceholderIcons(dir = PLACEHOLDER_DIR) {
  return APP_ICON_SIZES.map((size) => ({
    path: appIconPath(size),
    bytes: fs.readFileSync(path.join(dir, path.basename(appIconPath(size)))),
  }));
}

const PLACEHOLDER_PATHS = new Set(Object.values(PLACEHOLDER_LOGOS));

/**
 * The public download URL of an uploaded square icon, or the reason there
 * is none. Only `branding/{assetId}/{name}.png` qualifies: a flat
 * `branding/x` path is a bundled placeholder, and anything outside
 * `branding/` is not a file the storage rules make public. The host is
 * fixed, so the slot cannot point the fetch anywhere else.
 *
 * @param {{ mark: unknown, bucket: unknown }} args
 * @returns {{ url: string } | { reason: string }}
 */
function markObjectUrl({ mark, bucket }) {
  const value = typeof mark === 'string' ? mark.trim() : '';
  if (!value || PLACEHOLDER_PATHS.has(value)) return { reason: REASONS.placeholder };
  // Starting with `branding/` already rules out a leading `/` and a scheme.
  if (!value.startsWith('branding/') || value.includes('..') || value.split('/').length <= 2) {
    return { reason: REASONS.notUploaded };
  }
  if (!/\.png$/i.test(value)) {
    return { reason: /\.(svg|jpe?g|webp)$/i.test(value) ? REASONS.notPng : REASONS.notUploaded };
  }
  if (typeof bucket !== 'string' || !bucket.trim()) return { reason: REASONS.noBucket };
  return {
    url: `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.trim())}`
      + `/o/${encodeURIComponent(value)}?alt=media`,
  };
}

/**
 * Both icon sizes from an uploaded PNG. The output is re-encoded from
 * pixels, so no ancillary chunk of the upload (eXIf, tEXt) ships.
 *
 * @param {Buffer} bytes
 * @returns {Array<{ path: string, bytes: Buffer }>}
 * @throws {AppIconError}
 */
function iconsFromMark(bytes) {
  let image;
  try {
    image = decodePng(bytes, { maxSide: MAX_MARK_SIDE });
  } catch (err) {
    if (!(err instanceof PngError)) throw err;
    // The size limit applies to each side, so the reason names both.
    throw new AppIconError(err.reason === 'too-large'
      ? `the square icon is ${err.width} by ${err.height} pixels; each side must be ${MAX_MARK_SIDE} or less`
      : REASONS[err.reason]);
  }
  if (image.width !== image.height) {
    throw new AppIconError(`the square icon is ${image.width} by ${image.height} pixels; it must be square`);
  }
  if (image.width < MIN_MARK_SIDE) {
    throw new AppIconError(`the square icon is ${image.width} pixels wide; it must be at least ${MIN_MARK_SIDE}`);
  }
  return APP_ICON_SIZES.map((size) => ({
    path: appIconPath(size),
    bytes: encodePng(resizeSquare({ side: image.width, rgba: image.rgba }, size)),
  }));
}

/** Why a fetch did not return a body, in a few words. */
function downloadFailure(detail) {
  return new AppIconError(`the square icon could not be downloaded (${detail})`);
}

/**
 * GET the mark with a time limit, no redirects, and a byte cap enforced
 * while the body streams, so an oversized file is never held whole.
 */
async function downloadMark(url, { fetchImpl, maxBytes, timeoutMs }) {
  try {
    const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw downloadFailure(`HTTP ${response.status}`);
    const parts = [];
    let total = 0;
    for await (const part of response.body ?? []) {
      total += part.byteLength;
      if (total > maxBytes) throw new AppIconError(REASONS.tooManyBytes);
      parts.push(Buffer.from(part));
    }
    return Buffer.concat(parts, total);
  } catch (err) {
    if (err instanceof AppIconError) throw err;
    if (err?.name === 'TimeoutError') throw downloadFailure(`no answer in ${timeoutMs / 1000} seconds`);
    throw downloadFailure(err?.cause?.message || err?.message || String(err));
  }
}

/**
 * Decide the two icons for one deployment.
 *
 * @param {{ theme?: object, bucket?: string, fetchImpl?: typeof fetch,
 *           placeholderDir?: string, maxBytes?: number, timeoutMs?: number }} args
 * @returns {Promise<{ source: 'mark'|'placeholder', maskable: boolean,
 *                     reason: string|null, mark: string|null,
 *                     files: Array<{ path: string, bytes: Buffer }> }>}
 */
async function resolveAppIcons({
  theme,
  bucket,
  fetchImpl = globalThis.fetch,
  placeholderDir = PLACEHOLDER_DIR,
  maxBytes = MAX_MARK_BYTES,
  timeoutMs = FETCH_TIMEOUT_MS,
} = {}) {
  const placeholder = (reason) => ({
    source: 'placeholder', maskable: true, reason, mark: null, files: readPlaceholderIcons(placeholderDir),
  });
  const mark = theme?.logos?.mark;
  const target = markObjectUrl({ mark, bucket });
  if (!target.url) return placeholder(target.reason);
  try {
    const bytes = await downloadMark(target.url, { fetchImpl, maxBytes, timeoutMs });
    return { source: 'mark', maskable: false, reason: null, mark: mark.trim(), files: iconsFromMark(bytes) };
  } catch (err) {
    if (err instanceof AppIconError) return placeholder(err.message);
    throw err;
  }
}

/**
 * Resolve the icons and write both under `distDir/branding/`, with one log
 * line saying which source was used and, for the placeholder, why.
 *
 * @param {{ distDir: string, theme?: object, bucket?: string,
 *           fetchImpl?: typeof fetch, placeholderDir?: string, log?: Console }} args
 * @returns {Promise<{ source: string, maskable: boolean, reason: string|null }>}
 */
async function writeAppIcons({ distDir, theme, bucket, fetchImpl, placeholderDir, log = console }) {
  const icons = await resolveAppIcons({ theme, bucket, fetchImpl, placeholderDir });
  fs.mkdirSync(path.join(distDir, 'branding'), { recursive: true });
  for (const file of icons.files) fs.writeFileSync(path.join(distDir, file.path), file.bytes);
  log.log(icons.source === 'mark'
    ? `app icons: from the square icon slot (${icons.mark})`
    : `app icons: neutral placeholder: ${icons.reason}`);
  return icons;
}

module.exports = {
  APP_ICON_SIZES,
  PLACEHOLDER_DIR,
  PLACEHOLDER_MARK,
  REASONS,
  appIconPath,
  renderPlaceholderIcon,
  readPlaceholderIcons,
  markObjectUrl,
  iconsFromMark,
  resolveAppIcons,
  writeAppIcons,
};
