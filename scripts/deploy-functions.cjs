#!/usr/bin/env node
'use strict';

/**
 * Deploy Functions with two narrowly scoped --force exceptions.
 *
 * firebase-tools requires --force to accept a new retry policy in
 * non-interactive mode. The same flag also accepts deletions and unsafe
 * migrations, so a full `--only functions` deploy must never receive it.
 * A verified-empty bootstrap creates functions in paced, explicit groups.
 * Every forced group must select only functions that do not exist yet.
 *
 * On any other run, functions that newly enable retry are deployed first
 * with --force and explicit selectors. Existing functions qualify only
 * when their platform, codebase and trigger identity are unchanged. The
 * selectors must reach only intended creates or retry upgrades, without
 * deletions or trigger recreation. The full deploy runs without --force.
 *
 * Every CLI child paces actual Functions and Cloud Run writes, including
 * invoker policies and HTTP retries. Ordinary deploys keep the CLI's hash
 * comparison instead of forcing unchanged functions with explicit selectors.
 *
 * After each deploy, the script reads the complete inventory again. A
 * successful CLI exit with missing function state waits out the provider's
 * write-quota window, then starts a fresh guarded deploy. Other failures stop.
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
const firebaseLogger = require('firebase-tools/lib/logger.js').logger;
const {
  endpointMatchesFilter,
  parseFunctionSelector,
} = require('firebase-tools/lib/deploy/functions/functionsDeployHelper.js');

const PROJECT_DIR = path.resolve(__dirname, '..');
// The v1 write quota uses a 100-second window; v2 uses a 60-second window.
const QUOTA_RECOVERY_WAIT_MS = 105_000;
const MAX_DEPLOY_ATTEMPTS = 3;
// V2 permits 60 writes/60 seconds per region; v1 permits 80/100 seconds per project.
const INITIAL_BATCH_WRITES = 50;
const INITIAL_BATCH_WAIT_MS = 105_000;

function firebaseArgs(command, projectId) {
  return ['firebase', command, '--project', projectId, '--non-interactive'];
}

function createDeployRunner({ spawn = spawnSync, now = () => performance.now(), wait = defaultWait } = {}) {
  let finishedAt = null;
  return async (args, options) => {
    // A child owns its request clock. A completed child's quota window must
    // expire before another child starts, including targeted retry-policy work.
    if (finishedAt !== null) {
      const remaining = QUOTA_RECOVERY_WAIT_MS - (now() - finishedAt);
      if (remaining > 0) await wait(remaining);
    }
    const result = spawn(process.execPath, [path.join(__dirname, 'firebase-functions-cli.cjs'), ...args.slice(1)], options);
    finishedAt = now();
    return result;
  };
}

function defaultWait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function failed(result) {
  return result.error || result.status !== 0;
}

function reportFailure(label, result, error) {
  const detail = error?.message || result.error?.message || result.stderr?.trim();
  return detail ? `${label}: ${detail}` : `${label} (exit ${result.status ?? 'unknown'})`;
}

const DIAGNOSTIC_ERROR_TYPES = new Set(['Error', 'FirebaseError', 'FetchError', 'AbortError', 'TypeError', 'SyntaxError', 'ReferenceError', 'RangeError']);
const DIAGNOSTIC_ERROR_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN',
  'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'EPROTO', 'ABORT_ERR',
  'ERR_STREAM_PREMATURE_CLOSE', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
  'INVENTORY_NO_AVAILABILITY', 'INVENTORY_UNREACHABLE_REGIONS', 'INVENTORY_BAD_ENDPOINTS',
  'FUNCTIONS_ANALYSIS_FAILED', 'FUNCTIONS_NO_RUNTIME', 'FUNCTIONS_BAD_ENDPOINTS',
  'FUNCTIONS_RETRY_VALUE', 'FUNCTIONS_RETRY_REGIONS',
  'FUNCTIONS_INITIAL_REGIONS', 'FUNCTIONS_INITIAL_SELECTORS', 'FUNCTIONS_INITIAL_BUDGET', 'FUNCTIONS_INITIAL_EXISTS',
  'FUNCTIONS_CONFIG_CODEBASE', 'FUNCTIONS_CONFIG_SOURCE',
  'MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED',
  'ERR_REQUIRE_ESM', 'ERR_REQUIRE_ASYNC_MODULE', 'ENOENT', 'EACCES',
]);

function diagnosticLocations(message, projectDir) {
  const locations = [];
  const pattern = /(?:^|[\s(/\\])((?:(?:functions|scripts)[/\\]|node_modules[/\\](?:firebase-functions|firebase-tools)[/\\]lib[/\\])[A-Za-z0-9_./\\-]+\.(?:cjs|js)):(\d+)(?::(\d+))?/g;
  for (const match of message.matchAll(pattern)) {
    const file = match[1].replaceAll('\\', '/');
    if (file.split('/').includes('..') || !fs.existsSync(path.join(projectDir, file))) continue;
    locations.push(`${file}:${match[2]}${match[3] ? `:${match[3]}` : ''}`);
    if (locations.length === 3) break;
  }
  return locations;
}

function diagnosticDetail(error, projectDir = PROJECT_DIR) {
  const detail = {};
  if (DIAGNOSTIC_ERROR_TYPES.has(error.name)) detail.type = error.name;
  // FirebaseError defaults this field to 500 even without an HTTP response.
  if (Number.isInteger(error.status) && error.status >= 100 && error.status <= 599) detail.sdkStatus = error.status;
  if (Number.isInteger(error.httpStatus) && error.httpStatus >= 100 && error.httpStatus <= 599) detail.httpStatus = error.httpStatus;
  if (DIAGNOSTIC_ERROR_CODES.has(error.code)) detail.code = error.code;
  if (['FUNCTIONS_RETRY_VALUE', 'FUNCTIONS_RETRY_REGIONS', 'FUNCTIONS_INITIAL_REGIONS',
    'FUNCTIONS_INITIAL_SELECTORS', 'FUNCTIONS_INITIAL_BUDGET', 'FUNCTIONS_INITIAL_EXISTS'].includes(error.code)
      && typeof error.functionId === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,62}$/.test(error.functionId)) {
    detail.function = error.functionId;
  }
  if (error.code === 'INVENTORY_UNREACHABLE_REGIONS' && Array.isArray(error.regions)) {
    detail.regions = error.regions.slice(0, 20).filter((region) => typeof region === 'string' && /^[a-z]+(?:-[a-z]+)+\d{1,2}$/.test(region));
  }
  if (Array.isArray(error.locations)) {
    const text = error.locations.slice(0, 3).filter((entry) => typeof entry === 'string').map((entry) => entry.slice(0, 256)).join('\n');
    const locations = diagnosticLocations(text, projectDir);
    if (locations.length) detail.locations = locations;
  }
  return detail;
}

function diagnosticFailure(label, phase, error) {
  const pending = [error];
  const seen = new Set();
  const causes = [];
  // Firebase wraps transport failures in original; Node errors can use cause.
  // Only fixed diagnostic fields are safe: messages and context can hold tokens or URLs.
  for (let index = 0; index < pending.length && index < 4; index += 1) {
    const current = pending[index];
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    const detail = diagnosticDetail(current);
    if (Object.keys(detail).length > 0) causes.push(detail);
    for (const cause of [current.original, current.cause]) {
      if (cause && typeof cause === 'object' && !seen.has(cause)) pending.push(cause);
    }
  }
  const analysis = Array.isArray(error?.analysisDiagnostics)
    ? error.analysisDiagnostics.slice(-8).map((entry) => {
      const detail = diagnosticDetail({ name: entry?.type, code: entry?.code, status: entry?.sdkStatus,
        httpStatus: entry?.httpStatus, locations: entry?.locations });
      if (Object.keys(detail).length && ['sdk', 'firebase-debug.log'].includes(entry?.source)) detail.source = entry.source;
      return detail;
    }).filter((entry) => Object.keys(entry).length > 0)
    : [];
  return `${label}: ${JSON.stringify({ phase, causes, ...(analysis.length ? { analysis } : {}) })}`;
}

/** Arbitrary SDK text can contain credentials. Emit only fixed classifications. */
function sdkDiagnostic(message, projectDir = PROJECT_DIR) {
  if (typeof message !== 'string') return null;
  const text = message.slice(-8192);
  const type = [...DIAGNOSTIC_ERROR_TYPES].find((name) => new RegExp(`\\b${name}:`).test(text));
  const code = [...DIAGNOSTIC_ERROR_CODES].find((name) => new RegExp(`\\b${name}\\b`).test(text));
  const status = message.match(/Got response code ([1-5]\d\d); body /);
  const detail = diagnosticDetail({ name: type, code, httpStatus: status ? Number(status[1]) : undefined,
    locations: diagnosticLocations(text, projectDir) }, projectDir);
  return Object.keys(detail).length ? detail : null;
}

function debugLogDiagnostics(projectDir, discoveryStartedAt) {
  let descriptor;
  try {
    const file = path.join(projectDir, 'firebase-debug.log');
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.mtimeMs < discoveryStartedAt) return [];
    descriptor = fs.openSync(file, 'r');
    const size = fs.fstatSync(descriptor).size;
    const buffer = Buffer.alloc(Math.min(size, 32768));
    fs.readSync(descriptor, buffer, 0, buffer.length, size - buffer.length);
    return buffer.toString('utf8').split('\n').slice(-20).map((line) => sdkDiagnostic(line, projectDir)).filter(Boolean)
      .slice(-8).map((detail) => ({ ...detail, source: 'firebase-debug.log' }));
  } catch {
    return [];
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
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
    throw Object.assign(new Error('Functions inventory did not report regional availability'), { code: 'INVENTORY_NO_AVAILABILITY' });
  }
  const unreachable = Object.values(availability).flat();
  if (unreachable.length > 0) {
    throw Object.assign(new Error(`Functions inventory is incomplete; unreachable region(s): ${unreachable.join(', ')}`), { code: 'INVENTORY_UNREACHABLE_REGIONS', regions: unreachable });
  }
  const endpoints = allEndpoints(backend);
  if (!Array.isArray(endpoints)) {
    throw Object.assign(new Error('Functions inventory returned an invalid endpoint list'), { code: 'INVENTORY_BAD_ENDPOINTS' });
  }
  return endpoints;
}

function inventoryMetadata(endpoint) {
  const safeText = (value, pattern) => typeof value === 'string' && pattern.test(value) ? value : null;
  const bindings = Array.isArray(endpoint.secretEnvironmentVariables) ? endpoint.secretEnvironmentVariables : [];
  const secretEnvironmentVariables = bindings.flatMap((binding) => {
    const key = safeText(binding?.key, /^[A-Za-z_][A-Za-z0-9_]{0,254}$/);
    const secret = safeText(binding?.secret, /^[A-Za-z0-9_-]{1,255}$/);
    return key && secret ? [{ key, secret }] : [];
  });
  return {
    id: safeText(endpoint.id, /^[A-Za-z][A-Za-z0-9_-]{0,62}$/),
    region: safeText(endpoint.region, /^[a-z]+(?:-[a-z]+)+\d{1,2}$/),
    platform: ['gcfv1', 'gcfv2', 'run'].includes(endpoint.platform) ? endpoint.platform : null,
    serviceAccountEmail: safeText(endpoint.serviceAccount, /^[A-Za-z0-9._-]{1,64}@[a-z0-9.-]{1,150}\.gserviceaccount\.com$/),
    secretEnvironmentVariables,
  };
}

function readFunctionsConfig(projectDir) {
  const firebaseJson = JSON.parse(fs.readFileSync(path.join(projectDir, 'firebase.json'), 'utf8'));
  const config = functionsProjectConfig.normalizeAndValidate(firebaseJson.functions);
  if (config.length !== 1 || config[0].codebase !== functionsProjectConfig.DEFAULT_CODEBASE) {
    throw Object.assign(new Error('firebase.json must define exactly one functions codebase named "default"'), { code: 'FUNCTIONS_CONFIG_CODEBASE' });
  }
  if (!config[0].source || config[0].prefix) {
    throw Object.assign(new Error('the functions codebase must have a local source and no prefix'), { code: 'FUNCTIONS_CONFIG_SOURCE' });
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
  if (!delegate) throw Object.assign(new Error('no functions runtime was found for the functions source'), { code: 'FUNCTIONS_NO_RUNTIME' });
  await delegate.validate();
  await delegate.build();
  const firebaseConfig = await loadFirebaseConfig();
  const diagnostics = [];
  const record = (entry) => {
    const detail = sdkDiagnostic(entry?.message, projectDir);
    if (detail) {
      diagnostics.push({ ...detail, source: 'sdk' });
      if (diagnostics.length > 8) diagnostics.shift();
    }
  };
  const discoveryStartedAt = Date.now();
  firebaseLogger.on('data', record);
  let discovered;
  try {
    discovered = await delegate.discoverBuild({ firebase: firebaseConfig }, {
      ...functionsEnv.loadFirebaseEnvs(firebaseConfig, projectId),
      GOOGLE_CLOUD_QUOTA_PROJECT: projectId,
    });
  } catch (cause) {
    throw Object.assign(new Error('Failed to generate manifest from function source', { cause }), {
      code: 'FUNCTIONS_ANALYSIS_FAILED',
      analysisDiagnostics: [...debugLogDiagnostics(projectDir, discoveryStartedAt), ...diagnostics].slice(-8),
    });
  } finally {
    firebaseLogger.off('data', record);
  }
  if (!discovered || typeof discovered.endpoints !== 'object' || discovered.endpoints === null) {
    throw Object.assign(new Error('functions discovery returned no endpoint list'), { code: 'FUNCTIONS_BAD_ENDPOINTS' });
  }

  return Object.entries(discovered.endpoints).map(([id, endpoint]) => {
    const retry = functionsBuild.isEventTriggered(endpoint) ? endpoint.eventTrigger.retry ?? false : false;
    if (typeof retry !== 'boolean') {
      throw Object.assign(new Error(`${id} has a retry setting that is not a literal true or false`), { code: 'FUNCTIONS_RETRY_VALUE', functionId: id });
    }
    const regions = literalRegions(endpoint);
    if (retry && !regions) throw Object.assign(new Error(`${id} has no literal deploy region`), { code: 'FUNCTIONS_RETRY_REGIONS', functionId: id });
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

function pendingRetryPolicies(inventory, plannedFunctions) {
  const deployedByKey = new Map(inventory.map((fn) => [label(fn), fn]));
  return plannedFunctions.filter((planned) => {
    const endpoint = deployedByKey.get(label(planned));
    return !endpoint
      || !functionsBackend.isEventTriggered(endpoint)
      || endpoint.eventTrigger.retry !== true;
  }).map(label);
}

function deployFailure(deployment) {
  return Number.isInteger(deployment.status) && deployment.status > 0 ? deployment.status : 1;
}

function incompleteDeployment(deployed, localFunctions, pendingRetry = []) {
  const absent = absentFunctions(deployed, localFunctions);
  const absentKeys = new Set(absent);
  return {
    deployed,
    localFunctions,
    absent,
    pendingRetry: pendingRetry.filter((entry) => !absentKeys.has(entry)),
    recoverable: absent.every((entry) => !entry.endsWith('(no literal region)')),
  };
}

function reportIncompleteDeployment(log, result, suffix) {
  const details = [];
  if (result.absent.length > 0) {
    details.push(`${result.absent.length} function(s) are not deployed: ${result.absent.join(', ')}`);
  }
  if (result.pendingRetry.length > 0) {
    details.push(`${result.pendingRetry.length} retry policy change(s) are not active: ${result.pendingRetry.join(', ')}`);
  }
  log.error(`deploy-functions: Firebase deploy exited 0, but ${details.join('; ')}.${suffix}`);
}

async function deployRetryPolicies({
  projectId,
  plan,
  localFunctions,
  run,
  verifyCompleteInventory,
  log,
}) {
  if (plan.selectors.length === 0) return null;

  log.log('deploy-functions: accepting new retry policies with a targeted --force deploy: '
    + plan.functions.map(label).join(', '));
  const targeted = await run([
    'firebase', 'deploy', '--only', plan.selectors.join(','),
    '--project', projectId, '--non-interactive', '--force',
  ], { stdio: 'inherit' });
  if (failed(targeted)) {
    log.error(reportFailure('deploy-functions: targeted deploy of retry policies failed', targeted));
    return { code: deployFailure(targeted) };
  }

  let targetedInventory;
  try {
    targetedInventory = await verifyCompleteInventory(projectId);
  } catch (error) {
    log.error(diagnosticFailure('deploy-functions: could not verify targeted retry policies', 'post-targeted-inventory', error));
    return { code: 1 };
  }
  const pendingRetry = pendingRetryPolicies(targetedInventory, plan.functions);
  return pendingRetry.length > 0
    ? incompleteDeployment(targetedInventory, localFunctions, pendingRetry)
    : null;
}

async function deployAttempt({
  projectId,
  bootstrap,
  inventory,
  run,
  verifyCompleteInventory,
  discoverFunctions,
  readConfig,
  wait,
  log,
}) {
  const forceInitialDeploy = bootstrap === 'true' && inventory.length === 0;
  let localFunctions;
  if (forceInitialDeploy) {
    log.log('deploy-functions: bootstrap inventory is empty; creating paced groups with initial retry and cleanup policies');
    const initial = await deployInitialFunctions({
      projectId, discoverFunctions, readConfig, verifyCompleteInventory, run, wait, log,
    });
    if (initial.code !== undefined) return initial;
    localFunctions = initial.localFunctions;
  } else {
    if (bootstrap === 'true') {
      log.log(`deploy-functions: bootstrap inventory has ${inventory.length} function(s); deploying without --force`);
    }
    try {
      localFunctions = await discoverFunctions(projectId);
    } catch (error) {
      log.error(diagnosticFailure('deploy-functions: could not read the local functions', 'pre-deploy-discovery', error));
      return { code: 1 };
    }
    let plan;
    try {
      plan = planNewRetryFunctions(inventory, localFunctions, readConfig());
    } catch (error) {
      log.error(reportFailure('deploy-functions: refusing a forced deploy of retry policies', {}, error));
      return { code: 1 };
    }
    const retryResult = await deployRetryPolicies({
      projectId, plan, localFunctions, run, verifyCompleteInventory, log,
    });
    if (retryResult) return retryResult;

    const args = [...firebaseArgs('deploy', projectId), '--only', 'functions'];
    const deployment = await run(args, { stdio: 'inherit' });
    if (failed(deployment)) {
      log.error(reportFailure('deploy-functions: Firebase deploy failed', deployment));
      return { code: deployFailure(deployment) };
    }
  }

  let deployed;
  try {
    deployed = await verifyCompleteInventory(projectId);
  } catch (error) {
    log.error(diagnosticFailure('deploy-functions: could not verify the deployed functions', 'post-deploy-inventory', error));
    return { code: 1 };
  }
  return incompleteDeployment(deployed, localFunctions);
}

/** Count regional creates, and reject selectors that would expand the write budget. */
function planInitialFunctionBatches(localFunctions, config) {
  const batches = [];
  let batch = { selectors: [], filters: [], writes: 0 };
  for (const fn of [...localFunctions].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,62}$/.test(fn.id) || !fn.regions?.length) {
      throw Object.assign(new Error('every initial function must have a valid id and literal regions'), {
        code: 'FUNCTIONS_INITIAL_REGIONS', functionId: fn.id,
      });
    }
    if (fn.regions.length > INITIAL_BATCH_WRITES) {
      throw Object.assign(new Error('one function exceeds the initial regional write budget'), {
        code: 'FUNCTIONS_INITIAL_BUDGET', functionId: fn.id,
      });
    }
    const filters = parseFunctionSelector(fn.id, config);
    if (localFunctions.some((other) => other.id !== fn.id && filters.some((filter) => endpointMatchesFilter(other, filter)))) {
      throw Object.assign(new Error('an initial selector also selects another function'), {
        code: 'FUNCTIONS_INITIAL_SELECTORS', functionId: fn.id,
      });
    }
    if (batch.writes + fn.regions.length > INITIAL_BATCH_WRITES) {
      batches.push(batch);
      batch = { selectors: [], filters: [], writes: 0 };
    }
    batch.selectors.push(`functions:${fn.id}`);
    batch.filters.push(...filters);
    batch.writes += fn.regions.length;
  }
  if (batch.selectors.length) batches.push(batch);
  return batches;
}

/** A completed group precedes the quota wait, so slow creates cannot overlap the next window. */
async function deployInitialFunctions({ projectId, discoverFunctions, readConfig, verifyCompleteInventory, run, wait, log }) {
  let localFunctions;
  let batches;
  try {
    localFunctions = await discoverFunctions(projectId);
    batches = planInitialFunctionBatches(localFunctions, readConfig());
  } catch (error) {
    log.error(diagnosticFailure('deploy-functions: could not plan the initial functions', 'pre-deploy-discovery', error));
    return { code: 1 };
  }
  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    if (index > 0) {
      try {
        await wait(INITIAL_BATCH_WAIT_MS);
        const inventory = await verifyCompleteInventory(projectId);
        const existing = inventory.find((fn) => batch.filters.some((filter) => endpointMatchesFilter(fn, filter)));
        if (existing) {
          throw Object.assign(new Error('an initial forced group would change a function that already exists'), {
            code: 'FUNCTIONS_INITIAL_EXISTS', functionId: existing.id,
          });
        }
      } catch (error) {
        log.error(diagnosticFailure('deploy-functions: could not verify a safe initial group', 'initial-group-inventory', error));
        return { code: 1 };
      }
    }
    log.log(`deploy-functions: initial group ${index + 1}/${batches.length}, at most ${batch.writes} function writes`);
    const deployment = await run([
      'firebase', 'deploy', '--only', batch.selectors.join(','),
      '--project', projectId, '--non-interactive', '--force',
    ], { stdio: 'inherit' });
    if (failed(deployment)) {
      log.error(reportFailure('deploy-functions: initial function group failed', deployment));
      return { code: deployFailure(deployment) };
    }
  }
  return { localFunctions };
}

async function main({
  env = process.env,
  run = createDeployRunner(),
  verifyCompleteInventory = readCompleteInventory,
  discoverFunctions = discoverLocalFunctions,
  readConfig = () => readFunctionsConfig(PROJECT_DIR),
  wait = defaultWait,
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
    log.error(diagnosticFailure('deploy-functions: could not verify a complete functions inventory', 'pre-deploy-inventory', error));
    return 1;
  }

  // #827: Fresh-client run 43091008410 exited 0 with 17 creates missing after
  // quota exhaustion. Inventory verification and the outer workflow retry
  // catch the failure. Delete this bounded recovery when #827 records a pinned
  // Firebase CLI that completes quota-delayed creates without a fresh process.
  for (let attempt = 1; attempt <= MAX_DEPLOY_ATTEMPTS; attempt += 1) {
    const result = await deployAttempt({
      projectId, bootstrap, inventory, run, verifyCompleteInventory, discoverFunctions, readConfig, wait, log,
    });
    if (result.code !== undefined) return result.code;

    if (result.absent.length === 0 && result.pendingRetry.length === 0) {
      for (const endpoint of result.deployed) {
        log.log(`deploy-functions: inventory ${JSON.stringify(inventoryMetadata(endpoint))}`);
      }
      log.log(`deploy-functions: verified ${result.localFunctions.length} function(s) in the deployed inventory`);
      return 0;
    }
    if (!result.recoverable || attempt === MAX_DEPLOY_ATTEMPTS) {
      const suffix = result.recoverable
        ? ` Quota recovery was exhausted after ${MAX_DEPLOY_ATTEMPTS} guarded attempts.`
        : ' Automatic recovery is unsafe without a literal region for every function.';
      reportIncompleteDeployment(log, result, suffix);
      return 1;
    }

    log.log(`deploy-functions: ${result.absent.length + result.pendingRetry.length} function change(s) remain after attempt ${attempt}; `
      + `waiting ${QUOTA_RECOVERY_WAIT_MS / 1000} seconds for function write quotas before a fresh guarded attempt`);
    try {
      await wait(QUOTA_RECOVERY_WAIT_MS);
    } catch (error) {
      log.error(diagnosticFailure('deploy-functions: could not wait for quota recovery', 'quota-recovery-wait', error));
      return 1;
    }
    try {
      inventory = await verifyCompleteInventory(projectId);
    } catch (error) {
      log.error(diagnosticFailure('deploy-functions: could not verify inventory for quota recovery', 'quota-recovery-inventory', error));
      return 1;
    }
  }
  return 1;
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
  createDeployRunner,
};
