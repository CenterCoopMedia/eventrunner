#!/usr/bin/env node
'use strict';

const { parseEventPublicBase } = require('shared/config/publicBase');

// Capture and restore the client-host router Worker version through the Cloudflare API.
// `wrangler rollback` and `wrangler versions deploy` first read every version in the current
// deployment and do not retry Cloudflare code 100146, which a just-uploaded version can return (#1125).
// Restore here creates the deployment for the recorded version directly and reads it back.

const API = 'https://api.cloudflare.com/client/v4';
const VERSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const WORKER_NAME = /^[a-z0-9][a-z0-9_-]*$/;
const ATTEMPTS = 5;

class VersionFailure extends Error {}

function check(condition, label) {
  if (!condition) throw new VersionFailure(label);
}

async function cloudflare(fetchImpl, env, path, init = {}) {
  check(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN, 'Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN');
  let body;
  try {
    const response = await fetchImpl(`${API}/accounts/${env.CLOUDFLARE_ACCOUNT_ID}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    body = await response.json();
  } catch {
    throw new VersionFailure(`Cloudflare API ${init.method || 'GET'} ${path}: request failed`);
  }
  if (!body.success) {
    const errors = (body.errors || []).map((error) => `${error.code}: ${error.message}`).join('; ');
    throw new VersionFailure(`Cloudflare API ${init.method || 'GET'} ${path}: ${errors || 'no result'}`);
  }
  return body.result;
}

async function activeDeployment(fetchImpl, env, worker) {
  const { deployments } = await cloudflare(fetchImpl, env, `/workers/scripts/${worker}/deployments`);
  // Cloudflare lists the deployment serving traffic first.
  check(deployments?.length > 0, `${worker} has no deployment`);
  return deployments[0];
}

function soleVersion(deployment) {
  const [only, ...rest] = deployment.versions || [];
  return rest.length === 0 && only?.percentage === 100 ? only.version_id : null;
}

async function captureVersion(fetchImpl, env, worker) {
  check(WORKER_NAME.test(worker || ''), 'Supply the Worker name');
  const deployment = await activeDeployment(fetchImpl, env, worker);
  const versionId = soleVersion(deployment);
  check(versionId, `${worker} splits traffic across versions; record and restore needs one version at 100%`);
  return { worker, versionId, deploymentId: deployment.id };
}

function mountedBase(value) {
  let parsed;
  try {
    parsed = parseEventPublicBase(value);
  } catch {
    parsed = {};
  }
  check(parsed.mount, `Supply each mounted public base as https://<host>/<mount>/, not ${JSON.stringify(value)}`);
  return parsed.publicBase;
}

async function probeBase(fetchImpl, url, sleep) {
  // The new deployment can take a few seconds to reach the location that answers the probe.
  let status = 'no response';
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    if (attempt > 1) await sleep(1000);
    try {
      status = (await fetchImpl(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(8000) })).status;
    } catch {
      status = 'request failed';
    }
    if (status === 200) return { url, status };
  }
  throw new VersionFailure(`${url}: expected HTTP 200, last received ${status}`);
}

async function restoreVersion(fetchImpl, env, worker, versionId, publicBases, sleep) {
  check(WORKER_NAME.test(worker || ''), 'Supply the Worker name');
  check(VERSION_ID.test(versionId || ''), 'Supply the version id recorded by capture before the change');
  check(publicBases.length > 0, 'Supply each mounted public base');
  const urls = publicBases.map(mountedBase);
  const created = await cloudflare(fetchImpl, env, `/workers/scripts/${worker}/deployments`, {
    method: 'POST',
    body: JSON.stringify({
      strategy: 'percentage',
      versions: [{ version_id: versionId, percentage: 100 }],
      annotations: { 'workers/message': `Restore recorded version ${versionId}` },
    }),
  });
  let active;
  for (let attempt = 1; ; attempt += 1) {
    active = await activeDeployment(fetchImpl, env, worker);
    if (active.id === created.id && soleVersion(active) === versionId) break;
    check(attempt < ATTEMPTS, `Readback: the active deployment is ${active.id} serving `
      + `${JSON.stringify(active.versions)}, not ${versionId} at 100%`);
    await sleep(1000);
  }
  const mounts = [];
  for (const url of urls) mounts.push(await probeBase(fetchImpl, url, sleep));
  return { worker, versionId, deploymentId: active.id, mounts };
}

async function cli([command, ...args], env = process.env) {
  if (command === 'capture' && args.length === 1) return captureVersion(fetch, env, ...args);
  if (command === 'restore' && args.length >= 3) {
    const [worker, versionId, ...publicBases] = args;
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    return restoreVersion(fetch, env, worker, versionId, publicBases, sleep);
  }
  throw new VersionFailure('Usage: capture <worker> | restore <worker> <version-id> <public base>...'
    + ' (docs/runbooks/event-mount-operations.md)');
}

if (require.main === module) {
  cli(process.argv.slice(2)).then((result) => {
    console.log(JSON.stringify({ ...result, verifiedAt: new Date().toISOString() }));
  }).catch((error) => {
    console.error(`Worker version ${process.argv[2] || 'command'} failed: `
      + `${error instanceof VersionFailure ? error.message : 'unexpected error'}`);
    process.exitCode = 1;
  });
}

module.exports = { captureVersion, restoreVersion };
