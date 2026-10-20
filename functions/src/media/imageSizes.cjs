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
 * (packages/shared/src/imageSizes.cjs):
 * `{folder}/_sizes/{generation}/{width}.webp` beside an upload in
 * cms-images/, branding/ or speaker-photos/. Only widths narrower than the
 * original are written, so the manifest lists every copy at its real width
 * and the page can state true srcset widths (Codex review on #538).
 *
 * ONE GENERATION PER RUN. An event names one generation of the original.
 * The run reads that generation's bytes, writes into that generation's
 * folder, and checks that the name still holds that generation before it
 * writes copies and again after it writes the manifest. If the original
 * was overwritten meanwhile, the run removes its own folder and its
 * manifest, and the run for the newer generation writes the real ones. A
 * finished run removes the folders of earlier generations.
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
 * keeps the folder, and the new generation's run clears the old copies.
 * If the original is deleted while sizes are being written, this trigger
 * checks again at the end and removes what it wrote.
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
  imageSizeCopyPath,
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
  // Only widths narrower than the original. A copy at or above it would be
  // the original re-encoded, listed at a width it does not have; the page
  // lists the original itself at its own width instead.
  for (const target of IMAGE_SIZE_WIDTHS.filter((candidate) => candidate < width)) {
    let output;
    try {
      // rotate() with no angle applies the EXIF orientation. sharp writes
      // no metadata unless asked (keepMetadata/withMetadata), so the output
      // carries no EXIF, GPS, XMP or ICC block.
      output = await sharp(buffer, inputOptions())
        .rotate()
        .resize({ width: target })
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

async function removeSizes(bucket, prefix, keep = () => false) {
  const [files] = await bucket.getFiles({ prefix });
  let removed = 0;
  for (const file of files) {
    if (keep(file.name)) continue;
    await file.delete({ ignoreNotFound: true });
    removed += 1;
  }
  return removed;
}

/** A GCS generation as the event states it, or null. */
function eventGeneration(object) {
  const value = object?.generation == null ? '' : String(object.generation);
  return /^[0-9]{1,24}$/.test(value) ? value : null;
}

/**
 * The finalize handler. Takes the event's object data (name, size,
 * contentType, metadata, generation).
 *
 * @param {{ bucket: object, log?: Pick<Console,'warn'|'error'|'info'>,
 *           now?: () => number, render?: typeof renderImageSizes }} deps
 */
function createImageSizesHandler({ bucket, log = console, now = Date.now, render = renderImageSizes }) {
  /** Whether the name still holds this generation: 'current', 'stale' or 'gone'. */
  async function sourceState(name, generation) {
    try {
      const [meta] = await bucket.file(name).getMetadata();
      return String(meta?.generation) === generation ? 'current' : 'stale';
    } catch (err) {
      if (isNotFound(err)) return 'gone';
      throw err;
    }
  }

  async function readManifest(paths) {
    try {
      const [buffer] = await bucket.file(paths.manifest).download();
      return JSON.parse(buffer.toString('utf8'));
    } catch {
      return null;
    }
  }

  async function writeManifest(name, paths, generation, fields) {
    const manifest = {
      version: MANIFEST_VERSION,
      source: name,
      sourceGeneration: generation,
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

  /**
   * Write the manifest, then look again. If the name moved on while it was
   * written, take back this run's copies and its manifest; the newer
   * generation's run writes its own.
   */
  async function publish(name, paths, generation, fields) {
    await writeManifest(name, paths, generation, fields);
    const state = await sourceState(name, generation);
    if (state === 'current') return 'current';
    if (state === 'gone') {
      await removeSizes(bucket, paths.prefix);
      return 'gone';
    }
    await removeSizes(bucket, `${paths.prefix}${generation}/`);
    const stored = await readManifest(paths);
    if (stored?.sourceGeneration === generation) {
      await bucket.file(paths.manifest).delete({ ignoreNotFound: true });
    }
    return 'stale';
  }

  const outcome = (state, result) => {
    if (state === 'stale') return { status: 'stale' };
    if (state === 'gone') return { status: 'source-gone' };
    return result;
  };

  return async function onImageFinalized(object) {
    const name = object?.name;
    // Our own output first, so a size write costs no more than this line.
    if (isImageSizePath(name)) return { status: 'skipped', reason: 'own-output' };
    if (object?.metadata?.imageSizeOf) return { status: 'skipped', reason: 'own-output' };
    const paths = imageSizePaths(name);
    if (!paths) return { status: 'skipped', reason: 'out-of-scope' };
    const generation = eventGeneration(object);
    if (!generation) return { status: 'skipped', reason: 'no-generation' };

    const initial = await sourceState(name, generation);
    if (initial !== 'current') return outcome(initial);

    const refuse = async (reason) => {
      log.warn(`mediaImageSizes refused ${name}: ${reason}`);
      const state = await publish(name, paths, generation, { status: 'refused', reason });
      return outcome(state, { status: 'refused', reason });
    };

    const declaredBytes = Number(object.size);
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_SOURCE_BYTES) return refuse('too-large');

    let buffer;
    try {
      // This generation's bytes, never whatever the name holds by now.
      [buffer] = await bucket.file(name, { generation }).download();
    } catch (err) {
      if (isNotFound(err)) return outcome(await sourceState(name, generation));
      throw err;
    }

    let rendered;
    try {
      rendered = await render(buffer);
    } catch (err) {
      if (err instanceof ImageSizeRefusal) return refuse(err.reason);
      log.error(`mediaImageSizes failed for ${name}`, err);
      const state = await publish(name, paths, generation, { status: 'failed', reason: 'processing-error' });
      return outcome(state, { status: 'failed', reason: 'processing-error' });
    }

    const beforeWrite = await sourceState(name, generation);
    if (beforeWrite !== 'current') return outcome(beforeWrite);

    const written = [];
    for (const size of rendered.sizes) {
      const path = imageSizeCopyPath(name, generation, size.target);
      await bucket.file(path).save(size.buffer, {
        resumable: false,
        contentType: IMAGE_SIZE_TYPE,
        metadata: {
          contentType: IMAGE_SIZE_TYPE,
          cacheControl: SIZE_CACHE_CONTROL,
          metadata: { imageSizeOf: name },
        },
      });
      written.push({ target: size.target, width: size.width, height: size.height, path, bytes: size.buffer.length });
    }
    const state = await publish(name, paths, generation, {
      status: 'ready',
      sourceType: rendered.type,
      width: rendered.width,
      height: rendered.height,
      sizes: written,
    });
    if (state !== 'current') return outcome(state);

    // Copies of earlier generations of this name are no longer listed.
    const ours = `${paths.prefix}${generation}/`;
    await removeSizes(bucket, paths.prefix, (path) => path === paths.manifest || path.startsWith(ours));
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
      // and two at once could pass the limit. Each upload also fires up to
      // five short runs for its own writes, so the cap leaves room for those;
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
