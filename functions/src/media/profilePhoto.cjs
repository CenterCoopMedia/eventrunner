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

function createProfilePhotoUploadHandler({
  db, bucket, auth, render = renderProfilePhoto,
  verify = (...args) => require('../core/auth.cjs').verifyAuthToken(...args),
  newId = () => require('node:crypto').randomUUID(),
  log = console,
}) {
  return async (req, res) => {
    const error = (status, code, message) => res.status(status).json({ error: { code, message } });
    if (req.method !== 'POST') {
      res.set('Allow', 'POST');
      return error(405, 'method-not-allowed', 'Use POST.');
    }
    const caller = await verify({ auth }, req);
    if (!caller?.uid) return error(401, 'unauthorized', 'Authentication required.');
    if (!(await db.collection('users').doc(caller.uid).get()).exists) {
      return error(403, 'forbidden', 'A live account is required.');
    }
    const data = req.body?.data;
    // Bound the encoded input before allocating its decoded buffer.
    if (typeof data !== 'string' || !data.length
      || data.length > 4 * Math.ceil(MAX_BYTES / 3)
      || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
      return error(400, 'invalid-image', 'Choose a photo under 2 MiB.');
    }
    let output;
    try {
      output = await render(Buffer.from(data, 'base64'));
    } catch {
      return error(400, 'invalid-image', 'Choose a still PNG, JPEG or WebP under 2 MiB and 40 megapixels.');
    }
    const path = `profile-photos/${caller.uid}/${newId()}/photo.webp`;
    try {
      await bucket.file(path).save(output, {
        resumable: false,
        contentType: 'image/webp',
        metadata: {
          contentType: 'image/webp',
          cacheControl: 'public, max-age=3600',
          metadata: { profilePhotoValidated: 'v1' },
        },
      });
    } catch (err) {
      log.error('profilePhotoUpload failed', err);
      return error(500, 'internal', 'The photo could not be uploaded.');
    }
    return res.status(200).json({ path });
  };
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
