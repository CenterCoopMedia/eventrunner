'use strict';

/**
 * `mediaImageSizes` and `mediaImageSizesCleanup` (issue #333): display
 * sizes for uploaded images.
 *
 * A speaker list or a sponsor wall should not make every visitor download
 * every original upload. When an upload lands, this trigger writes a few
 * fixed widths as WebP beside it, with a manifest. The public pages offer
 * them through srcset and keep the original as the src, so the original is
 * also the fallback. The original is never changed or removed here.
 *
 * Which uploads, and where the sizes go, is one shared rule
 * (packages/shared/src/imageSizes.cjs): `{folder}/_sizes/{width}.webp`
 * beside an upload in cms-images/, branding/ or speaker-photos/.
 *
 * WHAT THIS TRIGGER DOES NOT TRUST:
 *
 *   • The declared content type. The bytes are sniffed, and the decoder's
 *     own reading of the format must agree with the sniff. A file that is
 *     not a PNG, JPEG or WebP gets no sizes.
 *   • The size. The event's byte count is checked before the download,
 *     and the buffer again after it.
 *   • The pixel count. A small file can declare a huge canvas (a
 *     decompression bomb). The header is read first and the image is
 *     refused above MAX_INPUT_PIXELS, and sharp's own limitInputPixels
 *     holds the same bound while it decodes.
 *   • The metadata. Sizes are re-encoded from pixels, turned upright from
 *     the EXIF orientation first, and written with no EXIF, GPS, XMP or
 *     ICC block. The original keeps whatever the uploader sent.
 *
 * NO LOOPS. Every size and the manifest are themselves new objects, so
 * each one fires this trigger again. Those runs stop at the first check:
 * a path with a `_sizes` segment is never a source, and each write also
 * carries an `imageSizeOf` metadata stamp the trigger reads as "mine".
 * They cost one short invocation each and never download anything.
 *
 * LIFECYCLE. Sizes live as long as their original. The cleanup trigger
 * removes the `_sizes/` folder when the original is deleted, whichever
 * handler deleted it (mediaDelete, speakerPhotoDelete, a superseded
 * headshot, a console delete). An overwrite also fires a delete event for
 * the old generation; cleanup then sees the original still there and
 * keeps the sizes. If the original is deleted while sizes are being
 * written, this trigger checks again at the end and removes what it wrote.
 *
 * FAILURE. A refused or failed image gets a manifest that says why, and no
 * sizes. The page then fails to load the first size, drops the srcset,
 * and shows the original, as it did before this feature. Retries are off:
 * a bad file stays bad, and a retry would only repeat the cost.
 */

const {
  IMAGE_SIZE_WIDTHS,
  IMAGE_SIZE_TYPE,
  imageSizePaths,
  isImageSizePath,
} = require('shared/imageSizes');

/** The media library's own upload cap (upload.cjs MAX_UPLOAD_BYTES). */
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;

/**
 * 40 megapixels: an 8000 x 5000 photo. Decoded as RGBA that is 160 MB,
 * which fits the function's memory with room for the encode.
 */
const MAX_INPUT_PIXELS = 40_000_000;

const WEBP_QUALITY = 80;

/** The same caching the originals get (upload.cjs CACHE_CONTROL). */
const SIZE_CACHE_CONTROL = 'public, max-age=3600';
const MANIFEST_CACHE_CONTROL = 'no-cache';

const MANIFEST_VERSION = 1;

/** Sniffed type → the format name sharp reports for it. */
const DECODER_FORMAT = Object.freeze({
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
});

class ImageSizeRefusal extends Error {
  /** @param {string} reason a short machine-readable code */
  constructor(reason, message = reason) {
    super(message);
    this.name = 'ImageSizeRefusal';
    this.reason = reason;
  }
}

/**
 * The image type the bytes say they are, from their magic numbers.
 *
 * @param {Buffer} buffer
 * @returns {'image/png'|'image/jpeg'|'image/webp'|'image/gif'|null}
 */
function sniffImageType(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (
    buffer.length >= 8
    && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 12
    && buffer.toString('latin1', 0, 4) === 'RIFF'
    && buffer.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (buffer.length >= 6 && /^GIF8[79]a$/.test(buffer.toString('latin1', 0, 6))) {
    return 'image/gif';
  }
  return null;
}

/** sharp input options shared by the header read and every encode. */
function inputOptions() {
  return {
    limitInputPixels: MAX_INPUT_PIXELS,
    // Refuse truncated and corrupt data instead of encoding garbage.
    failOn: 'error',
    // The first frame only. Animated files are refused before this matters.
    pages: 1,
    sequentialRead: true,
  };
}

function isPixelLimitError(err) {
  return /pixel limit/i.test(String(err?.message ?? ''));
}

/**
 * Render every display size of one image. Pure apart from the decoder.
 *
 * @param {Buffer} buffer the original's bytes
 * @param {{ sharp?: Function }} [deps]
 * @returns {Promise<{ type: string, width: number, height: number,
 *   sizes: Array<{ target: number, width: number, height: number, buffer: Buffer }> }>}
 * @throws {ImageSizeRefusal}
 */
async function renderImageSizes(buffer, { sharp = require('sharp') } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new ImageSizeRefusal('not-an-image');
  if (buffer.length > MAX_SOURCE_BYTES) throw new ImageSizeRefusal('too-large');
  const type = sniffImageType(buffer);
  if (!type) throw new ImageSizeRefusal('not-an-image');
  if (!Object.prototype.hasOwnProperty.call(DECODER_FORMAT, type)) {
    throw new ImageSizeRefusal('unsupported-type');
  }

  // The header only. sharp reads dimensions without decoding pixels.
  let meta;
  try {
    meta = await sharp(buffer, inputOptions()).metadata();
  } catch (err) {
    throw new ImageSizeRefusal(isPixelLimitError(err) ? 'too-many-pixels' : 'unreadable');
  }
  if (meta.format !== DECODER_FORMAT[type]) throw new ImageSizeRefusal('not-an-image');
  if (!(meta.width > 0) || !(meta.height > 0)) throw new ImageSizeRefusal('unreadable');
  if (meta.width * meta.height > MAX_INPUT_PIXELS) throw new ImageSizeRefusal('too-many-pixels');
  if ((meta.pages ?? 1) > 1) throw new ImageSizeRefusal('animated');

  // EXIF orientations 5 to 8 swap the axes once the image is upright.
  const turned = meta.orientation >= 5 && meta.orientation <= 8;
  const width = turned ? meta.height : meta.width;
  const height = turned ? meta.width : meta.height;

  const sizes = [];
  for (const target of IMAGE_SIZE_WIDTHS) {
    let output;
    try {
      // rotate() with no angle applies the EXIF orientation. sharp writes
      // no metadata unless asked (keepMetadata/withMetadata), so the output
      // carries no EXIF, GPS, XMP or ICC block.
      output = await sharp(buffer, inputOptions())
        .rotate()
        .resize({ width: target, withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer({ resolveWithObject: true });
    } catch (err) {
      throw new ImageSizeRefusal(isPixelLimitError(err) ? 'too-many-pixels' : 'unreadable');
    }
    sizes.push({ target, width: output.info.width, height: output.info.height, buffer: output.data });
  }
  return { type, width, height, sizes };
}

function isNotFound(err) {
  return err?.code === 404 || /no such object/i.test(String(err?.message ?? ''));
}

async function removeSizes(bucket, prefix) {
  const [files] = await bucket.getFiles({ prefix });
  for (const file of files) {
    await file.delete({ ignoreNotFound: true });
  }
  return files.length;
}

/**
 * The finalize handler. Takes the event's object data (name, size,
 * contentType, metadata, generation).
 *
 * @param {{ bucket: object, log?: Pick<Console,'warn'|'error'|'info'>,
 *           now?: () => number, render?: typeof renderImageSizes }} deps
 */
function createImageSizesHandler({ bucket, log = console, now = Date.now, render = renderImageSizes }) {
  async function writeManifest(name, paths, object, fields) {
    const manifest = {
      version: MANIFEST_VERSION,
      source: name,
      sourceGeneration: object?.generation == null ? null : String(object.generation),
      type: IMAGE_SIZE_TYPE,
      sizes: [],
      ...fields,
      createdAt: new Date(now()).toISOString(),
    };
    await bucket.file(paths.manifest).save(Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`), {
      resumable: false,
      contentType: 'application/json',
      metadata: {
        contentType: 'application/json',
        cacheControl: MANIFEST_CACHE_CONTROL,
        metadata: { imageSizeOf: name },
      },
    });
    return manifest;
  }

  return async function onImageFinalized(object) {
    const name = object?.name;
    // Our own output first, so a size write costs no more than this line.
    if (isImageSizePath(name)) return { status: 'skipped', reason: 'own-output' };
    if (object?.metadata?.imageSizeOf) return { status: 'skipped', reason: 'own-output' };
    const paths = imageSizePaths(name);
    if (!paths) return { status: 'skipped', reason: 'out-of-scope' };

    const declaredBytes = Number(object.size);
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_SOURCE_BYTES) {
      log.warn(`mediaImageSizes refused ${name}: too-large`);
      await writeManifest(name, paths, object, { status: 'refused', reason: 'too-large' });
      return { status: 'refused', reason: 'too-large' };
    }

    let buffer;
    try {
      [buffer] = await bucket.file(name).download();
    } catch (err) {
      if (isNotFound(err)) return { status: 'source-gone' };
      throw err;
    }

    let rendered;
    try {
      rendered = await render(buffer);
    } catch (err) {
      if (err instanceof ImageSizeRefusal) {
        log.warn(`mediaImageSizes refused ${name}: ${err.reason}`);
        await writeManifest(name, paths, object, { status: 'refused', reason: err.reason });
        return { status: 'refused', reason: err.reason };
      }
      log.error(`mediaImageSizes failed for ${name}`, err);
      await writeManifest(name, paths, object, { status: 'failed', reason: 'processing-error' });
      return { status: 'failed', reason: 'processing-error' };
    }

    const written = [];
    for (const size of rendered.sizes) {
      const target = paths.sizes.find((entry) => entry.width === size.target);
      await bucket.file(target.path).save(size.buffer, {
        resumable: false,
        contentType: IMAGE_SIZE_TYPE,
        metadata: {
          contentType: IMAGE_SIZE_TYPE,
          cacheControl: SIZE_CACHE_CONTROL,
          metadata: { imageSizeOf: name },
        },
      });
      written.push({
        target: size.target,
        width: size.width,
        height: size.height,
        path: target.path,
        bytes: size.buffer.length,
      });
    }
    await writeManifest(name, paths, object, {
      status: 'ready',
      sourceType: rendered.type,
      width: rendered.width,
      height: rendered.height,
      sizes: written,
    });

    // The original may have been deleted while this ran, and its cleanup
    // may already have found an empty folder. Look again.
    const [stillThere] = await bucket.file(name).exists();
    if (!stillThere) {
      await removeSizes(bucket, paths.prefix);
      return { status: 'source-gone' };
    }
    return { status: 'ready', sizes: written.length };
  };
}

/**
 * The delete handler: remove an original's sizes once it is gone.
 *
 * @param {{ bucket: object, log?: Pick<Console,'warn'|'error'|'info'> }} deps
 */
function createImageSizesCleanupHandler({ bucket, log = console }) {
  return async function onImageDeleted(object) {
    const name = object?.name;
    if (isImageSizePath(name)) return { status: 'skipped', reason: 'own-output' };
    const paths = imageSizePaths(name);
    if (!paths) return { status: 'skipped', reason: 'out-of-scope' };
    // A delete event also fires for the old generation of an overwritten
    // object. The original is still there then, and so are its uses.
    const [stillThere] = await bucket.file(name).exists();
    if (stillThere) return { status: 'skipped', reason: 'overwritten' };
    const removed = await removeSizes(bucket, paths.prefix);
    if (removed > 0) log.info?.(`mediaImageSizesCleanup removed ${removed} object(s) for ${name}`);
    return { status: 'removed', removed };
  };
}

/**
 * The deployable triggers, on the event's own bucket (EVENT_STORAGE_BUCKET,
 * the bucket every upload handler writes through core/storage.cjs).
 *
 * The deploy always has the variable: packages/shared/src/config/deploy.cjs
 * requires it, and the deploy writes it to functions/.env, which
 * firebase-tools loads when it reads the triggers. The emulator reads the
 * triggers without that file, so it falls back to the project's default
 * bucket from FIREBASE_CONFIG, which firebase-tools always sets there.
 * A bare `require` of the barrel in a unit test has neither, and
 * firebase-functions throws at definition time without a bucket, so that
 * case exports nothing rather than guessing a bucket.
 */
function defaultBucket(env) {
  try {
    const bucket = JSON.parse(env.FIREBASE_CONFIG || '{}').storageBucket;
    return typeof bucket === 'string' ? bucket.trim() : '';
  } catch {
    return '';
  }
}

function buildHandlers(env = process.env) {
  const bucketName = (env.EVENT_STORAGE_BUCKET || '').trim() || defaultBucket(env);
  if (!bucketName) return {};
  const { onObjectFinalized, onObjectDeleted } = require('firebase-functions/v2/storage');
  const region = (env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  const runtimeBucket = () => require('../core/storage.cjs').getBucket();
  return {
    mediaImageSizes: onObjectFinalized({
      bucket: bucketName,
      region,
      memory: '1GiB',
      timeoutSeconds: 120,
      // One image at a time per instance: decoding is the memory cost,
      // and two at once could pass the limit. Each upload also fires five
      // short runs for its own writes, so the cap leaves room for those;
      // it still bounds the bill when many files land together.
      concurrency: 1,
      maxInstances: 10,
      retry: false,
    }, async (event) => {
      await createImageSizesHandler({ bucket: runtimeBucket() })(event.data);
    }),
    mediaImageSizesCleanup: onObjectDeleted({
      bucket: bucketName,
      region,
      memory: '256MiB',
      maxInstances: 5,
      retry: false,
    }, async (event) => {
      await createImageSizesCleanupHandler({ bucket: runtimeBucket() })(event.data);
    }),
  };
}

module.exports = {
  createImageSizesHandler,
  createImageSizesCleanupHandler,
  renderImageSizes,
  sniffImageType,
  ImageSizeRefusal,
  get handlers() {
    return buildHandlers();
  },
  internals: {
    MAX_SOURCE_BYTES,
    MAX_INPUT_PIXELS,
    WEBP_QUALITY,
    SIZE_CACHE_CONTROL,
    MANIFEST_CACHE_CONTROL,
    buildHandlers,
  },
};
