'use strict';

/**
 * Template registry + Firestore override loader (spec §6.1).
 *
 * Defaults ship as code so a fresh deployment can send an OTP before
 * seeding completes. `email_templates/{id}` may override subject/html/text
 * only — never tokens, requiredTokens, or storeRendered.
 *
 * validateOverridePayload is the save-time gate for saveEmailTemplate: it
 * rejects the write with specific messages so a broken override never
 * reaches storage; render.cjs re-runs the same checks at render time as
 * the backstop.
 */

const { validateTemplateBody } = require('./render.cjs');

/** @type {Record<string, object>} shipped defaults, keyed by template id */
const DEFAULTS = {
  'auth.otp': require('./templates/auth.otp.cjs'),
  'account.welcome': require('./templates/account.welcome.cjs'),
  'feedback.confirmation': require('./templates/feedback.confirmation.cjs'),
  'speaker.invite': require('./templates/speaker.invite.cjs'),
  'speaker.accepted': require('./templates/speaker.accepted.cjs'),
  'speaker.confirmation': require('./templates/speaker.confirmation.cjs'),
};

const OVERRIDE_KEYS = ['subject', 'html', 'text'];
const CACHE_TTL_MS = 5 * 60 * 1000;

/** @type {Map<string, { loadedAt: number, override: object|null }>} per-id override cache */
const overrideCache = new Map();

/** @param {string} id @returns {object|null} the shipped module or null */
function getDefaultTemplate(id) {
  return DEFAULTS[id] || null;
}

/** @returns {string[]} ids of all shipped defaults */
function listTemplateIds() {
  return Object.keys(DEFAULTS);
}

/**
 * Load a template with its Firestore override, cached 5 minutes per id.
 * An absent override doc caches as null for the same TTL — a missing doc
 * must not cost a read per send.
 *
 * @param {{ db: FirebaseFirestore.Firestore, id: string, now?: () => number }} deps
 * @returns {Promise<{ template: object, override: object|null }>}
 * @throws {Error} for an id no default ships — a code bug, not a data state
 */
async function loadTemplate({ db, id, now = Date.now }) {
  const template = getDefaultTemplate(id);
  if (!template) {
    throw new Error(`unknown template id: ${id}`);
  }
  const cached = overrideCache.get(id);
  if (cached && now() - cached.loadedAt < CACHE_TTL_MS) {
    return { template, override: cached.override };
  }
  const snap = await db.collection('email_templates').doc(id).get();
  const override = snap.exists ? snap.data() : null;
  overrideCache.set(id, { loadedAt: now(), override });
  return { template, override };
}

/** Test hook: drop the per-id override cache. */
function resetTemplateCacheForTest() {
  overrideCache.clear();
}

/**
 * Save-time validation for an email_templates/{id} override payload
 * (spec §6.1): only subject/html/text, each a non-empty string, and the
 * effective merged bodies must pass both token checks.
 *
 * @param {string} id
 * @param {object} payload candidate override document
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validateOverridePayload(id, payload) {
  const template = getDefaultTemplate(id);
  if (!template) {
    return { ok: false, errors: [`unknown template id: ${id}`] };
  }
  if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, errors: ['payload must be an object'] };
  }

  const errors = [];
  for (const key of Object.keys(payload)) {
    if (OVERRIDE_KEYS.includes(key)) continue;
    if (['tokens', 'requiredTokens', 'storeRendered'].includes(key)) {
      errors.push(`${key} may not be overridden`);
    } else {
      errors.push(`unknown key: ${key}`);
    }
  }
  if (!OVERRIDE_KEYS.some((key) => key in payload)) {
    // A no-op override would be blessed by every later check but change
    // nothing — a "saved!" that lies to the admin.
    errors.push(`payload must set at least one of ${OVERRIDE_KEYS.join(', ')}`);
  }
  for (const key of OVERRIDE_KEYS) {
    if (!(key in payload)) continue;
    const value = payload[key];
    if (typeof value !== 'string' || value.trim().length === 0) {
      errors.push(`${key} must be a non-empty string`);
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const candidate = {
    subject: typeof payload.subject === 'string' ? payload.subject : template.subject,
    html: typeof payload.html === 'string' ? payload.html : template.html,
    text: typeof payload.text === 'string' ? payload.text : template.text,
  };
  return validateTemplateBody(template, candidate);
}

module.exports = {
  getDefaultTemplate,
  listTemplateIds,
  loadTemplate,
  validateOverridePayload,
  resetTemplateCacheForTest,
  internals: { CACHE_TTL_MS, OVERRIDE_KEYS },
};
