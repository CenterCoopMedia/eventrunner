'use strict';

// Originals remain in request memory only. No public object exists until
// decoding, pixel limits and metadata-stripping re-encoding all succeed.
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const MAX_EDGE = 512;

async function renderProfilePhoto(buffer, sharp = require('sharp')) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length >= MAX_BYTES) {
    throw new Error('Photo must be under 2 MiB.');
  }
  const options = { limitInputPixels: MAX_PIXELS, failOn: 'error', pages: 1, sequentialRead: true };
  const meta = await sharp(buffer, options).metadata();
  if (!['png', 'jpeg', 'webp'].includes(meta.format)
    || !(meta.width > 0) || !(meta.height > 0)
    || meta.width * meta.height > MAX_PIXELS || (meta.pages ?? 1) > 1) {
    throw new Error('Choose a still PNG, JPEG or WebP under 40 megapixels.');
  }
  // Never keep EXIF/GPS/ICC metadata. Re-encode even very small inputs.
  return sharp(buffer, options).rotate()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 }).toBuffer();
}

function createProfilePhotoUploadHandler(deps) {
  return require('../users/photos.cjs').createProfilePhotoUploadHandler({
    render: renderProfilePhoto, ...deps,
  });
}

function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const { withMediaDeps } = require('./deps.cjs');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  return {
    profilePhotoUpload: onRequest({
      region, memory: '1GiB', concurrency: 1, maxInstances: 10, timeoutSeconds: 60,
    }, withMediaDeps(createProfilePhotoUploadHandler)),
  };
}

module.exports = {
  renderProfilePhoto, createProfilePhotoUploadHandler,
  get handlers() { return buildHandlers(); },
};
