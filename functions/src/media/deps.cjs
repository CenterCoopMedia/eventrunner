'use strict';

/**
 * Runtime wiring shared by the four media endpoints (spec §1.3 media/).
 *
 * The same buildDeps + CORS wrapper admin/config.cjs uses, factored out
 * because three modules (upload, metadata, usage) need it identically.
 * firebase-functions and firebase-admin are required lazily here — inside
 * the returned handler, not at module load — so requiring a media module
 * from a test never initializes the Admin SDK.
 */

/**
 * @returns {{ db: object, bucket: object,
 *             auth: { verifyIdToken: (t: string) => Promise<object> },
 *             getConfig: () => Promise<object> }}
 */
function buildDeps() {
  const { getDb } = require('../core/firestore.cjs');
  const { getBucket } = require('../core/storage.cjs');
  const { getAuth } = require('firebase-admin/auth');
  const { getEventConfig } = require('../core/config.cjs');
  const db = getDb();
  return { db, bucket: getBucket(), auth: getAuth(), getConfig: () => getEventConfig({ db }) };
}

/**
 * Wrap a handler factory as an onRequest body: apply CORS, answer
 * preflights, then run the handler with runtime deps.
 *
 * @param {(deps: object) => (req: object, res: object) => Promise<void>} create
 */
function withMediaDeps(create) {
  return async function handler(req, res) {
    const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
    const handled = applyCors(req, res, {
      allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS),
    });
    if (handled) return;
    await create(buildDeps())(req, res);
  };
}

module.exports = { buildDeps, withMediaDeps };
