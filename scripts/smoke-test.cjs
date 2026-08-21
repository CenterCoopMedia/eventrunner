#!/usr/bin/env node
'use strict';

/**
 * Post-deploy smoke test (spec §8.1 `smoke` job, issue #19).
 *
 * OPTIONS-preflights every function name in `.github/smoke-endpoints.json`
 * against the deployment's Cloud Functions domain (every onRequest handler
 * answers OPTIONS with 204 regardless of origin — functions/src/core/http.cjs)
 * and GETs the deployed site's public URL. Fails loudly (no
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

const { parseArgv, unknownFlags } = require('./lib/args.cjs');
const { buildSmokeUrls } = require('./lib/deploy-matrix.cjs');

const FLAGS = ['region', 'project-id', 'public-url', 'endpoints-file', 'help'];
const ROOT = path.resolve(__dirname, '..');

function usage() {
  return [
    'Usage: node scripts/smoke-test.cjs --region <region> --project-id <id>',
    '         --public-url <url> [--endpoints-file <path>]',
  ].join('\n');
}

/**
 * @param {string} url
 * @param {{ method?: string }} [opts]
 * @returns {Promise<{ url: string, ok: boolean, status: number|null, error: string|null }>}
 */
async function probe(url, { method = 'GET' } = {}) {
  try {
    const res = await fetch(url, { method, redirect: 'manual' });
    // OPTIONS preflights answer 204; a plain GET of the hosted site is a
    // healthy 2xx or an edge redirect (3xx) — never a 4xx/5xx.
    const ok = res.status < 400;
    return { url, ok, status: res.status, error: null };
  } catch (err) {
    return { url, ok: false, status: null, error: err.message };
  }
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
    ...functionUrls.map((url) => ({ url, method: 'OPTIONS' })),
  ];

  const results = [];
  for (const check of checks) {
    // Sequential and small: this is a handful of HTTP calls right after a
    // deploy, not a load test.
    results.push(await probe(check.url, { method: check.method }));
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

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((err) => {
      console.error(`smoke-test: ${err.message}`);
      process.exitCode = 1;
    });
}

module.exports = { main, probe };
