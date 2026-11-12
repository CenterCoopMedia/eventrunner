'use strict';

/**
 * updateRegistrationForm: an operator saves the attendee registration
 * questions (ADR 0008 §4) to `config/registration_form`.
 *
 * The save carries the revision the editor loaded. A save against an older
 * revision is refused (409), so two operators cannot overwrite each other,
 * and checkout and saved answers can name the revision they were checked
 * against. `config/*` is publicly readable (firestore.rules), which is right
 * here: the questions are what every attendee is shown.
 */

const { requireAdmin } = require('../core/auth.cjs');
const { sendError, badRequest, methodNotAllowed, internal } = require('../core/errors.cjs');
const { validateRegistrationForm, readRegistrationForm } = require('shared/registrationForm');

const FORM_PATH = 'config/registration_form';
const MAX_BODY_BYTES = 64 * 1024;

function createUpdateRegistrationFormHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function updateRegistrationForm(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ auth, db, getConfig }, req, { tier: 'operator' });
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);
    if (Buffer.byteLength(JSON.stringify(req.body ?? {})) > MAX_BODY_BYTES) {
      return sendError(res, 413, 'payload-too-large', 'The registration form is too large.');
    }
    const expected = req.body?.expectedRevision;
    if (!Number.isSafeInteger(expected) || expected < 0) return badRequest(res, 'expectedRevision: the revision you loaded is required.');
    const checked = validateRegistrationForm(req.body?.form);
    if (!checked.ok) return badRequest(res, checked.errors.join('; '));
    const ref = db.collection('config').doc('registration_form');
    let revision;
    try {
      revision = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const stored = readRegistrationForm(snap.exists ? snap.data() : null);
        if (stored.revision !== expected) {
          const err = new Error('stale');
          err.conflict = true;
          throw err;
        }
        const at = new Date(now());
        const next = expected + 1;
        tx.set(ref, { ...checked.form, revision: next, updatedAt: at });
        tx.set(db.collection('admin_logs').doc(), {
          action: 'updateRegistrationForm', docPath: FORM_PATH, uid: gate.uid, email: gate.email, at,
          details: { revision: next, custom: checked.form.custom.length },
        });
        return next;
      });
    } catch (err) {
      if (err?.conflict) return sendError(res, 409, 'revision-conflict', 'Someone saved the registration form after you opened it. Reload it, then make your changes again.');
      log.error('updateRegistrationForm failed', err);
      return internal(res, 'The registration form could not be saved. Your changes are still on the page. Keep this page open and contact support for help.');
    }
    return res.status(200).json({ revision, form: checked.form });
  };
}

function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  return {
    updateRegistrationForm: onRequest({ region }, async (req, res) => {
      if (applyCors(req, res, { allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS), methods: ['POST'] })) return;
      const { getDb } = require('../core/firestore.cjs');
      const { getAuth } = require('firebase-admin/auth');
      const { getEventConfig } = require('../core/config.cjs');
      const db = getDb();
      await createUpdateRegistrationFormHandler({ db, auth: getAuth(), getConfig: () => getEventConfig({ db }) })(req, res);
    }),
  };
}

module.exports = { createUpdateRegistrationFormHandler, get handlers() { return buildHandlers(); } };
