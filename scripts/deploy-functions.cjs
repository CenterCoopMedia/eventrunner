#!/usr/bin/env node
'use strict';

/**
 * Deploy Functions with a narrowly scoped first-deploy exception.
 *
 * firebase-tools requires --force to accept a new retry policy in
 * non-interactive mode. The same flag also accepts deletions and unsafe
 * migrations, so ordinary deployments must never receive it. A bootstrap
 * run receives it only after the same pinned firebase-tools backend used
 * by functions:list returns an empty result with every region reachable.
 */

const { spawnSync } = require('node:child_process');
const { requireAuth } = require('firebase-tools/lib/requireAuth.js');
const functionsBackend = require('firebase-tools/lib/deploy/functions/backend.js');

function firebaseArgs(command, projectId) {
  return ['firebase', command, '--project', projectId, '--non-interactive'];
}

function defaultRun(args, options) {
  return spawnSync('npx', args, options);
}

function failed(result) {
  return result.error || result.status !== 0;
}

function reportFailure(label, result, error) {
  const detail = error?.message || result.error?.message || result.stderr?.trim();
  return detail ? `${label}: ${detail}` : `${label} (exit ${result.status ?? 'unknown'})`;
}

async function readCompleteInventory(projectId, {
  authenticate = requireAuth,
  loadBackend = functionsBackend.existingBackend,
  allEndpoints = functionsBackend.allEndpoints,
} = {}) {
  await authenticate({ project: projectId, nonInteractive: true });
  const context = { projectId };
  const backend = await loadBackend(context);
  const availability = context.unreachableRegions;
  if (!availability || ['gcfV1', 'gcfV2', 'run'].some((key) => !Array.isArray(availability[key]))) {
    throw new Error('Functions inventory did not report regional availability');
  }
  const unreachable = Object.values(availability).flat();
  if (unreachable.length > 0) {
    throw new Error(`Functions inventory is incomplete; unreachable region(s): ${unreachable.join(', ')}`);
  }
  const endpoints = allEndpoints(backend);
  if (!Array.isArray(endpoints)) {
    throw new Error('Functions inventory returned an invalid endpoint list');
  }
  return endpoints;
}

async function main({
  env = process.env,
  run = defaultRun,
  verifyCompleteInventory = readCompleteInventory,
  log = console,
} = {}) {
  const projectId = env.EVENT_FIREBASE_PROJECT_ID?.trim();
  const bootstrap = env.EVENT_BOOTSTRAP;

  if (!projectId) {
    log.error('deploy-functions: EVENT_FIREBASE_PROJECT_ID is required');
    return 1;
  }
  if (bootstrap !== 'true' && bootstrap !== 'false') {
    log.error('deploy-functions: EVENT_BOOTSTRAP must be true or false');
    return 1;
  }

  let forceInitialDeploy = false;
  if (bootstrap === 'true') {
    let functions;
    try {
      functions = await verifyCompleteInventory(projectId);
    } catch (error) {
      log.error(reportFailure('deploy-functions: could not verify a complete functions inventory', {}, error));
      return 1;
    }
    forceInitialDeploy = functions.length === 0;
    if (forceInitialDeploy) {
      log.log('deploy-functions: bootstrap inventory is empty; accepting initial retry and cleanup policies');
    } else {
      log.log(`deploy-functions: bootstrap inventory has ${functions.length} function(s); deploying without --force`);
    }
  }

  const args = [...firebaseArgs('deploy', projectId), '--only', 'functions'];
  if (forceInitialDeploy) args.push('--force');
  const deployment = run(args, { stdio: 'inherit' });
  if (failed(deployment)) {
    log.error(reportFailure('deploy-functions: Firebase deploy failed', deployment));
    return Number.isInteger(deployment.status) && deployment.status > 0 ? deployment.status : 1;
  }
  return 0;
}

if (require.main === module) {
  main()
    .then((code) => { process.exitCode = code; })
    .catch((error) => {
      console.error(`deploy-functions: unexpected failure: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = { main, firebaseArgs, readCompleteInventory };
