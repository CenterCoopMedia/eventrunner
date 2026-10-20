'use strict';

// Issue #333: display sizes for uploaded images.
//
// The fixtures are small images that sharp draws in memory, so the suite
// needs no binary files and no network. The bomb fixture is a hand-built
// PNG header that claims a huge canvas over a few bytes of data: the
// function must refuse it from the header, without decoding it.

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const sharp = require('sharp');

const {
  createImageSizesHandler,
  createImageSizesCleanupHandler,
  renderImageSizes,
  sniffImageType,
  internals: { MAX_SOURCE_BYTES, MAX_INPUT_PIXELS, SIZE_CACHE_CONTROL },
} = require('./imageSizes.cjs');

const SOURCE = 'speaker-photos/spk_1/a1b2c3/face.jpg';
const PREFIX = 'speaker-photos/spk_1/a1b2c3/_sizes/';
const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);

/** A camera-style JPEG: landscape pixels, EXIF orientation 6, and GPS tags. */
async function cameraJpeg({ width = 2400, height = 1600 } = {}) {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } })
    .jpeg({ quality: 80 })
    .withMetadata({ orientation: 6 })
    .withExif({
      IFD0: { Make: 'FixtureCam', Model: 'One' },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '40/1 44/1 0/1',
        GPSLongitudeRef: 'W',
        GPSLongitude: '74/1 0/1 0/1',
      },
    })
    .toBuffer();
}

async function smallPng({ width = 200, height = 120 } = {}) {
  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 80, b: 160, alpha: 1 } } })
    .png()
    .toBuffer();
}

function pngChunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

/** A valid PNG header that claims width x height over one tiny IDAT. */
function bombPng(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(Buffer.alloc(64))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Bucket fake: objects by path, each with a GCS-style generation. A seeded
 * object is generation '1'; every save makes a new, higher one. The save
 * options are kept so the tests can read the metadata each write carried.
 */
function fakeBucket(seed = {}) {
  let nextGeneration = 100;
  const objects = new Map(
    Object.entries(seed).map(([path, buffer]) => [path, { buffer, options: {}, generation: '1' }]),
  );
  const calls = { download: [], save: [], delete: [], list: [], metadata: [] };
  const notFound = (path) => Object.assign(new Error(`No such object: ${path}`), { code: 404 });
  const bucket = {
    objects,
    calls,
    /** Replace an object's bytes the way an overwrite does: a new generation. */
    overwrite(path, buffer) {
      nextGeneration += 1;
      objects.set(path, { buffer, options: {}, generation: String(nextGeneration) });
    },
    file(path, { generation } = {}) {
      return {
        name: path,
        async download() {
          calls.download.push(generation ? `${path}#${generation}` : path);
          const object = objects.get(path);
          if (!object || (generation && object.generation !== String(generation))) throw notFound(path);
          return [object.buffer];
        },
        async getMetadata() {
          calls.metadata.push(path);
          const object = objects.get(path);
          if (!object) throw notFound(path);
          return [{ name: path, generation: object.generation }];
        },
        async save(buffer, options) {
          calls.save.push(path);
          nextGeneration += 1;
          objects.set(path, { buffer, options, generation: String(nextGeneration) });
        },
        async exists() {
          return [objects.has(path)];
        },
        async delete() {
          calls.delete.push(path);
          objects.delete(path);
        },
      };
    },
    async getFiles({ prefix }) {
      calls.list.push(prefix);
      return [[...objects.keys()].filter((key) => key.startsWith(prefix)).map((key) => bucket.file(key))];
    },
  };
  return bucket;
}

const quietLog = { warn() {}, error() {}, info() {} };

function finalized(name, overrides = {}) {
  return { name, contentType: 'image/jpeg', size: '1000', metadata: {}, generation: '1', ...overrides };
}

function manifestOf(bucket) {
  const saved = bucket.objects.get(`${PREFIX}manifest.json`);
  return saved ? JSON.parse(saved.buffer.toString('utf8')) : null;
}

function webpKeys(bucket) {
  return [...bucket.objects.keys()].filter((key) => key.endsWith('.webp')).sort();
}

// ------------------------------------------------------------- sniffing

test('sniffImageType reads the bytes, not the declared type', async () => {
  assert.equal(sniffImageType(await cameraJpeg({ width: 40, height: 30 })), 'image/jpeg');
  assert.equal(sniffImageType(await smallPng()), 'image/png');
  const webp = await sharp(await smallPng()).webp().toBuffer();
  assert.equal(sniffImageType(webp), 'image/webp');
  assert.equal(sniffImageType(Buffer.from('GIF89a......')), 'image/gif');
  assert.equal(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
  assert.equal(sniffImageType(Buffer.from('<html><script>alert(1)</script>')), null);
  assert.equal(sniffImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47])), null);
  assert.equal(sniffImageType(Buffer.alloc(0)), null);
});

// ------------------------------------------------------------- rendering

test('renderImageSizes writes each narrower width as WebP, upright, with no EXIF or GPS', async () => {
  const source = await cameraJpeg();
  const before = await sharp(source).metadata();
  assert.ok(before.exif && before.exif.length > 0, 'the fixture carries EXIF');
  assert.equal(before.orientation, 6);

  const result = await renderImageSizes(source);
  assert.equal(result.type, 'image/jpeg');
  // Orientation 6 turns the 2400x1600 pixels upright: 1600 wide, 2400 tall.
  assert.equal(result.width, 1600);
  assert.equal(result.height, 2400);
  // 1920 is not narrower than the 1600 px original, so the original serves
  // that width itself (Codex review on #538).
  assert.deepEqual(result.sizes.map((size) => [size.target, size.width]), [[320, 320], [640, 640], [1280, 1280]]);

  for (const size of result.sizes) {
    const meta = await sharp(size.buffer).metadata();
    assert.equal(meta.format, 'webp');
    assert.equal(meta.width, size.width);
    assert.equal(meta.height, size.height);
    assert.ok(meta.height > meta.width, 'the size is upright');
    assert.equal(meta.exif, undefined, 'no EXIF block');
    assert.equal(meta.orientation, undefined, 'no orientation tag');
    assert.equal(size.buffer.includes(Buffer.from('EXIF')), false, 'no EXIF chunk');
    assert.equal(size.buffer.includes(Buffer.from('FixtureCam')), false, 'no camera make');
  }
});

// Codex review on #538: a copy no narrower than its original would be
// listed at a width it does not have. Such widths are not written.
test('renderImageSizes writes no copy at or above the original width', async () => {
  const small = await renderImageSizes(await smallPng({ width: 200, height: 120 }));
  assert.equal(small.width, 200);
  assert.deepEqual(small.sizes, []);
  const exact = await renderImageSizes(await smallPng({ width: 640, height: 100 }));
  assert.deepEqual(exact.sizes.map((size) => size.width), [320]);
});

test('renderImageSizes refuses bytes that are not a supported raster image', async () => {
  await assert.rejects(renderImageSizes(Buffer.from('<html>not an image</html>')), {
    reason: 'not-an-image',
  });
  await assert.rejects(renderImageSizes(Buffer.from('GIF89a\x01\x00\x01\x00')), {
    reason: 'unsupported-type',
  });
});

test('renderImageSizes refuses a pixel bomb from its header, before decoding', async () => {
  const bomb = bombPng(50_000, 50_000);
  assert.ok(bomb.length < 200, 'the bomb is a few bytes on disk');
  assert.ok(50_000 * 50_000 > MAX_INPUT_PIXELS);
  const started = Date.now();
  await assert.rejects(renderImageSizes(bomb), { reason: 'too-many-pixels' });
  assert.ok(Date.now() - started < 2000, 'refused without decoding');
});

test('renderImageSizes refuses a file over the byte cap', async () => {
  await assert.rejects(renderImageSizes(Buffer.alloc(MAX_SOURCE_BYTES + 1)), { reason: 'too-large' });
});

test('renderImageSizes refuses a truncated image', async () => {
  const whole = await cameraJpeg({ width: 400, height: 300 });
  await assert.rejects(renderImageSizes(whole.subarray(0, Math.floor(whole.length / 2))), {
    reason: 'unreadable',
  });
});

// ------------------------------------------------------------- the trigger

test('the trigger writes each copy under the original generation, and a manifest of real widths', async () => {
  const original = await cameraJpeg();
  const bucket = fakeBucket({ [SOURCE]: original });
  const handler = createImageSizesHandler({ bucket, log: quietLog, now: () => NOW });

  const result = await handler(finalized(SOURCE, { size: String(original.length) }));
  assert.equal(result.status, 'ready');
  // The bytes read were that generation's, not whatever the name holds now.
  assert.deepEqual(bucket.calls.download, [`${SOURCE}#1`]);

  assert.deepEqual(webpKeys(bucket), [`${PREFIX}1/1280.webp`, `${PREFIX}1/320.webp`, `${PREFIX}1/640.webp`]);
  for (const key of webpKeys(bucket)) {
    const saved = bucket.objects.get(key);
    assert.equal(saved.options.contentType, 'image/webp');
    assert.equal(saved.options.metadata.cacheControl, SIZE_CACHE_CONTROL);
    assert.equal(saved.options.metadata.metadata.imageSizeOf, SOURCE);
  }
  // The original stays exactly as uploaded.
  assert.equal(bucket.objects.get(SOURCE).buffer, original);

  const manifest = manifestOf(bucket);
  assert.equal(manifest.status, 'ready');
  assert.equal(manifest.source, SOURCE);
  assert.equal(manifest.sourceGeneration, '1');
  assert.equal(manifest.sourceType, 'image/jpeg');
  assert.equal(manifest.width, 1600);
  assert.equal(manifest.height, 2400);
  assert.equal(manifest.createdAt, new Date(NOW).toISOString());
  assert.deepEqual(manifest.sizes.map((size) => [size.target, size.width, size.path]), [
    [320, 320, `${PREFIX}1/320.webp`],
    [640, 640, `${PREFIX}1/640.webp`],
    [1280, 1280, `${PREFIX}1/1280.webp`],
  ]);
  assert.ok(manifest.sizes.every((size) => size.bytes > 0));
  // The manifest is public, like the image: it names no person.
  assert.doesNotMatch(JSON.stringify(manifest), /@/);
});

test('a small original gets a ready manifest with no copies', async () => {
  const original = await smallPng({ width: 200, height: 120 });
  const name = 'cms-images/a1b2c3/logo.png';
  const bucket = fakeBucket({ [name]: original });
  const handler = createImageSizesHandler({ bucket, log: quietLog, now: () => NOW });
  const result = await handler(finalized(name, { size: String(original.length), contentType: 'image/png' }));
  assert.equal(result.status, 'ready');
  assert.deepEqual(webpKeys(bucket), []);
  const manifest = JSON.parse(bucket.objects.get('cms-images/a1b2c3/_sizes/manifest.json').buffer.toString('utf8'));
  assert.equal(manifest.width, 200);
  assert.deepEqual(manifest.sizes, []);
});

// Codex review on #538: a run for an older generation must never leave
// its copies or its manifest behind once the name holds newer bytes.
test('a run for a generation already overwritten writes nothing', async () => {
  const bucket = fakeBucket({ [SOURCE]: await cameraJpeg({ width: 800, height: 600 }) });
  bucket.overwrite(SOURCE, await cameraJpeg({ width: 900, height: 600 }));
  const handler = createImageSizesHandler({ bucket, log: quietLog, now: () => NOW });
  const result = await handler(finalized(SOURCE, { generation: '1' }));
  assert.equal(result.status, 'stale');
  assert.deepEqual(webpKeys(bucket), []);
  assert.equal(manifestOf(bucket), null);
});

test('a run whose original is overwritten while it renders discards its work', async () => {
  const bucket = fakeBucket({ [SOURCE]: await cameraJpeg({ width: 800, height: 600 }) });
  const newer = await cameraJpeg({ width: 900, height: 600 });
  const render = async (buffer) => {
    const rendered = await renderImageSizes(buffer);
    bucket.overwrite(SOURCE, newer);
    return rendered;
  };
  const handler = createImageSizesHandler({ bucket, log: quietLog, now: () => NOW, render });
  const result = await handler(finalized(SOURCE, { generation: '1' }));
  assert.equal(result.status, 'stale');
  assert.deepEqual(webpKeys(bucket), []);
  assert.equal(manifestOf(bucket), null);
});

test('a run whose original is overwritten after its manifest takes the manifest back', async () => {
  const bucket = fakeBucket({ [SOURCE]: await cameraJpeg({ width: 800, height: 600 }) });
  const newer = await cameraJpeg({ width: 900, height: 600 });
  let checks = 0;
  const realFile = bucket.file;
  bucket.file = (path, options) => {
    const file = realFile(path, options);
    if (path === SOURCE && !options) {
      const getMetadata = file.getMetadata;
      file.getMetadata = async () => {
        checks += 1;
        // The last check, after the manifest write, sees the overwrite.
        if (checks === 3) bucket.overwrite(SOURCE, newer);
        return getMetadata();
      };
    }
    return file;
  };
  const handler = createImageSizesHandler({ bucket, log: quietLog, now: () => NOW });
  const result = await handler(finalized(SOURCE, { generation: '1' }));
  assert.equal(result.status, 'stale');
  assert.deepEqual(webpKeys(bucket), []);
  assert.equal(manifestOf(bucket), null);
});

test('a later generation keeps its manifest when an earlier run finishes last', async () => {
  const bucket = fakeBucket({ [SOURCE]: await cameraJpeg({ width: 800, height: 600 }) });
  bucket.overwrite(SOURCE, await cameraJpeg({ width: 900, height: 600 }));
  const current = bucket.objects.get(SOURCE).generation;
  const handler = createImageSizesHandler({ bucket, log: quietLog, now: () => NOW });
  assert.equal((await handler(finalized(SOURCE, { generation: current }))).status, 'ready');
  assert.equal((await handler(finalized(SOURCE, { generation: '1' }))).status, 'stale');
  assert.equal(manifestOf(bucket).sourceGeneration, current);
  assert.equal(manifestOf(bucket).width, 600);
  assert.ok(webpKeys(bucket).every((key) => key.startsWith(`${PREFIX}${current}/`)));
});

test('a new generation removes the copies of earlier generations', async () => {
  const bucket = fakeBucket({
    [SOURCE]: await cameraJpeg({ width: 800, height: 600 }),
    [`${PREFIX}0/320.webp`]: Buffer.from('old'),
  });
  const handler = createImageSizesHandler({ bucket, log: quietLog, now: () => NOW });
  assert.equal((await handler(finalized(SOURCE))).status, 'ready');
  assert.deepEqual(webpKeys(bucket), [`${PREFIX}1/320.webp`]);
});

test('an event with no generation is skipped without a download', async () => {
  const bucket = fakeBucket({ [SOURCE]: Buffer.from('x') });
  const handler = createImageSizesHandler({ bucket, log: quietLog, now: () => NOW });
  for (const generation of [undefined, '', 'abc']) {
    assert.equal((await handler(finalized(SOURCE, { generation }))).status, 'skipped');
  }
  assert.deepEqual(bucket.calls.download, []);
});

test('the trigger ignores its own output, so a write never starts another run', async () => {
  const bucket = fakeBucket();
  const handler = createImageSizesHandler({ bucket, log: quietLog, now: () => NOW });
  for (const name of [`${PREFIX}1/320.webp`, `${PREFIX}manifest.json`]) {
    const result = await handler(finalized(name, { contentType: 'image/webp' }));
    assert.equal(result.status, 'skipped');
  }
  // Belt and braces: the metadata stamp alone also stops it.
  const stamped = await handler(finalized(SOURCE, { metadata: { imageSizeOf: SOURCE } }));
  assert.equal(stamped.status, 'skipped');
  assert.deepEqual(bucket.calls.download, []);
  assert.deepEqual(bucket.calls.save, []);
});

test('the trigger ignores paths outside the public library shapes without reading them', async () => {
  const bucket = fakeBucket();
  const handler = createImageSizesHandler({ bucket, log: quietLog, now: () => NOW });
  for (const name of [
    'profile-photos/uid-1/photo.jpg',
    'session-materials/s1/a/deck.png',
    'exports/schedule.pdf',
    'branding/logo.png',
    'cms-images/a1b2c3/logo.svg',
    'cms-images/../branding/a/x.png',
  ]) {
    assert.equal((await handler(finalized(name))).status, 'skipped', name);
  }
  assert.deepEqual(bucket.calls.download, []);
  assert.deepEqual(bucket.calls.save, []);
});

test('the trigger refuses an oversize object from the event, before downloading it', async () => {
  const bucket = fakeBucket({ [SOURCE]: Buffer.alloc(8) });
  const handler = createImageSizesHandler({ bucket, log: quietLog, now: () => NOW });
  const result = await handler(finalized(SOURCE, { size: String(MAX_SOURCE_BYTES + 1) }));
  assert.equal(result.status, 'refused');
  assert.equal(result.reason, 'too-large');
  assert.deepEqual(bucket.calls.download, []);
  assert.equal(manifestOf(bucket).status, 'refused');
  assert.equal(manifestOf(bucket).reason, 'too-large');
  assert.equal(manifestOf(bucket).sizes.length, 0);
});

test('the trigger records a non-image that claims to be a JPEG, and writes no sizes', async () => {
  const fake = Buffer.from('<html><script>alert(1)</script></html>');
  const bucket = fakeBucket({ [SOURCE]: fake });
  const handler = createImageSizesHandler({ bucket, log: quietLog, now: () => NOW });
  const result = await handler(finalized(SOURCE, { size: String(fake.length), contentType: 'image/jpeg' }));
  assert.equal(result.status, 'refused');
  assert.equal(result.reason, 'not-an-image');
  assert.deepEqual([...bucket.objects.keys()].sort(), [SOURCE, `${PREFIX}manifest.json`].sort());
});

test('the trigger refuses a pixel bomb and writes no sizes', async () => {
  const bomb = bombPng(50_000, 50_000);
  const name = 'cms-images/a1b2c3/bomb.png';
  const bucket = fakeBucket({ [name]: bomb });
  const handler = createImageSizesHandler({ bucket, log: quietLog, now: () => NOW });
  const result = await handler(finalized(name, { size: String(bomb.length), contentType: 'image/png' }));
  assert.equal(result.status, 'refused');
  assert.equal(result.reason, 'too-many-pixels');
  assert.equal([...bucket.objects.keys()].some((key) => key.endsWith('.webp')), false);
});

test('the trigger removes what it wrote when the original is deleted while it runs', async () => {
  const original = await cameraJpeg({ width: 800, height: 600 });
  const name = 'cms-images/a1b2c3/photo.jpg';
  const bucket = fakeBucket({ [name]: original });
  // The delete lands after the render and before the final check.
  const render = async (buffer) => {
    const rendered = await renderImageSizes(buffer);
    bucket.objects.delete(name);
    return rendered;
  };
  const handler = createImageSizesHandler({ bucket, log: quietLog, now: () => NOW, render });
  const result = await handler(finalized(name, { size: String(original.length) }));
  assert.equal(result.status, 'source-gone');
  assert.deepEqual([...bucket.objects.keys()], []);
});

test('the trigger skips an original that is already gone', async () => {
  const bucket = fakeBucket();
  const handler = createImageSizesHandler({ bucket, log: quietLog, now: () => NOW });
  const result = await handler(finalized(SOURCE));
  assert.equal(result.status, 'source-gone');
  assert.deepEqual(bucket.calls.save, []);
});

// ------------------------------------------------------------- cleanup

test('cleanup removes the sizes and manifest when the original is deleted', async () => {
  const bucket = fakeBucket({
    [`${PREFIX}1/320.webp`]: Buffer.from('a'),
    [`${PREFIX}1/1280.webp`]: Buffer.from('b'),
    [`${PREFIX}manifest.json`]: Buffer.from('{}'),
    'speaker-photos/spk_1/other/_sizes/1/320.webp': Buffer.from('keep'),
  });
  const cleanup = createImageSizesCleanupHandler({ bucket, log: quietLog });
  const result = await cleanup({ name: SOURCE });
  assert.equal(result.status, 'removed');
  assert.equal(result.removed, 3);
  assert.deepEqual([...bucket.objects.keys()], ['speaker-photos/spk_1/other/_sizes/1/320.webp']);
  assert.deepEqual(bucket.calls.list, [PREFIX]);
});

test('cleanup keeps the sizes when the original still exists (an overwrite, not a delete)', async () => {
  const bucket = fakeBucket({ [SOURCE]: Buffer.from('new'), [`${PREFIX}1/320.webp`]: Buffer.from('a') });
  const cleanup = createImageSizesCleanupHandler({ bucket, log: quietLog });
  assert.equal((await cleanup({ name: SOURCE })).status, 'skipped');
  assert.ok(bucket.objects.has(`${PREFIX}1/320.webp`));
});

test('cleanup ignores deleted sizes and paths outside the shapes, so it never loops', async () => {
  const bucket = fakeBucket({ [`${PREFIX}1/640.webp`]: Buffer.from('a') });
  const cleanup = createImageSizesCleanupHandler({ bucket, log: quietLog });
  for (const name of [`${PREFIX}1/320.webp`, 'profile-photos/u/p.jpg', 'cms-images/../x/y.png', 'branding/logo.png']) {
    assert.equal((await cleanup({ name })).status, 'skipped', name);
  }
  assert.deepEqual(bucket.calls.list, []);
  assert.deepEqual(bucket.calls.delete, []);
});

// ------------------------------------------------------------- deploy shape

test('buildHandlers deploys the two storage triggers on the event bucket, bounded', () => {
  const saved = { ...process.env };
  process.env.EVENT_STORAGE_BUCKET = 'demo-project.appspot.com';
  process.env.EVENT_FIREBASE_REGION = 'europe-west1';
  try {
    delete require.cache[require.resolve('./imageSizes.cjs')];
    const { handlers } = require('./imageSizes.cjs');
    assert.deepEqual(Object.keys(handlers).sort(), ['mediaImageSizes', 'mediaImageSizesCleanup']);
    const sizes = handlers.mediaImageSizes.__endpoint;
    assert.equal(sizes.eventTrigger.eventType, 'google.cloud.storage.object.v1.finalized');
    assert.equal(sizes.eventTrigger.eventFilters.bucket, 'demo-project.appspot.com');
    assert.equal(sizes.eventTrigger.retry, false);
    assert.deepEqual(sizes.region, ['europe-west1']);
    assert.equal(sizes.availableMemoryMb, 1024);
    assert.equal(sizes.concurrency, 1);
    assert.ok(sizes.maxInstances > 0 && sizes.maxInstances <= 10);
    const cleanup = handlers.mediaImageSizesCleanup.__endpoint;
    assert.equal(cleanup.eventTrigger.eventType, 'google.cloud.storage.object.v1.deleted');
    assert.equal(cleanup.eventTrigger.eventFilters.bucket, 'demo-project.appspot.com');
  } finally {
    process.env = saved;
    delete require.cache[require.resolve('./imageSizes.cjs')];
  }
});

test('buildHandlers falls back to the default bucket the emulator states', () => {
  const { internals: { buildHandlers } } = require('./imageSizes.cjs');
  const handlers = buildHandlers({ FIREBASE_CONFIG: JSON.stringify({ storageBucket: 'demo-run-of-show.appspot.com' }) });
  assert.equal(
    handlers.mediaImageSizes.__endpoint.eventTrigger.eventFilters.bucket,
    'demo-run-of-show.appspot.com',
  );
  assert.deepEqual(buildHandlers({ FIREBASE_CONFIG: 'not json' }), {});
});

test('buildHandlers deploys nothing when no bucket is configured', () => {
  const saved = { ...process.env };
  delete process.env.EVENT_STORAGE_BUCKET;
  delete process.env.FIREBASE_CONFIG;
  try {
    delete require.cache[require.resolve('./imageSizes.cjs')];
    const { handlers } = require('./imageSizes.cjs');
    assert.deepEqual(handlers, {});
  } finally {
    process.env = saved;
    delete require.cache[require.resolve('./imageSizes.cjs')];
  }
});
