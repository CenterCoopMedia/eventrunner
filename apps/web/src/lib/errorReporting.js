// Client-error capture (spec §9, issue #10) — the browser side of
// logClientError. Registers window 'error' and 'unhandledrejection'
// handlers that forward to the Cloud Function; everything here exists to
// make that forwarding safe to run unattended in every visitor's tab:
//
//   - a local benign filter (mirrors functions/src/telemetry/benignFilter.cjs
//     — SafeLinks / stale-bundle / browser-extension noise) so a page left
//     open across a deploy doesn't fire a report on every failed chunk load;
//   - a per-session cap plus a short dedupe window, so a script that throws
//     in a loop cannot flood the endpoint from one tab; and
//   - every reporting path is wrapped so a failure IN reporting (network
//     down, fetch rejected, JSON.stringify throws on a circular context)
//     never becomes a second uncaught error — telemetry must not loop on
//     its own failures.
//
// Server-side redaction (functions/src/telemetry/redact.cjs) is the
// authoritative PII scrub; nothing here needs to duplicate it.
//
// Disabled by default outside a production build (spec: "disabled in
// dev/emulator unless configured") — see isClientErrorReportingEnabled.

const SAFELINKS_RE = /safelinks\.protection\.outlook\.com/i;
const STALE_BUNDLE_RE = new RegExp(
  [
    'ChunkLoadError',
    'Loading chunk \\d+ failed',
    'Failed to fetch dynamically imported module',
    'error loading dynamically imported module',
    'Importing a module script failed',
    'Unable to preload CSS',
  ].join('|'),
  'i',
);
const BROWSER_EXTENSION_RE = new RegExp(
  [
    'chrome-extension://',
    'moz-extension://',
    'safari-extension://',
    'safari-web-extension://',
    'extension context invalidated',
  ].join('|'),
  'i',
);

/** @param {{message?: string, stack?: string, url?: string, userAgent?: string}} report */
export function isBenignClientError(report = {}) {
  const haystacks = [report.message, report.stack, report.url, report.userAgent]
    .filter((value) => typeof value === 'string' && value.length > 0);
  return haystacks.some(
    (value) => SAFELINKS_RE.test(value) || STALE_BUNDLE_RE.test(value) || BROWSER_EXTENSION_RE.test(value),
  );
}

export const MAX_REPORTS_PER_SESSION = 20;
export const DEDUPE_WINDOW_MS = 30_000;

let sentCount = 0;
/** @type {Map<string, number>} report key -> last-sent ms */
const recentReports = new Map();

/** Test hook: drop in-memory throttle/dedupe state between test cases. */
export function resetErrorReportingStateForTest() {
  sentCount = 0;
  recentReports.clear();
}

function shouldThrottle(key, nowMs) {
  if (sentCount >= MAX_REPORTS_PER_SESSION) return true;
  const last = recentReports.get(key);
  if (last !== undefined && nowMs - last < DEDUPE_WINDOW_MS) return true;
  return false;
}

/**
 * Base URL for the deployed HTTP functions (mirrors AuthContext.jsx's
 * functionsOrigin, minus the console.error — telemetry failing to resolve
 * its own endpoint must stay silent, not add console noise on every page).
 * @param {Record<string, string|boolean|undefined>} [env]
 * @returns {string|null}
 */
export function resolveFunctionsOrigin(env = import.meta.env) {
  const override = env.VITE_FUNCTIONS_ORIGIN;
  if (override) return String(override).replace(/\/+$/, '');
  const project = env.VITE_FIREBASE_PROJECT_ID;
  if (!project) return null;
  const region = env.VITE_FIREBASE_REGION || 'us-central1';
  return `https://${region}-${project}.cloudfunctions.net`;
}

/**
 * Whether capture should be active at all. Explicit opt-in/out wins;
 * otherwise on in a production build, off in dev (including the emulator).
 * @param {Record<string, string|boolean|undefined>} [env]
 */
export function isClientErrorReportingEnabled(env = import.meta.env) {
  const explicit = env.VITE_ENABLE_CLIENT_ERROR_REPORTING;
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  return Boolean(env.PROD);
}

/**
 * Send one report to logClientError, applying the benign filter and the
 * session throttle. Never throws — every failure path (network, non-2xx
 * response, an unresolvable origin) is swallowed.
 * @param {{message: string, stack?: string|null, url?: string|null,
 *           userAgent?: string|null, context?: object|null}} report
 * @param {{ env?: object, fetchImpl?: typeof fetch, now?: () => number }} [deps]
 */
export async function reportClientError(report, deps = {}) {
  const { env = import.meta.env, fetchImpl = typeof fetch === 'function' ? fetch : null, now = Date.now } = deps;
  try {
    if (!report || typeof report.message !== 'string' || report.message.length === 0) return;
    if (isBenignClientError(report)) return;
    if (!fetchImpl) return;

    const origin = resolveFunctionsOrigin(env);
    if (!origin) return;

    const nowMs = now();
    const key = `${report.message}|${report.url || ''}`;
    if (shouldThrottle(key, nowMs)) return;
    recentReports.set(key, nowMs);
    sentCount += 1;

    await fetchImpl(`${origin}/logClientError`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // keepalive lets the request survive a page unload triggered by the
      // same error (e.g. a crash during navigation).
      keepalive: true,
      body: JSON.stringify(report),
    });
  } catch {
    // Reporting must never become a second uncaught error.
  }
}

/**
 * @param {ErrorEvent} event
 * @param {Parameters<typeof reportClientError>[1]} [deps] forwarded to reportClientError
 */
export function reportFromWindowErrorEvent(event, deps) {
  const error = event?.error;
  return reportClientError({
    message: (error && error.message) || event?.message || 'Unknown error',
    stack: error && typeof error.stack === 'string' ? error.stack : null,
    url: typeof window !== 'undefined' ? window.location.href : null,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    context: { source: 'window-error', filename: event?.filename || null, lineno: event?.lineno ?? null, colno: event?.colno ?? null },
  }, deps);
}

/**
 * @param {PromiseRejectionEvent} event
 * @param {Parameters<typeof reportClientError>[1]} [deps] forwarded to reportClientError
 */
export function reportFromRejectionEvent(event, deps) {
  const reason = event?.reason;
  const message = reason instanceof Error
    ? reason.message
    : typeof reason === 'string'
      ? reason
      : 'Unhandled promise rejection';
  return reportClientError({
    message,
    stack: reason instanceof Error && typeof reason.stack === 'string' ? reason.stack : null,
    url: typeof window !== 'undefined' ? window.location.href : null,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    context: { source: 'unhandled-rejection' },
  }, deps);
}

let installed = false;

/**
 * Register window error capture. Call once from the app entry (main.jsx).
 * A no-op when reporting is disabled (see isClientErrorReportingEnabled) or
 * when already installed. Returns a teardown function.
 * @param {{ env?: object }} [opts]
 * @returns {() => void}
 */
export function initErrorReporting({ env = import.meta.env } = {}) {
  if (installed || typeof window === 'undefined') return () => {};
  if (!isClientErrorReportingEnabled(env)) return () => {};

  installed = true;
  const onError = (event) => { reportFromWindowErrorEvent(event, { env }); };
  const onRejection = (event) => { reportFromRejectionEvent(event, { env }); };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    installed = false;
  };
}

/** Test hook: allow initErrorReporting to install again in a fresh test. */
export function resetErrorReportingInstalledForTest() {
  installed = false;
}
