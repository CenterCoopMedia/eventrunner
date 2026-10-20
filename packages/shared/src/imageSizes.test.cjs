'use strict';

// Issue #333. One rule decides which uploads get display sizes and where
// those sizes live. The function writes them and the web app asks for
// them, so both read this module and cannot drift apart.

const test = require('node:test');
const { describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  IMAGE_SIZE_WIDTHS,
  IMAGE_SIZE_TYPE,
  imageSizeSource,
  imageSizePaths,
  imageSizeCopyPath,
  isImageSizePath,
  readImageSizeManifest,
} = require('./imageSizes.cjs');

test('the widths are a few fixed steps, smallest first', () => {
  assert.deepEqual(IMAGE_SIZE_WIDTHS, [320, 640, 1280, 1920]);
  assert.equal(IMAGE_SIZE_TYPE, 'image/webp');
  assert.ok(Object.isFrozen(IMAGE_SIZE_WIDTHS));
});

test('an uploaded raster image in a public library folder is a source', () => {
  assert.deepEqual(imageSizeSource('cms-images/a1b2c3/hero.jpg'), {
    folder: 'cms-images',
    dir: 'cms-images/a1b2c3',
  });
  assert.deepEqual(imageSizeSource('branding/a1b2c3/logo.png'), {
    folder: 'branding',
    dir: 'branding/a1b2c3',
  });
  assert.deepEqual(imageSizeSource('speaker-photos/spk_1/a1b2c3/face.webp'), {
    folder: 'speaker-photos',
    dir: 'speaker-photos/spk_1/a1b2c3',
  });
  assert.ok(imageSizeSource('cms-images/a1b2c3/photo.jpeg'));
});

test('anything else is not a source', () => {
  for (const path of [
    null,
    42,
    '',
    // Flat seeded branding ships in the site bundle, not the bucket.
    'branding/logo.png',
    // Vector and animated formats keep their original.
    'cms-images/a1b2c3/logo.svg',
    'cms-images/a1b2c3/loop.gif',
    // Attendee photos are client uploads and stay out of scope.
    'profile-photos/uid-1/photo.jpg',
    'profile-photos/uid-1/a1b2c3/photo.jpg',
    'session-materials/s1/a1b2c3/deck.png',
    'exports/schedule.png',
    // An older fixed headshot path has no asset folder of its own.
    'speaker-photos/spk_1/photo.jpg',
    // Wrong depth.
    'cms-images/a1b2c3/extra/hero.jpg',
    'speaker-photos/spk_1/a1b2c3/extra/face.jpg',
    // Traversal and odd segments.
    'cms-images/../hero.jpg',
    'cms-images/./hero.jpg',
    'cms-images//hero.jpg',
    '/cms-images/a1b2c3/hero.jpg',
    'cms-images/a1b2c3/../../branding/x.png',
    'cms-images/a b/hero.jpg',
    'cms-images/a1b2c3/hero.jpg/',
    'https://example.org/cms-images/a1b2c3/hero.jpg',
    // A size the function wrote is never a source again.
    'cms-images/a1b2c3/_sizes/320.webp',
    'cms-images/_sizes/a1b2c3/hero.jpg',
    'speaker-photos/spk_1/_sizes/320.webp',
    'cms-images/a1b2c3/_sizes',
  ]) {
    assert.equal(imageSizeSource(path), null, String(path));
  }
});

test('imageSizePaths names the sizes folder and the manifest beside the original', () => {
  assert.deepEqual(imageSizePaths('speaker-photos/spk_1/a1b2c3/face.jpg'), {
    prefix: 'speaker-photos/spk_1/a1b2c3/_sizes/',
    manifest: 'speaker-photos/spk_1/a1b2c3/_sizes/manifest.json',
  });
  assert.equal(imageSizePaths('branding/logo.png'), null);
});

// Codex review on #538: copies belong to one generation of the original,
// so a run for an overwritten generation can never pass its copies off as
// the new image's.
test('imageSizeCopyPath puts each copy under the original generation', () => {
  assert.equal(
    imageSizeCopyPath('cms-images/a1b2c3/hero.jpg', '1712345678901234', 640),
    'cms-images/a1b2c3/_sizes/1712345678901234/640.webp',
  );
  for (const generation of [undefined, '', 'abc', '1/2', '../1', 12.5]) {
    assert.equal(imageSizeCopyPath('cms-images/a1b2c3/hero.jpg', generation, 640), null, String(generation));
  }
  assert.equal(imageSizeCopyPath('cms-images/a1b2c3/hero.jpg', '17', 500), null, 'not a fixed width');
  assert.equal(imageSizeCopyPath('branding/logo.png', '17', 640), null);
});

// Codex review on #538: a srcset must state each file's real width.
describe('readImageSizeManifest', () => {
  const SOURCE = 'cms-images/a1b2c3/hero.jpg';
  const ready = (overrides = {}) => ({
    version: 1,
    status: 'ready',
    source: SOURCE,
    sourceGeneration: '17',
    width: 1254,
    height: 800,
    sizes: [
      { target: 320, width: 320, height: 204, path: 'cms-images/a1b2c3/_sizes/17/320.webp' },
      { target: 640, width: 640, height: 408, path: 'cms-images/a1b2c3/_sizes/17/640.webp' },
    ],
    ...overrides,
  });

  test('returns each copy at its real width, and the original width', () => {
    assert.deepEqual(readImageSizeManifest(SOURCE, ready()), {
      generation: '17',
      width: 1254,
      sizes: [
        { width: 320, path: 'cms-images/a1b2c3/_sizes/17/320.webp' },
        { width: 640, path: 'cms-images/a1b2c3/_sizes/17/640.webp' },
      ],
    });
  });

  test('refuses a manifest that is not ready, or is for another object', () => {
    assert.equal(readImageSizeManifest(SOURCE, ready({ status: 'refused', sizes: [] })), null);
    assert.equal(readImageSizeManifest(SOURCE, ready({ source: 'cms-images/zzz/hero.jpg' })), null);
    assert.equal(readImageSizeManifest('branding/logo.png', ready()), null);
    assert.equal(readImageSizeManifest(SOURCE, null), null);
    assert.equal(readImageSizeManifest(SOURCE, 'ready'), null);
    assert.equal(readImageSizeManifest(SOURCE, ready({ sourceGeneration: '../x' })), null);
    assert.equal(readImageSizeManifest(SOURCE, ready({ width: 0 })), null);
  });

  test('drops a copy whose path is not this generation\'s copy, or whose width is wrong', () => {
    const read = readImageSizeManifest(SOURCE, ready({
      sizes: [
        { target: 320, width: 320, path: 'cms-images/a1b2c3/_sizes/16/320.webp' },
        { target: 640, width: 640, path: 'https://evil.example/640.webp' },
        { target: 640, width: 640, path: 'cms-images/a1b2c3/_sizes/17/640.webp' },
        { target: 1280, width: 2000, path: 'cms-images/a1b2c3/_sizes/17/1280.webp' },
        { target: 1920, width: 1254, path: 'cms-images/a1b2c3/_sizes/17/1920.webp' },
      ],
    }));
    assert.deepEqual(read.sizes, [{ width: 640, path: 'cms-images/a1b2c3/_sizes/17/640.webp' }]);
  });

  test('keeps one copy per real width, narrowest first', () => {
    const read = readImageSizeManifest(SOURCE, ready({
      sizes: [
        { target: 640, width: 640, path: 'cms-images/a1b2c3/_sizes/17/640.webp' },
        { target: 320, width: 320, path: 'cms-images/a1b2c3/_sizes/17/320.webp' },
        { target: 640, width: 640, path: 'cms-images/a1b2c3/_sizes/17/640.webp' },
      ],
    }));
    assert.deepEqual(read.sizes.map((size) => size.width), [320, 640]);
  });
});

test('isImageSizePath knows the objects the function writes', () => {
  assert.equal(isImageSizePath('cms-images/a1b2c3/_sizes/17/320.webp'), true);
  assert.equal(isImageSizePath('cms-images/a1b2c3/_sizes/manifest.json'), true);
  assert.equal(isImageSizePath('speaker-photos/s/a/_sizes/1920.webp'), true);
  assert.equal(isImageSizePath('cms-images/a1b2c3/hero.jpg'), false);
  assert.equal(isImageSizePath(undefined), false);
});
