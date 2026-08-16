'use strict';

/**
 * Tier A deploy-time environment validation (spec §2.1, .env.example).
 *
 * Run at build/deploy time so a missing key fails the build loudly rather
 * than surfacing as a runtime misconfiguration. Total: never throws;
 * returns `{ ok, missing, errors }` where `missing` lists absent required
 * variables and `errors` lists present-but-invalid values.
 */

const SLUG_RE = /^[a-z0-9-]+$/;

const EMAIL_PROVIDERS = ['postmark', 'webhook', 'console'];
const TICKETING_PROVIDERS = ['eventbrite', 'manual', 'none'];
const OPERATOR_NOTIFIERS = ['webhook', 'email', 'none'];

const REQUIRED_ALWAYS = [
  'EVENT_SLUG',
  'EVENT_FIREBASE_PROJECT_ID',
  'EVENT_PUBLIC_URL',
  'EVENT_STORAGE_BUCKET',
  'EVENT_ALLOWED_ORIGINS',
  'EVENT_EMAIL_PROVIDER',
  'EVENT_TICKETING_PROVIDER',
  'EVENT_OPERATOR_NOTIFIER',
  'EVENT_HOSTING_SITE',
  // Frontend build keys (.env.example): a missing VITE_FIREBASE_* value
  // ships a bundle that dies at runtime with auth/invalid-api-key — the
  // validator exists to fail the build loudly instead.
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_FIREBASE_MEASUREMENT_ID',
  'VITE_EVENT_PUBLIC_URL',
];

/** Defaults applied when the variable is absent — never reported missing. */
const DEFAULTS = {
  EVENT_FIREBASE_REGION: 'us-central1',
};

/** @param {*} v @returns {boolean} */
function present(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Validate the deploy-time environment.
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {{ ok: boolean, missing: string[], errors: string[], resolved: Record<string, string> }}
 *   `resolved` is the validated env with `DEFAULTS` applied for any absent
 *   defaultable key (e.g. EVENT_FIREBASE_REGION → us-central1); explicitly
 *   set values are preserved.
 */
function validateDeployEnv(env = process.env) {
  const missing = [];
  const errors = [];
  const source = env && typeof env === 'object' ? env : {};

  for (const key of REQUIRED_ALWAYS) {
    if (!present(source[key])) missing.push(key);
  }

  if (present(source.EVENT_SLUG) && !SLUG_RE.test(source.EVENT_SLUG.trim())) {
    errors.push('EVENT_SLUG: must be lowercase [a-z0-9-]');
  }

  if (present(source.EVENT_PUBLIC_URL)) {
    let parsed = null;
    try {
      parsed = new URL(source.EVENT_PUBLIC_URL.trim());
    } catch {
      parsed = null;
    }
    if (!parsed || parsed.protocol !== 'https:') {
      errors.push('EVENT_PUBLIC_URL: must be a parseable https URL');
    }
  }

  if (present(source.EVENT_EMAIL_PROVIDER) &&
      !EMAIL_PROVIDERS.includes(source.EVENT_EMAIL_PROVIDER.trim())) {
    errors.push(`EVENT_EMAIL_PROVIDER: must be one of ${EMAIL_PROVIDERS.join(', ')}`);
  }
  if (present(source.EVENT_TICKETING_PROVIDER) &&
      !TICKETING_PROVIDERS.includes(source.EVENT_TICKETING_PROVIDER.trim())) {
    errors.push(`EVENT_TICKETING_PROVIDER: must be one of ${TICKETING_PROVIDERS.join(', ')}`);
  }
  if (present(source.EVENT_OPERATOR_NOTIFIER) &&
      !OPERATOR_NOTIFIERS.includes(source.EVENT_OPERATOR_NOTIFIER.trim())) {
    errors.push(`EVENT_OPERATOR_NOTIFIER: must be one of ${OPERATOR_NOTIFIERS.join(', ')}`);
  }

  // Conditionally required: the external event id only exists for a
  // provider that filters against one (spec §2.1, §3.3).
  if (present(source.EVENT_TICKETING_PROVIDER) &&
      source.EVENT_TICKETING_PROVIDER.trim() === 'eventbrite' &&
      !present(source.EVENT_TICKETING_EVENT_ID)) {
    missing.push('EVENT_TICKETING_EVENT_ID');
  }

  // Apply defaults: copy string-valued env entries, then fill any absent
  // defaultable key so callers consume one resolved object.
  const resolved = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string') resolved[key] = value;
  }
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (!present(resolved[key])) resolved[key] = value;
  }

  return { ok: missing.length === 0 && errors.length === 0, missing, errors, resolved };
}

module.exports = {
  validateDeployEnv,
  REQUIRED_ALWAYS,
  DEFAULTS,
  EMAIL_PROVIDERS,
  TICKETING_PROVIDERS,
  OPERATOR_NOTIFIERS,
};
