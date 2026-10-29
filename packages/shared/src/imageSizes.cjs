'use strict';

/**
 * Display sizes for uploaded images (issue #333).
 *
 * One rule, two readers. functions/src/media/imageSizes.cjs writes the
 * sizes, and apps/web asks for them through srcset. Both read this module,
 * so the paths one writes are the paths the other asks for.
 *
 * WHICH UPLOADS GET SIZES. Only the server-written public namespaces, and
 * only at the depth their upload handler writes:
 *
 *   cms-images/{assetId}/{name}              mediaUpload
 *   branding/{assetId}/{name}                mediaUpload (operator)
 *   speaker-photos/{speakerId}/{assetId}/{name}  speakerPhotoUpload
 *
 * Every one of those folders holds exactly one original, because the
 * handler makes a fresh assetId for each upload. So the sizes can sit in a
 * fixed folder beside it, and no lookup is needed to find them.
 *
 * Out of scope on purpose: flat seeded branding (it ships in the site
 * bundle), SVG and GIF (vector or animated), profile-photos (already bounded
 * to 512 pixels by its upload endpoint), session-materials (closed to public reads), and
 * exports.
 *
 * WHERE THE SIZES LIVE. `{folder}/_sizes/{generation}/{width}.webp`,
 * one folder per generation of the original, and
 * `{folder}/_sizes/manifest.json`, which records what was written or why
 * nothing was. A run for an overwritten generation writes into its own
 * folder, so it can never pass its copies off as the new image's. A path
 * with a `_sizes` segment is never a source, so a size the function writes
 * cannot start another run of the function.
 *
 * WHAT THE PAGE ASKS FOR. Only widths narrower than the original are
 * written, and a copy is never enlarged. The page reads the manifest and
 * lists each copy at its real width, plus the original at its own width,
 * so every srcset descriptor states the file's true width.
 */

/** The fixed widths, smallest first. */
const IMAGE_SIZE_WIDTHS = Object.freeze([320, 640, 1280, 1920]);

/** Every size is WebP. The original stays as the fallback. */
const IMAGE_SIZE_TYPE = 'image/webp';

/** The folder segment that holds the sizes. */
const IMAGE_SIZE_SEGMENT = '_sizes';

/** Folder name → number of id segments between it and the file name. */
const SOURCE_FOLDERS = Object.freeze({
  'cms-images': 1,
  branding: 1,
  'speaker-photos': 2,
});

/** An id segment: what Firestore ids and the upload asset ids look like. */
const ID_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** A raster file name as the upload handlers write it (safeObjectName). */
const RASTER_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.(?:png|jpe?g|webp)$/i;

/**
 * The folder an upload's sizes belong to, or null when the path is not an
 * upload the function makes sizes for.
 *
 * @param {unknown} path a Storage object path
 * @returns {{ folder: string, dir: string } | null}
 */
function imageSizeSource(path) {
  if (typeof path !== 'string') return null;
  const segments = path.split('/');
  const folder = segments[0];
  if (!Object.prototype.hasOwnProperty.call(SOURCE_FOLDERS, folder)) return null;
  const idCount = SOURCE_FOLDERS[folder];
  if (segments.length !== idCount + 2) return null;
  const ids = segments.slice(1, 1 + idCount);
  if (!ids.every((id) => ID_SEGMENT.test(id) && id !== IMAGE_SIZE_SEGMENT)) return null;
  if (!RASTER_NAME.test(segments[segments.length - 1])) return null;
  return { folder, dir: segments.slice(0, -1).join('/') };
}

/**
 * The sizes folder and manifest for one upload, or null when it gets none.
 *
 * @param {unknown} path
 * @returns {{ prefix: string, manifest: string } | null}
 */
function imageSizePaths(path) {
  const source = imageSizeSource(path);
  if (!source) return null;
  const prefix = `${source.dir}/${IMAGE_SIZE_SEGMENT}/`;
  return { prefix, manifest: `${prefix}manifest.json` };
}

/** A Storage object generation: a decimal number, as GCS reports it. */
const GENERATION = /^[0-9]{1,24}$/;

/**
 * The path of one copy, for one generation of the original.
 *
 * @param {unknown} path the original
 * @param {unknown} generation the original's generation
 * @param {number} width one of IMAGE_SIZE_WIDTHS
 * @returns {string|null}
 */
function imageSizeCopyPath(path, generation, width) {
  const paths = imageSizePaths(path);
  if (!paths || typeof generation !== 'string' || !GENERATION.test(generation)) return null;
  if (!IMAGE_SIZE_WIDTHS.includes(width)) return null;
  return `${paths.prefix}${generation}/${width}.webp`;
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

/**
 * Read a manifest the function wrote, for the page. Returns the copies the
 * page may list, each at its real width, and the original's width; or null
 * when the manifest is not a ready manifest for this very object.
 *
 * The manifest is public data read over the network, so every field is
 * checked: a copy must sit at this source's own copy path for the stated
 * generation, and be narrower than the original.
 *
 * @param {unknown} path the original
 * @param {unknown} manifest the parsed manifest.json
 * @returns {{ generation: string, width: number,
 *             sizes: Array<{ width: number, path: string }> } | null}
 */
function readImageSizeManifest(path, manifest) {
  if (!imageSizePaths(path)) return null;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return null;
  if (manifest.status !== 'ready' || manifest.source !== path) return null;
  const generation = manifest.sourceGeneration;
  if (typeof generation !== 'string' || !GENERATION.test(generation)) return null;
  if (!positiveInteger(manifest.width)) return null;
  const byWidth = new Map();
  for (const size of Array.isArray(manifest.sizes) ? manifest.sizes : []) {
    if (!size || typeof size !== 'object') continue;
    const { target, width } = size;
    if (!positiveInteger(width) || width >= manifest.width || width > target) continue;
    const expected = imageSizeCopyPath(path, generation, target);
    if (!expected || size.path !== expected) continue;
    if (!byWidth.has(width)) byWidth.set(width, { width, path: expected });
  }
  const sizes = [...byWidth.values()].sort((a, b) => a.width - b.width);
  return { generation, width: manifest.width, sizes };
}

/**
 * Whether a path is inside a sizes folder, which is to say something the
 * function wrote.
 *
 * @param {unknown} path
 * @returns {boolean}
 */
function isImageSizePath(path) {
  return typeof path === 'string' && path.split('/').includes(IMAGE_SIZE_SEGMENT);
}

module.exports = {
  IMAGE_SIZE_WIDTHS,
  IMAGE_SIZE_TYPE,
  IMAGE_SIZE_SEGMENT,
  imageSizeSource,
  imageSizePaths,
  imageSizeCopyPath,
  isImageSizePath,
  readImageSizeManifest,
};
