'use strict';

// Issue #333. One rule decides which uploads get display sizes and where
// those sizes live. The function writes them and the web app asks for
// them, so both read this module and cannot drift apart.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  IMAGE_SIZE_WIDTHS,
  IMAGE_SIZE_TYPE,
  imageSizeSource,
  imageSizePaths,
  isImageSizePath,
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

test('imageSizePaths names one webp per width and a manifest beside them', () => {
  assert.deepEqual(imageSizePaths('speaker-photos/spk_1/a1b2c3/face.jpg'), {
    prefix: 'speaker-photos/spk_1/a1b2c3/_sizes/',
    manifest: 'speaker-photos/spk_1/a1b2c3/_sizes/manifest.json',
    sizes: [
      { width: 320, path: 'speaker-photos/spk_1/a1b2c3/_sizes/320.webp' },
      { width: 640, path: 'speaker-photos/spk_1/a1b2c3/_sizes/640.webp' },
      { width: 1280, path: 'speaker-photos/spk_1/a1b2c3/_sizes/1280.webp' },
      { width: 1920, path: 'speaker-photos/spk_1/a1b2c3/_sizes/1920.webp' },
    ],
  });
  assert.equal(imageSizePaths('branding/logo.png'), null);
});

test('isImageSizePath knows the objects the function writes', () => {
  assert.equal(isImageSizePath('cms-images/a1b2c3/_sizes/320.webp'), true);
  assert.equal(isImageSizePath('cms-images/a1b2c3/_sizes/manifest.json'), true);
  assert.equal(isImageSizePath('speaker-photos/s/a/_sizes/1920.webp'), true);
  assert.equal(isImageSizePath('cms-images/a1b2c3/hero.jpg'), false);
  assert.equal(isImageSizePath(undefined), false);
});
