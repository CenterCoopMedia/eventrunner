'use strict';

/**
 * Lazy firebase-admin Storage bucket handle (spec §1.3 core/, §8.5).
 *
 * The Storage counterpart of core/firestore.cjs: the only module in
 * functions/ that imports firebase-admin for bucket access. Every media
 * module takes an injected `bucket` so its tests drive a fake and never
 * need an emulator.
 *
 * The bucket name comes from EVENT_STORAGE_BUCKET (Tier A, spec §2.1), the
 * same variable scripts/lib/firebase-init.cjs resolves, so the functions
 * runtime and the init script write to the same bucket by construction.
 * Falling back to the app's default bucket would be worse than throwing:
 * a deployment with the variable unset would silently write into whichever
 * bucket the SDK inferred, which is how assets end up in a bucket the
 * hosting site does not serve.
 */

let cachedBucket = null;

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {import('@google-cloud/storage').Bucket}
 * @throws {Error} when EVENT_STORAGE_BUCKET is unset
 */
function getBucket(env = process.env) {
  if (cachedBucket) return cachedBucket;
  const name = (env.EVENT_STORAGE_BUCKET || '').trim();
  if (!name) {
    throw new Error('EVENT_STORAGE_BUCKET is not set — no Storage bucket to write to');
  }
  const { initializeApp, getApps } = require('firebase-admin/app');
  const { getStorage } = require('firebase-admin/storage');
  if (getApps().length === 0) initializeApp();
  cachedBucket = getStorage().bucket(name);
  return cachedBucket;
}

module.exports = { getBucket };
