'use strict';

/**
 * Validated config writers — the ONLY writer of `config/*` (spec §1.3,
 * issue #14). Four handlers: updateEventConfig, updateFeatures,
 * updateTheme, updateBadges. Every write:
 *
 *   1. Requires admin (core/auth requireAdmin — token + verified email +
 *      config/bootstrap.adminEmails membership).
 *   2. Targets only {event, features, theme, badges}. `config/bootstrap`
 *      (the admin-list seed) and `config/providers` (a read-only mirror of
 *      Tier A deploy env) are NEVER writable from the panel, and the
 *      refusal names the doc.
 *   3. Rejects deploy-mirrored read-only fields BY NAME: anything under
 *      `providers.*`, Tier-A-sourced values (slug, project id, region,
 *      public URL, storage bucket, provider selection, externalEventId),
 *      and `sender.domainVerified` / `sender.domainVerifiedAt` — only
 *      verify-sender-domain.cjs may set those, because an admin who could
 *      edit domainVerified could mark an unauthenticated sender domain
 *      verified and silently break OTP delivery for the whole event.
 *   4. Validates shape with the shared schema validators
 *      (packages/shared/src/config/schema.cjs) — IANA timezone, unique
 *      day/badge ids, hex theme colors all live THERE, not here.
 *   5. Replaces the doc's editable fields (plain set, no merge — removed
 *      fields go away) and stamps { updatedAt, updatedBy: email }. On
 *      config/event the verification pair is carried forward from the
 *      stored doc so a full-replace save cannot drop it — and the read is
 *      part of the write transaction, so a verify-sender-domain.cjs write
 *      landing mid-save cannot be clobbered.
 *   6. Commits the config doc and a cmsVersionHistory-style audit row in
 *      ONE transaction, then writes an admin_logs entry (best-effort — a
 *      logging outage never fails a committed mutation).
 *
 * core/config.cjs's per-container cache is deliberately NOT reset here:
 * its 5-minute TTL is accepted staleness (a config edit may take up to
 * 5 minutes to reach other warm containers), and this module has no way
 * to reach the caches of containers it does not run in anyway.
 */

const { requireAdmin } = require('../core/auth.cjs');
const { logAdminAction } = require('../cms/store.cjs');
const { sendError, badRequest, methodNotAllowed, internal } = require('../core/errors.cjs');
const {
  validateEventConfig,
  validateFeatures,
  validateTheme,
  validateBadgesConfig,
} = require('shared/config');

/** Panel-writable doc ids and their shared-schema validators. */
const WRITABLE_CONFIG_DOCS = Object.freeze({
  event: validateEventConfig,
  features: validateFeatures,
  theme: validateTheme,
  badges: validateBadgesConfig,
});

/**
 * Top-level keys mirrored from Tier A deploy env (spec §2.1/§2.2). They
 * are read-only everywhere: the deploy pipeline is their source of truth,
 * and a Firestore copy that disagreed with it would only mislead.
 */
const TIER_A_FIELDS = Object.freeze([
  'slug',
  'projectId',
  'region',
  'publicUrl',
  'storageBucket',
  'emailProvider',
  'ticketingProvider',
  'externalEventId',
]);

/** Only verify-sender-domain.cjs may set these (spec §1.3 item 3). */
const SENDER_VERIFICATION_FIELDS = Object.freeze(['domainVerified', 'domainVerifiedAt']);

/** Server-stamped bookkeeping — silently stripped from payloads. */
const STAMP_FIELDS = Object.freeze(['updatedAt', 'updatedBy']);

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Every read-only-field violation in a payload, each error naming the
 * exact field (never a generic "invalid payload"). Pure.
 *
 * @param {object} payload
 * @returns {string[]}
 */
function findReadOnlyViolations(payload) {
  const violations = [];
  if ('providers' in payload) {
    const keys = isPlainObject(payload.providers) ? Object.keys(payload.providers) : [];
    if (keys.length === 0) {
      violations.push('providers: read-only — mirrored from the deploy environment (Tier A)');
    } else {
      for (const key of keys) {
        violations.push(`providers.${key}: read-only — mirrored from the deploy environment (Tier A)`);
      }
    }
  }
  for (const field of TIER_A_FIELDS) {
    if (field in payload) {
      violations.push(`${field}: read-only — sourced from the deploy environment (Tier A)`);
    }
  }
  if (isPlainObject(payload.sender)) {
    for (const field of SENDER_VERIFICATION_FIELDS) {
      if (field in payload.sender) {
        violations.push(`sender.${field}: read-only — only verify-sender-domain.cjs may set it`);
      }
    }
  }
  return violations;
}

/** @param {object} payload @returns {object} payload minus STAMP_FIELDS */
function stripStamps(payload) {
  const out = {};
  for (const [k, v] of Object.entries(payload)) {
    if (!STAMP_FIELDS.includes(k)) out[k] = v;
  }
  return out;
}

/**
 * Validate and apply one config write. Returns a verdict instead of
 * touching `res`, so the four handlers share it and tests can drive the
 * allowlist directly (e.g. prove `bootstrap` is rejected).
 *
 * @param {{ db: FirebaseFirestore.Firestore, docId: string, payload: object,
 *           actor: { uid: string, email: string }, now?: () => number }} args
 * @returns {Promise<{ ok: true, docPath: string } |
 *                    { ok: false, status: 400|403, code: string, message: string }>}
 */
async function applyConfigWrite({ db, docId, payload, actor, now = Date.now }) {
  const validate = WRITABLE_CONFIG_DOCS[docId];
  if (!validate) {
    // Covers bootstrap, providers, and any unknown id in one refusal that
    // names the doc — no distinction that would confirm which docs exist.
    return {
      ok: false,
      status: 403,
      code: 'forbidden',
      message: `config/${docId} is not writable from the admin panel.`,
    };
  }

  const violations = findReadOnlyViolations(payload);
  if (violations.length > 0) {
    return { ok: false, status: 400, code: 'bad-request', message: violations.join('; ') };
  }

  const fields = stripStamps(payload);
  const verdict = validate(fields);
  if (!verdict.ok) {
    return { ok: false, status: 400, code: 'bad-request', message: verdict.errors.join('; ') };
  }

  const ref = db.collection('config').doc(docId);
  const historyRef = db.collection('cmsVersionHistory').doc();
  const at = new Date(now());
  // One transaction, not a batch: config/event's carry-forward read must be
  // serialized against verify-sender-domain.cjs (the only writer of the
  // verification pair) — a plain get() followed by a batched full replace
  // could clobber a domainVerified=true landed between the two, silently
  // breaking OTP delivery. The transaction body may retry, so it derives
  // its writes from `fields` without mutating it.
  await db.runTransaction(async (tx) => {
    let written = fields;
    if (docId === 'event') {
      // Full replace must not drop the verification pair verify-sender-domain
      // wrote — the payload was already proven not to carry either field.
      const snap = await tx.get(ref);
      const storedSender =
        snap.exists && isPlainObject(snap.data().sender) ? snap.data().sender : {};
      written = {
        ...fields,
        sender: {
          ...(isPlainObject(fields.sender) ? fields.sender : {}),
          domainVerified: storedSender.domainVerified === true,
          domainVerifiedAt: storedSender.domainVerifiedAt ?? null,
        },
      };
    }
    tx.set(ref, { ...written, updatedAt: at, updatedBy: actor.email });
    // cmsVersionHistory-style audit row (spec §1.3 item 4), committed
    // atomically with the doc it describes. Config docs have no revision
    // counter, so the row records the full written fields + stamps.
    tx.set(historyRef, {
      docPath: `config/${docId}`,
      kind: 'config',
      fields: written,
      updatedAt: at,
      updatedBy: actor.email,
    });
  });
  return { ok: true, docPath: `config/${docId}` };
}

/**
 * Shared handler factory: one panel-writable doc id per handler, payload
 * under the body key of the same name (e.g. `POST { theme: {...} }`).
 *
 * @param {{ docId: string, action: string }} target
 * @param {{ db: object,
 *           auth: { verifyIdToken: (t: string) => Promise<object> },
 *           getConfig: () => Promise<object>,
 *           now?: () => number, log?: Pick<Console, 'warn'|'error'> }} deps
 */
function createConfigWriteHandler({ docId, action }, { db, auth, getConfig, now = Date.now, log = console }) {
  return async function handler(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ auth, getConfig }, req);
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);

    const payload = req.body?.[docId];
    if (!isPlainObject(payload)) return badRequest(res, `${docId}: must be an object`);

    const actor = { uid: gate.uid, email: gate.email };
    let result;
    try {
      result = await applyConfigWrite({ db, docId, payload, actor, now });
    } catch (err) {
      log.error(`${action} write failed`, err);
      return internal(res, 'The configuration could not be saved.');
    }
    if (!result.ok) return sendError(res, result.status, result.code, result.message);

    try {
      await logAdminAction({ db, action, docPath: result.docPath, actor, now, log });
    } catch (err) {
      log.warn('admin_logs write failed', err);
    }
    res.status(200).json({ docPath: result.docPath });
  };
}

const createUpdateEventConfigHandler = (deps) =>
  createConfigWriteHandler({ docId: 'event', action: 'updateEventConfig' }, deps);
const createUpdateFeaturesHandler = (deps) =>
  createConfigWriteHandler({ docId: 'features', action: 'updateFeatures' }, deps);
const createUpdateThemeHandler = (deps) =>
  createConfigWriteHandler({ docId: 'theme', action: 'updateTheme' }, deps);
const createUpdateBadgesHandler = (deps) =>
  createConfigWriteHandler({ docId: 'badges', action: 'updateBadges' }, deps);

/**
 * Deployable exports (spec §1.3 admin/): updateEventConfig,
 * updateFeatures, updateTheme, updateBadges. firebase-functions and
 * firebase-admin are required lazily HERE ONLY (house rule).
 */
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';

  const buildDeps = () => {
    const { getDb } = require('../core/firestore.cjs');
    const { getAuth } = require('firebase-admin/auth');
    const { getEventConfig } = require('../core/config.cjs');
    const db = getDb();
    return { db, auth: getAuth(), getConfig: () => getEventConfig({ db }) };
  };

  const withCors = (handler) => async (req, res) => {
    const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
    const handled = applyCors(req, res, {
      allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS),
    });
    if (handled) return;
    await handler(req, res);
  };

  const expose = (create) =>
    onRequest({ region }, withCors(async (req, res) => {
      await create(buildDeps())(req, res);
    }));

  return {
    updateEventConfig: expose(createUpdateEventConfigHandler),
    updateFeatures: expose(createUpdateFeaturesHandler),
    updateTheme: expose(createUpdateThemeHandler),
    updateBadges: expose(createUpdateBadgesHandler),
  };
}

module.exports = {
  createUpdateEventConfigHandler,
  createUpdateFeaturesHandler,
  createUpdateThemeHandler,
  createUpdateBadgesHandler,
  get handlers() {
    return buildHandlers();
  },
  internals: {
    applyConfigWrite,
    findReadOnlyViolations,
    stripStamps,
    createConfigWriteHandler,
    WRITABLE_CONFIG_DOCS,
    TIER_A_FIELDS,
    SENDER_VERIFICATION_FIELDS,
    STAMP_FIELDS,
  },
};
