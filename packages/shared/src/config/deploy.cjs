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
/**
 * Google service-account email. Deliberately narrow: a bare account id, a
 * user email, or a typo'd domain would be accepted by `gcloud run jobs
 * deploy` only to fail at execution time, long after the deploy is green.
 */
const SERVICE_ACCOUNT_RE = /^[a-z0-9-]+@[a-z0-9.-]+\.(iam\.)?gserviceaccount\.com$/;

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
  // OTP abuse controls (issue #45). Off / conservative by default so an
  // existing deployment keeps its current behavior; both are documented in
  // .env.example. Mirrored by challenges.cjs SEND_CEILING_MAX.
  EVENT_APP_CHECK_ENFORCED: 'false',
  EVENT_OTP_SEND_CEILING_PER_HOUR: '500',
  // Site publisher (spec §8.4 phase 5, issue #36). Off by default: the job
  // needs an Artifact Registry repository, a Cloud Run job, and a dedicated
  // runtime service account that no existing client project has, and a
  // deployment without them must keep deploying exactly as before.
  EVENT_SITE_PUBLISHER_ENABLED: 'false',
};

/**
 * Cloud Run job name for the site publisher (spec §8.4). Fixed rather than
 * configurable: one job per client project, named the same everywhere, so
 * the workflow, the runbook, and the `run.invoker` grant cannot drift apart
 * — and so the functions runtime learns "a publisher exists here" from the
 * presence of EVENT_SITE_PUBLISHER_JOB alone.
 */
const SITE_PUBLISHER_JOB_NAME = 'site-publisher';

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

  // OTP abuse controls (issue #45). Both are optional, but a value that
  // does not parse must fail the build rather than silently reverting to
  // the default — a deployment that believes it raised its ceiling, or
  // turned App Check on, and did neither is the worst outcome.
  if (present(source.EVENT_APP_CHECK_ENFORCED) &&
      !['true', 'false'].includes(source.EVENT_APP_CHECK_ENFORCED.trim().toLowerCase())) {
    errors.push('EVENT_APP_CHECK_ENFORCED: must be true or false');
  }
  if (present(source.EVENT_OTP_SEND_CEILING_PER_HOUR)) {
    const ceiling = Number(source.EVENT_OTP_SEND_CEILING_PER_HOUR.trim());
    if (!Number.isInteger(ceiling) || ceiling <= 0) {
      errors.push('EVENT_OTP_SEND_CEILING_PER_HOUR: must be a positive integer (there is no unlimited setting)');
    }
  }
  // Enforcing App Check without a site key in the bundle locks every real
  // visitor out of sign-in: the client would send no attestation token and
  // the platform would reject every request.
  if (present(source.EVENT_APP_CHECK_ENFORCED) &&
      source.EVENT_APP_CHECK_ENFORCED.trim().toLowerCase() === 'true' &&
      !present(source.VITE_FIREBASE_APP_CHECK_SITE_KEY)) {
    missing.push('VITE_FIREBASE_APP_CHECK_SITE_KEY');
  }

  // Site publisher (spec §8.4 phase 5). Same reasoning as the App Check
  // flag above: a deployment that believes it enabled the publisher and did
  // not is the worst outcome, so an unparseable flag fails the build rather
  // than reverting to 'false'.
  if (present(source.EVENT_SITE_PUBLISHER_ENABLED) &&
      !['true', 'false'].includes(source.EVENT_SITE_PUBLISHER_ENABLED.trim().toLowerCase())) {
    errors.push('EVENT_SITE_PUBLISHER_ENABLED: must be true or false');
  }
  const publisherEnabled = present(source.EVENT_SITE_PUBLISHER_ENABLED) &&
    source.EVENT_SITE_PUBLISHER_ENABLED.trim().toLowerCase() === 'true';
  if (publisherEnabled && !present(source.EVENT_PUBLISHER_SERVICE_ACCOUNT)) {
    // No default. The job must run as a service account scoped to exactly
    // this project's Firestore/Storage/Hosting (§8.4: "under the project's
    // own service account"); silently falling back to a broadly-scoped
    // default account is the failure mode that rule exists to prevent.
    missing.push('EVENT_PUBLISHER_SERVICE_ACCOUNT');
  }
  for (const key of ['EVENT_PUBLISHER_SERVICE_ACCOUNT', 'EVENT_FUNCTIONS_SERVICE_ACCOUNT']) {
    if (present(source[key]) && !SERVICE_ACCOUNT_RE.test(source[key].trim())) {
      errors.push(`${key}: must be a service-account email (name@<project>.iam.gserviceaccount.com)`);
    }
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
  SITE_PUBLISHER_JOB_NAME,
  EMAIL_PROVIDERS,
  TICKETING_PROVIDERS,
  OPERATOR_NOTIFIERS,
};
