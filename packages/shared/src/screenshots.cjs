'use strict';

const { createHash } = require('node:crypto');
const { MAX_SCREENSHOTS, MIB, PUBLIC_SCREENSHOT_MIB, SIGNED_IN_SCREENSHOT_MIB, screenshotTotalMib } = require('./screenshotPolicy.mjs');
const SCREENSHOT_COLLECTION = 'request_screenshots';
const SCREENSHOT_TOKEN_AGE_MS = 5 * 60 * 1000;
const SCREENSHOT_ID_RE = /^[a-z0-9_-]{8,128}$/i;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

class ScreenshotError extends Error {}

function screenshotBodyBytes(value) {
  try {
    const body = { ...value };
    delete body.screenshots;
    return Buffer.byteLength(JSON.stringify(body));
  } catch {
    return Infinity;
  }
}

function screenshotWireBytes(mib) {
  const total = screenshotTotalMib(mib) * MIB;
  // Each image is padded to its own base64 group and is a JSON string.
  return Math.ceil(total / 3) * 4 + (MAX_SCREENSHOTS - 1) * 4 + MAX_SCREENSHOTS * 3 + 32;
}

/** Bound input before decoding and record a stable identity for form retries. */
function readScreenshots(values, mib) {
  if (values === undefined) return [];
  if (!Array.isArray(values) || values.length > MAX_SCREENSHOTS) {
    throw new ScreenshotError('Choose up to 3 screenshots.');
  }
  const max = mib * MIB;
  const totalMib = screenshotTotalMib(mib);
  let remaining = totalMib * MIB;
  return values.map((value) => {
    if (typeof value !== 'string' || value.length > Math.ceil(max / 3) * 4 ||
        value.length % 4 !== 0 || !BASE64_RE.test(value)) {
      throw new ScreenshotError(`Choose PNG, JPEG, or WebP images up to ${mib} MiB each.`);
    }
    const bytes = Buffer.from(value, 'base64');
    if (bytes.length > max || bytes.toString('base64') !== value) {
      throw new ScreenshotError(`Choose PNG, JPEG, or WebP images up to ${mib} MiB each.`);
    }
    remaining -= bytes.length;
    if (remaining < 0) {
      throw new ScreenshotError(`Choose screenshots up to ${totalMib} MiB in total.`);
    }
    return { bytes, digest: createHash('sha256').update(bytes).digest('hex') };
  });
}

function imageFormat(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpeg';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

async function renderScreenshots(screenshots, sharp, maxPixels) {
  const rendered = [];
  const options = { limitInputPixels: maxPixels, failOn: 'warning', pages: 1, sequentialRead: true };
  for (const { bytes } of screenshots) {
    const format = imageFormat(bytes);
    try {
      if (!format) throw new ScreenshotError();
      const image = sharp(bytes, options);
      const metadata = await image.metadata();
      if (metadata.format !== format || !metadata.width || !metadata.height ||
          metadata.width * metadata.height > maxPixels || (metadata.pages ?? 1) > 1) {
        throw new ScreenshotError();
      }
      // Auto-orient before encoding. Sharp drops EXIF and other input metadata by default.
      const saved = await image.autoOrient()
        .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 84 }).toBuffer();
      // A Firestore document has a 1 MiB limit, including its fields and path.
      if (saved.length > 768 * 1024) throw new ScreenshotError();
      rendered.push(saved);
    } catch {
      throw new ScreenshotError('This screenshot could not be read. Choose a still PNG, JPEG, or WebP, or try a smaller image.');
    }
  }
  return rendered;
}

function screenshotRef(db, source, id, index) {
  return db.collection(SCREENSHOT_COLLECTION).doc(`${source}-${id}-${index}`);
}

function writeScreenshots(db, tx, source, id, images, owner = {}) {
  images.forEach((image, index) => tx.create(screenshotRef(db, source, id, index), { image, ...owner }));
}

function validScreenshotIndex(index, count = MAX_SCREENSHOTS) {
  return Number.isInteger(index) && index >= 0 && index < MAX_SCREENSHOTS && index < count;
}

function sameScreenshotDigests(stored, incoming) {
  const previous = stored ?? [];
  return previous.length === incoming.length && incoming.every((digest, index) => previous[index] === digest);
}

function freshScreenshotAuth(auth, now = Date.now) {
  return {
    async verifyIdToken(token, checkRevoked) {
      const decoded = await auth.verifyIdToken(token, checkRevoked);
      const age = now() - decoded.iat * 1000;
      if (!(age >= -5000 && age <= SCREENSHOT_TOKEN_AGE_MS)) throw new Error('Refresh your sign-in to open screenshots.');
      return decoded;
    },
  };
}

module.exports = {
  MAX_SCREENSHOTS, MIB, PUBLIC_SCREENSHOT_MIB, SIGNED_IN_SCREENSHOT_MIB,
  SCREENSHOT_COLLECTION, SCREENSHOT_ID_RE, ScreenshotError,
  screenshotBodyBytes, screenshotWireBytes, readScreenshots, renderScreenshots,
  screenshotRef, writeScreenshots, validScreenshotIndex, sameScreenshotDigests, freshScreenshotAuth,
};
