'use strict';

/**
 * Benign-error filter for client-error telemetry (spec §9, issue #10:
 * "the SafeLinks and stale-bundle patterns are deployment-independent").
 *
 * Three sources of noise that are not actionable bugs, in any deployment:
 *
 *  - Microsoft SafeLinks / link-scanner crawlers: Outlook rewrites links
 *    through safelinks.protection.outlook.com and pre-fetches them from a
 *    datacenter, with no real user session — the resulting fetch/CORS
 *    failures are indistinguishable from a real bug except by the URL.
 *  - Stale-bundle / chunk-load errors: a browser tab left open across a
 *    deploy tries to lazy-load a chunk hash that no longer exists on the
 *    CDN. The fix is "reload", not a code change, on every deployment.
 *  - Browser-extension noise: errors thrown from injected extension
 *    content scripts (chrome-extension://, moz-extension://, ...) or an
 *    extension's own context being invalidated mid-session — not code this
 *    repository ships.
 *
 * A benign match is filtered before it reaches `system_errors` at all: it
 * is not a rare event worth a durable row, and letting it through would
 * mean every deploy fires an operator alert storm.
 */

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

/**
 * @param {{ message?: string, stack?: string, url?: string, userAgent?: string }} report
 * @returns {boolean} true when the report matches a known-benign pattern in
 *   any of the fields checked — a benign frame deep in an otherwise-real
 *   stack still means "not actionable", since the noisy code is what ran.
 */
function isBenignClientError(report = {}) {
  const haystacks = [report.message, report.stack, report.url, report.userAgent]
    .filter((value) => typeof value === 'string' && value.length > 0);
  return haystacks.some(
    (value) => SAFELINKS_RE.test(value) || STALE_BUNDLE_RE.test(value) || BROWSER_EXTENSION_RE.test(value),
  );
}

module.exports = {
  isBenignClientError,
  internals: { SAFELINKS_RE, STALE_BUNDLE_RE, BROWSER_EXTENSION_RE },
};
