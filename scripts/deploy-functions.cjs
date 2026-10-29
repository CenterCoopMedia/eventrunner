#!/usr/bin/env node
'use strict';

/**
 * Deploy Functions with two narrowly scoped --force exceptions.
 *
 * firebase-tools requires --force to accept a new retry policy in
 * non-interactive mode. The same flag also accepts deletions and unsafe
 * migrations, so a full `--only functions` deploy must never receive it,
 * except on a bootstrap run whose complete inventory (read through the same
 * pinned firebase-tools backend as functions:list) is empty.
 *
 * On any other run, functions that newly enable retry are deployed first
 * with --force and explicit selectors. Existing functions qualify only
 * when their platform, codebase and trigger identity are unchanged. The
 * selectors must reach only intended creates or retry upgrades, without
 * deletions or trigger recreation. The full deploy runs without --force.
 *
 * After the full deploy, the script reads the complete inventory again and
 * fails unless every local function is there in each of its regions.
 * firebase-tools 15.22.4 can exit 0 with a create still unfinished: after a
 * quota 429, the retry waits on a source token that only its own first try
 * would have supplied, the event loop empties, and Node exits 0 with no
 * summary.
 */

const { spawnSync } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');
const fs = require('node:fs');
const path = require('node:path');
const { requireAuth } = require('firebase-tools/lib/requireAuth.js');
const functionsBackend = require('firebase-tools/lib/deploy/functions/backend.js');
const functionsBuild = require('firebase-tools/lib/deploy/functions/build.js');
const functionsRuntimes = require('firebase-tools/lib/deploy/functions/runtimes/index.js');
const functionsEnv = require('firebase-tools/lib/functions/env.js');
const functionsProjectConfig = require('firebase-tools/lib/functions/projectConfig.js');
const { getFirebaseConfig } = require('firebase-tools/lib/functionsConfig.js');
const {
  endpointMatchesFilter,
  parseFunctionSelector,
} = require('firebase-tools/lib/deploy/functions/functionsDeployHelper.js');

const PROJECT_DIR = path.resolve(__dirname, '..');

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

function readFunctionsConfig(projectDir) {
  const firebaseJson = JSON.parse(fs.readFileSync(path.join(projectDir, 'firebase.json'), 'utf8'));
  const config = functionsProjectConfig.normalizeAndValidate(firebaseJson.functions);
  if (config.length !== 1 || config[0].codebase !== functionsProjectConfig.DEFAULT_CODEBASE) {
    throw new Error('firebase.json must define exactly one functions codebase named "default"');
  }
  if (!config[0].source || config[0].prefix) {
    throw new Error('the functions codebase must have a local source and no prefix');
  }
  return config;
}

function literalRegions(endpoint) {
  const regions = endpoint.region;
  if (!Array.isArray(regions) || regions.length === 0) return null;
  const literal = regions.every((region) => typeof region === 'string'
    && region !== functionsBuild.REGION_TBD && /^[a-z0-9-]+$/.test(region));
  return literal ? [...regions] : null;
}

/**
 * Discover the local functions the way `firebase deploy` does: the pinned
 * firebase-tools runtime delegate loads functions/ in a child process with
 * the same discovery environment and reads each export's manifest entry.
 * Returns every function with its retry flag; any retry flag or retry
 * function region that is not a literal value fails closed.
 */
async function discoverLocalFunctions(projectId, {
  projectDir = PROJECT_DIR,
  loadFirebaseConfig = () => getFirebaseConfig({ project: projectId }),
  getDelegate = functionsRuntimes.getRuntimeDelegate,
} = {}) {
  const [codebase] = readFunctionsConfig(projectDir);
  const delegate = await getDelegate({
    projectId,
    sourceDir: path.join(projectDir, codebase.source),
    projectDir,
    runtime: codebase.runtime,
  });
  if (!delegate) throw new Error('no functions runtime was found for the functions source');
  await delegate.validate();
  await delegate.build();
  const firebaseConfig = await loadFirebaseConfig();
  const discovered = await delegate.discoverBuild({ firebase: firebaseConfig }, {
    ...functionsEnv.loadFirebaseEnvs(firebaseConfig, projectId),
    GOOGLE_CLOUD_QUOTA_PROJECT: projectId,
  });
  if (!discovered || typeof discovered.endpoints !== 'object' || discovered.endpoints === null) {
    throw new Error('functions discovery returned no endpoint list');
  }

  return Object.entries(discovered.endpoints).map(([id, endpoint]) => {
    const retry = functionsBuild.isEventTriggered(endpoint) ? endpoint.eventTrigger.retry ?? false : false;
    if (typeof retry !== 'boolean') {
      throw new Error(`${id} has a retry setting that is not a literal true or false`);
    }
    const regions = literalRegions(endpoint);
    if (retry && !regions) throw new Error(`${id} has no literal deploy region`);
    return {
      id, retry, regions, platform: endpoint.platform,
      eventTrigger: functionsBuild.isEventTriggered(endpoint) ? endpoint.eventTrigger : null,
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

const label = ({ id, region }) => `${id}(${region})`;

function triggerIdentity(trigger, inheritedRegion) {
  const identity = { ...trigger };
  delete identity.retry;
  for (const field of ['eventFilters', 'eventFilterPathPatterns']) {
    if (identity[field] && Object.keys(identity[field]).length === 0) delete identity[field];
  }
  // The pinned CLI retains an unspecified trigger region when filters match.
  if (!identity.region && inheritedRegion) identity.region = inheritedRegion;
  return identity;
}

function needsRetryAcceptance(existing, localFunction) {
  if (!existing) return true;
  if (functionsBackend.isEventTriggered(existing) && existing.eventTrigger.retry === true) return false;
  const sameDeployment = ['gcfv1', 'gcfv2'].includes(localFunction.platform)
    && existing.platform === localFunction.platform
    && (existing.codebase || functionsProjectConfig.DEFAULT_CODEBASE) === functionsProjectConfig.DEFAULT_CODEBASE;
  const sameTrigger = functionsBackend.isEventTriggered(existing)
    && existing.eventTrigger.retry === false
    && typeof localFunction.eventTrigger?.eventType === 'string'
    && isDeepStrictEqual(
      triggerIdentity(existing.eventTrigger),
      triggerIdentity(localFunction.eventTrigger, existing.eventTrigger.region),
    );
  if (!sameDeployment || !sameTrigger) {
    throw new Error(`cannot safely enable retries for deployed function ${label(existing)}: `
      + 'platform, codebase or trigger identity differs');
  }
  return true;
}

/**
 * Find new retry policies by id/region using the pinned backend's boolean
 * eventTrigger.retry, including unchanged existing triggers. Prove each
 * selector reaches only these creates/upgrades, never collateral functions.
 */
function planNewRetryFunctions(inventory, localFunctions, config) {
  const deployedByKey = new Map(inventory.map((fn) => [label(fn), fn]));
  const newRetry = localFunctions
    .filter((fn) => fn.retry)
    .flatMap((fn) => fn.regions.map((region) => ({ ...fn, region })))
    .filter((fn) => needsRetryAcceptance(deployedByKey.get(label(fn)), fn))
    .map(({ id, region }) => ({ id, region }));
  const targetKeys = new Set(newRetry.map(label));
  const ids = [...new Set(newRetry.map((fn) => fn.id))].sort();
  if (ids.length === 0) return { functions: [], selectors: [] };

  const selectors = ids.map((id) => `functions:${id}`);
  const filters = ids.flatMap((id) => parseFunctionSelector(id, config));
  const matches = (endpoint) => filters.some((filter) => endpointMatchesFilter(endpoint, filter));

  const deployedHits = inventory.filter((fn) => matches(fn) && !targetKeys.has(label(fn)));
  if (deployedHits.length > 0) {
    throw new Error(`a forced deploy of ${selectors.join(',')} would also change deployed `
      + `function(s): ${deployedHits.map(label).join(', ')}`);
  }
  const localHits = localFunctions.filter((fn) => matches(fn) && !ids.includes(fn.id));
  if (localHits.length > 0) {
    throw new Error(`a forced deploy of ${selectors.join(',')} would also deploy `
      + `function(s): ${localHits.map((fn) => fn.id).join(', ')}`);
  }
  return { functions: newRetry, selectors };
}

/**
 * List each local function, as id(region), that the complete inventory does
 * not hold. A function with no literal region cannot be checked, so it
 * counts as absent.
 */
function absentFunctions(inventory, localFunctions) {
  const deployedKeys = new Set(inventory.map(label));
  return localFunctions.flatMap((fn) => {
    if (!fn.regions) return [`${fn.id}(no literal region)`];
    return fn.regions.map((region) => label({ id: fn.id, region }))
      .filter((key) => !deployedKeys.has(key));
  });
}

function deployFailure(deployment) {
  return Number.isInteger(deployment.status) && deployment.status > 0 ? deployment.status : 1;
}

async function main({
  env = process.env,
  run = defaultRun,
  verifyCompleteInventory = readCompleteInventory,
  discoverFunctions = discoverLocalFunctions,
  readConfig = () => readFunctionsConfig(PROJECT_DIR),
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

  let inventory;
  try {
    inventory = await verifyCompleteInventory(projectId);
  } catch (error) {
    log.error(reportFailure('deploy-functions: could not verify a complete functions inventory', {}, error));
    return 1;
  }

  const forceInitialDeploy = bootstrap === 'true' && inventory.length === 0;
  let localFunctions;
  if (forceInitialDeploy) {
    log.log('deploy-functions: bootstrap inventory is empty; accepting initial retry and cleanup policies');
  } else {
    if (bootstrap === 'true') {
      log.log(`deploy-functions: bootstrap inventory has ${inventory.length} function(s); deploying without --force`);
    }
    try {
      localFunctions = await discoverFunctions(projectId);
    } catch (error) {
      log.error(reportFailure('deploy-functions: could not read the local functions', {}, error));
      return 1;
    }
    let plan;
    try {
      plan = planNewRetryFunctions(inventory, localFunctions, readConfig());
    } catch (error) {
      log.error(reportFailure('deploy-functions: refusing a forced deploy of retry policies', {}, error));
      return 1;
    }
    if (plan.selectors.length > 0) {
      log.log('deploy-functions: accepting new retry policies with a targeted --force deploy: '
        + plan.functions.map(label).join(', '));
      const targeted = run([
        'firebase', 'deploy', '--only', plan.selectors.join(','),
        '--project', projectId, '--non-interactive', '--force',
      ], { stdio: 'inherit' });
      if (failed(targeted)) {
        log.error(reportFailure('deploy-functions: targeted deploy of retry policies failed', targeted));
        return deployFailure(targeted);
      }
    }
  }

  const args = [...firebaseArgs('deploy', projectId), '--only', 'functions'];
  if (forceInitialDeploy) args.push('--force');
  const deployment = run(args, { stdio: 'inherit' });
  if (failed(deployment)) {
    log.error(reportFailure('deploy-functions: Firebase deploy failed', deployment));
    return deployFailure(deployment);
  }

  let deployed;
  try {
    localFunctions ??= await discoverFunctions(projectId);
    deployed = await verifyCompleteInventory(projectId);
  } catch (error) {
    log.error(reportFailure('deploy-functions: could not verify the deployed functions', {}, error));
    return 1;
  }
  const absent = absentFunctions(deployed, localFunctions);
  if (absent.length > 0) {
    log.error(`deploy-functions: Firebase deploy exited 0, but ${absent.length} function(s) are not deployed: `
      + `${absent.join(', ')}. Run the deploy again; unchanged functions are skipped.`);
    return 1;
  }
  log.log(`deploy-functions: verified ${localFunctions.length} function(s) in the deployed inventory`);
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

module.exports = {
  main,
  firebaseArgs,
  readCompleteInventory,
  discoverLocalFunctions,
  planNewRetryFunctions,
};
