'use strict';

const { requireAdmin } = require('../core/auth.cjs');
const { badRequest, methodNotAllowed, notFound, sendError } = require('../core/errors.cjs');
const { SCREENSHOT_ID_RE, freshScreenshotAuth, screenshotRef, validScreenshotIndex } = require('shared/screenshots');

const SOURCES = new Set(['feedback', 'change_requests']);

function createReadRequestScreenshotHandler({ auth, db, now = Date.now }) {
  const freshAuth = freshScreenshotAuth(auth, now);
  return async function readRequestScreenshot(req, res) {
    res.set('Cache-Control', 'private, no-store');
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ auth: freshAuth, db, now }, req, { tier: 'staff' });
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);
    const { source, id, index } = req.body ?? {};
    if (!SOURCES.has(source) || typeof id !== 'string' || !SCREENSHOT_ID_RE.test(id) || !validScreenshotIndex(index)) {
      return badRequest(res, 'Choose a screenshot to open.');
    }
    const image = await db.runTransaction(async (tx) => {
      const parent = (await tx.get(db.collection(source).doc(id))).data();
      if (!validScreenshotIndex(index, parent?.screenshotDigests?.length ?? 0)) return null;
      return (await tx.get(screenshotRef(db, source, id, index))).data()?.image;
    }, { readOnly: true });
    if (!image) return notFound(res, 'This screenshot is no longer available.');
    return res.status(200).json({ image: image.toString('base64') });
  };
}

function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const { getAuth } = require('firebase-admin/auth');
  const { getDb } = require('../core/firestore.cjs');
  const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  return {
    readRequestScreenshot: onRequest({ region }, async (req, res) => {
      if (applyCors(req, res, { allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS) })) return;
      const db = getDb();
      await createReadRequestScreenshotHandler({ db, auth: getAuth() })(req, res);
    }),
  };
}

module.exports = { createReadRequestScreenshotHandler, get handlers() { return buildHandlers(); } };
