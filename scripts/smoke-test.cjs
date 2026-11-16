#!/usr/bin/env node
'use strict';

/**
 * Post-deploy smoke test (spec §8.1 `smoke` job, issue #19).
 *
 * Waits up to 90 seconds for every reviewed function's OPTIONS preflight to
 * return a non-5xx status, then checks each function and the public site once.
 * Uses `.github/smoke-endpoints.json` against the deployment's Cloud Functions
 * domain. Browser handlers answer
 * OPTIONS with 204; POST-only webhooks reject it with 405. Also GETs the
 * deployed site's public URL. Fails loudly (no
 * `continue-on-error` anywhere per spec §8.1) so a bad deploy is caught
 * before an operator finds out from a client.
 *
 * Usage:
 *   node scripts/smoke-test.cjs --region us-central1 --project-id cjs2027-prod \
 *     --public-url https://summit.example.org \
 *     --endpoints-file .github/smoke-endpoints.json
 */

const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { setTimeout: sleep } = require('node:timers/promises');

const { parseArgv, unknownFlags } = require('./lib/args.cjs');
const { buildSmokeUrls } = require('./lib/deploy-matrix.cjs');

const FLAGS = ['region', 'project-id', 'public-url', 'endpoints-file', 'help'];
const ROOT = path.resolve(__dirname, '..');

// These method guards return 405 before authentication or writes:
// functions/src/email/send.cjs and functions/src/ticketing/webhook.cjs.
const POST_ONLY_WEBHOOKS = new Set(['emailDeliveryWebhook', 'ticketingWebhook']);
const REQUEST_TIMEOUT_MS = 10_000;
const READINESS_TIMEOUT_MS = 90_000;
const READINESS_INTERVAL_MS = 2_000;

function usage() {
  return [
    'Usage: node scripts/smoke-test.cjs --region <region> --project-id <id>',
    '         --public-url <url> [--endpoints-file <path>]',
  ].join('\n');
}

/**
 * @param {string} url
 * @param {{ method?: string, expectedStatus?: number, timeoutMs?: number }} [opts]
 * @returns {Promise<{ url: string, ok: boolean, status: number|null, error: string|null }>}
 */
async function probe(url, { method = 'GET', expectedStatus, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, redirect: 'manual', signal: controller.signal });
    // Only known POST-only webhooks have an expected 405 on OPTIONS.
    const ok = res.status < 400 || res.status === expectedStatus;
    return { url, ok, status: res.status, error: null };
  } catch (err) {
    return { url, ok: false, status: null,
      error: controller.signal.aborted ? `request timed out after ${timeoutMs} ms` : err.message };
  } finally {
    clearTimeout(timer);
    // This status-only check does not consume the response body.
    controller.abort();
  }
}

async function waitForReadiness(urls, {
  timeoutMs = READINESS_TIMEOUT_MS,
  intervalMs = READINESS_INTERVAL_MS,
} = {}) {
  const pending = new Map(urls.map((url) => [url, {
    url, status: null, error: 'readiness deadline reached before first response',
  }]));
  const deadline = performance.now() + timeoutMs;
  while (pending.size > 0 && performance.now() < deadline) {
    // A shared deadline bounds the whole endpoint list, including slow requests.
    const results = await Promise.all([...pending.keys()].map((url) => probe(url, {
      method: 'OPTIONS',
      timeoutMs: Math.min(REQUEST_TIMEOUT_MS, Math.max(1, deadline - performance.now())),
    })));
    for (const result of results) {
      if (result.status !== null && result.status < 500) pending.delete(result.url);
      else pending.set(result.url, result);
    }
    if (pending.size > 0) {
      const remaining = deadline - performance.now();
      if (remaining <= intervalMs) {
        // A shortened final sleep ends the wait. Timer rounding must not start
        // another preflight with only a fraction of a millisecond remaining.
        if (remaining > 0) await sleep(Math.ceil(remaining));
        break;
      }
      await sleep(intervalMs);
    }
  }
  return [...pending.values()];
}

async function runChecks(checks, readinessOptions) {
  const notReady = await waitForReadiness(
    checks.filter((check) => check.method === 'OPTIONS').map((check) => check.url),
    readinessOptions,
  );
  if (notReady.length > 0) {
    for (const r of notReady) {
      console.log(`FAIL ${r.status ?? 'ERR'}  ${r.url}${r.error ? `  (${r.error})` : ''}`);
    }
    console.error(`smoke-test: readiness timeout; endpoints never ready: ${notReady.map((r) => r.url).join(', ')}`);
    return 1;
  }

  const results = [];
  for (const check of checks) {
    // Run each check exactly once after every function has answered a preflight.
    results.push(await probe(check.url, check));
  }

  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    const label = r.ok ? 'ok  ' : 'FAIL';
    console.log(`${label} ${r.status ?? 'ERR'}  ${r.url}${r.error ? `  (${r.error})` : ''}`);
  }

  if (failed.length > 0) {
    console.error(`\nsmoke-test: ${failed.length} of ${results.length} check(s) failed`);
    return 1;
  }
  console.log(`\nsmoke-test: ${results.length} check(s) passed`);
  return 0;
}

async function main(argv) {
  const args = parseArgv(argv, {
    withValue: ['region', 'project-id', 'public-url', 'endpoints-file'],
  });
  const unknown = unknownFlags(args, FLAGS);
  if (args.help) {
    console.log(usage());
    return 0;
  }
  if (unknown.length > 0) {
    console.error(`Unknown flag(s): ${unknown.map((f) => `--${f}`).join(', ')}\n\n${usage()}`);
    return 2;
  }
  for (const required of ['region', 'project-id', 'public-url']) {
    if (typeof args[required] !== 'string' || args[required].trim() === '') {
      console.error(`Missing --${required}\n\n${usage()}`);
      return 2;
    }
  }

  const endpointsFile = path.resolve(
    ROOT,
    typeof args['endpoints-file'] === 'string' ? args['endpoints-file'] : '.github/smoke-endpoints.json',
  );
  const { endpoints } = JSON.parse(fs.readFileSync(endpointsFile, 'utf8'));
  const functionUrls = buildSmokeUrls({
    region: args.region,
    projectId: args['project-id'],
    endpoints,
  });

  const checks = [
    { url: args['public-url'], method: 'GET' },
    ...functionUrls.map((url, index) => ({
      url,
      method: 'OPTIONS',
      expectedStatus: POST_ONLY_WEBHOOKS.has(endpoints[index]) ? 405 : undefined,
    })),
  ];

  return runChecks(checks);
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((err) => {
      console.error(`smoke-test: ${err.message}`);
      process.exitCode = 1;
    });
}

module.exports = { main, probe, runChecks };
