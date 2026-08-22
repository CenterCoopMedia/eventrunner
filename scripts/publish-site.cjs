#!/usr/bin/env node
'use strict';

/**
 * Site publisher entrypoint — the command the `site-publisher` Cloud Run
 * job runs (spec §8.4 phase 5, issue #36).
 *
 * Three steps, in the order §8.4 names them:
 *
 *   1. `generate-content.cjs --out <dir>`  the PUBLISHED collections of the
 *                                          project this job runs in, read
 *                                          through the Admin SDK.
 *   2. `npm run build -w apps/web`         the bundle, against that snapshot
 *                                          and this client's VITE_* values.
 *   3. `firebase deploy --only hosting`    under the job's own service
 *                                          account (ADC from the Cloud Run
 *                                          metadata server). No cross-project
 *                                          credential exists anywhere in
 *                                          this path, and no GitHub token:
 *                                          replacing `repository_dispatch`
 *                                          is the entire point (§8.4).
 *
 * Why a script in `scripts/` rather than a file inside `publisher/`: this is
 * a deploy-time node script exactly like `generate-content.cjs`,
 * `validate-deploy-env.cjs`, and `smoke-test.cjs`, and putting it here means
 * the ordinary `npm test` glob covers it. `publisher/Dockerfile` is a
 * packaging of this repository; the logic under test is this file.
 *
 * Idempotent by construction: every step overwrites its output rather than
 * appending, `--out` is a scratch directory, and a hosting deploy replaces
 * the release wholesale. Re-running after any failure is always safe, which
 * is why `--max-retries` on the job can be raised without a second thought.
 *
 * Exit codes are per-stage, so an operator reading `gcloud run jobs
 * executions describe` knows which stage failed without opening the log:
 *
 *   0  published
 *   1  unexpected error (a bug here, not a stage failure)
 *   2  invalid configuration — nothing ran
 *   3  snapshot generation failed
 *   4  web build failed
 *   5  hosting deploy failed
 *
 * When PUBLISH_QUEUE_ID is set (cmsPublish passes it as a per-execution
 * override), the terminal outcome is written back to that `cmsPublishQueue`
 * row under `publisher` (§8.4: "cmsPublishQueue keeps its status field").
 * Failing to write the row never changes the exit code — the deploy either
 * happened or it did not, and a status write cannot alter that.
 *
 * Usage (inside the container; the flags exist for local dry runs):
 *   node scripts/publish-site.cjs
 *   node scripts/publish-site.cjs --dry-run
 *   node scripts/publish-site.cjs --out /tmp/generated
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { parseArgv, unknownFlags } = require('./lib/args.cjs');
const { validateDeployEnv } = require('../packages/shared/src/config/deploy.cjs');

const ROOT = path.resolve(__dirname, '..');
const FLAGS = ['out', 'dry-run', 'help'];

const EXIT = Object.freeze({
  OK: 0,
  UNEXPECTED: 1,
  CONFIG: 2,
  GENERATE: 3,
  BUILD: 4,
  DEPLOY: 5,
});

/** Stage name → exit code, for the status row and the log line. */
const STAGE_EXIT = Object.freeze({
  generate: EXIT.GENERATE,
  build: EXIT.BUILD,
  deploy: EXIT.DEPLOY,
});

function usage() {
  return [
    'Usage: node scripts/publish-site.cjs [--out <dir>] [--dry-run]',
    '',
    '  --out <dir>    scratch directory for the generated snapshot',
    '                 (default: <tmp>/run-of-show-publisher)',
    '  --dry-run      print the plan and exit 0 without running anything',
  ].join('\n');
}

/**
 * Validate the job's environment. The job is handed the same per-client
 * variables as deploy-client.yml's `build` step (the maintainer decision on
 * issue #36: publisher env is per-client env, with no subdomain coupling),
 * so the same Tier A validator applies — one definition of "configured",
 * not a second one that can drift.
 *
 * @param {Record<string, string|undefined>} env
 * @returns {{ ok: true, resolved: Record<string, string> } |
 *            { ok: false, message: string }}
 */
function resolvePublisherEnv(env) {
  const result = validateDeployEnv(env);
  if (!result.ok) {
    const lines = [];
    if (result.missing.length > 0) {
      lines.push(`Missing required variable(s): ${result.missing.join(', ')}`);
    }
    lines.push(...result.errors.map((e) => `Invalid: ${e}`));
    return { ok: false, message: lines.join('\n') };
  }
  return { ok: true, resolved: result.resolved };
}

/**
 * The ordered plan. Pure: no spawn, no filesystem, so the exact argv of
 * every stage is assertable in a unit test even though the container is
 * not runnable here.
 *
 * @param {{ env: Record<string, string>, generatedDir: string }} args
 * @returns {Array<{ stage: string, label: string, command: string,
 *                   args: string[], env: Record<string, string> }>}
 */
function buildPlan({ env, generatedDir }) {
  const projectId = env.EVENT_FIREBASE_PROJECT_ID;
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  return [
    {
      stage: 'generate',
      label: 'Generate the content snapshot from the published collections',
      command: process.execPath,
      args: [path.join(ROOT, 'scripts', 'generate-content.cjs'), '--out', generatedDir],
      // --out keeps this out of apps/web/src/generated (§8.6). The rule is
      // about a public repo's working tree, and this container is built
      // from that repo, so it holds here for the same reason.
      env: {
        EVENT_FIREBASE_PROJECT_ID: projectId,
        EVENT_STORAGE_BUCKET: env.EVENT_STORAGE_BUCKET,
      },
    },
    {
      stage: 'build',
      label: 'Build the web app against the generated snapshot',
      command: npm,
      args: ['run', 'build', '-w', 'apps/web'],
      // Mirrors deploy-client.yml's `build` step exactly. A key that is
      // set there and not here ships a bundle that differs from the one
      // CI produced, which is the hardest class of bug to see.
      env: {
        GENERATED_DIR: generatedDir,
        VITE_FIREBASE_API_KEY: env.VITE_FIREBASE_API_KEY,
        VITE_FIREBASE_AUTH_DOMAIN: env.VITE_FIREBASE_AUTH_DOMAIN,
        VITE_FIREBASE_PROJECT_ID: env.VITE_FIREBASE_PROJECT_ID,
        VITE_FIREBASE_STORAGE_BUCKET: env.VITE_FIREBASE_STORAGE_BUCKET,
        VITE_FIREBASE_MESSAGING_SENDER_ID: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
        VITE_FIREBASE_APP_ID: env.VITE_FIREBASE_APP_ID,
        VITE_FIREBASE_MEASUREMENT_ID: env.VITE_FIREBASE_MEASUREMENT_ID,
        VITE_FIREBASE_REGION: env.EVENT_FIREBASE_REGION,
        VITE_FIREBASE_APP_CHECK_SITE_KEY: env.VITE_FIREBASE_APP_CHECK_SITE_KEY,
        VITE_ENABLE_CLIENT_ERROR_REPORTING: env.VITE_ENABLE_CLIENT_ERROR_REPORTING,
        VITE_EVENT_PUBLIC_URL: env.EVENT_PUBLIC_URL,
      },
    },
    {
      stage: 'deploy',
      label: 'Map the hosting target for this project',
      command: npx,
      args: [
        'firebase', 'target:apply', 'hosting', 'site', env.EVENT_HOSTING_SITE,
        '--project', projectId,
      ],
      env: {},
    },
    {
      stage: 'deploy',
      label: 'Deploy hosting',
      command: npx,
      args: [
        'firebase', 'deploy',
        '--only', 'hosting:site',
        '--project', projectId,
        '--non-interactive',
      ],
      env: {},
    },
  ];
}

/**
 * Point every `updatesMeta` hosting rewrite at this project's region.
 *
 * The same patch deploy-client.yml applies with jq, for the same reason:
 * `firebase.json` is one committed file shared by every client's deploy,
 * while the function's region is per-client. The bare-string rewrite form
 * silently defaults to us-central1, so a client outside that region would
 * have /updates/** routed at a backend that does not exist. Pure, so the
 * rule is testable without a deploy.
 *
 * Every object-form function rewrite is patched, not just `updatesMeta`:
 * one client deploys all of its functions to one region, so a rewrite that
 * appears later needs the same treatment and must not have to remember to
 * add itself here.
 *
 * @param {object} config parsed firebase.json
 * @param {string} region
 * @returns {object} a new config; the input is not mutated
 */
function patchHostingRegion(config, region) {
  const rewrites = config?.hosting?.rewrites;
  if (!Array.isArray(rewrites)) return config;
  return {
    ...config,
    hosting: {
      ...config.hosting,
      rewrites: rewrites.map((rewrite) => (
        rewrite && typeof rewrite.function === 'object' && rewrite.function !== null
          ? { ...rewrite, function: { ...rewrite.function, region } }
          : rewrite
      )),
    },
  };
}

/**
 * Terminal patch for the `cmsPublishQueue` row, under `publisher` so the
 * publish's own `status` (written by cmsPublish) is never overwritten by
 * the job. §8.4 keeps one row per publish; this is the deploy half of it.
 *
 * @param {{ ok: boolean, stage?: string, error?: string, at: Date }} outcome
 * @returns {object}
 */
function publisherStatusPatch({ ok, stage, error, at }) {
  return {
    publisher: {
      status: ok ? 'done' : 'failed',
      finishedAt: at,
      ...(ok ? {} : { failedStage: stage || 'unknown', error: String(error || '').slice(0, 500) }),
    },
  };
}

/**
 * Write the terminal status back to the queue row. Never throws and never
 * influences the exit code: the hosting deploy either happened or it did
 * not, and a failed status write cannot change that. It is logged loudly,
 * because a row stuck at `running` is what the maintenance sweep's
 * job-level timeout then has to clean up (§8.4).
 *
 * @param {{ db: object|null, queueId: string|null, patch: object,
 *           log?: Console }} args
 * @returns {Promise<boolean>} true when the row was written
 */
async function writeQueueStatus({ db, queueId, patch, log = console }) {
  if (!db || !queueId) return false;
  try {
    await db.collection('cmsPublishQueue').doc(queueId).set(patch, { merge: true });
    return true;
  } catch (err) {
    log.error(
      `publish-site: could not write publisher status to cmsPublishQueue/${queueId} ` +
      `(the maintenance sweep will time the row out): ${err?.message || err}`,
    );
    return false;
  }
}

/**
 * Run the plan.
 *
 * @param {{
 *   env: Record<string, string>,
 *   argv?: string[],
 *   runStep?: (step: object, ctx: { env: Record<string,string> }) => { status: number|null, error?: Error },
 *   readFirebaseJson?: () => object,
 *   writeFirebaseJson?: (config: object) => void,
 *   getDb?: () => object,
 *   now?: () => number,
 *   log?: Console,
 * }} deps
 * @returns {Promise<number>} process exit code
 */
async function main({
  env = process.env,
  argv = [],
  runStep,
  readFirebaseJson,
  writeFirebaseJson,
  getDb,
  now = Date.now,
  log = console,
} = {}) {
  const parsed = parseArgv(argv, { withValue: ['out'] });
  const unknown = unknownFlags(parsed, FLAGS);
  if (unknown.length > 0) {
    log.error(`publish-site: unknown flag(s): ${unknown.map((f) => `--${f}`).join(', ')}\n\n${usage()}`);
    return EXIT.CONFIG;
  }
  if (parsed.help) {
    log.log(usage());
    return EXIT.OK;
  }

  const config = resolvePublisherEnv(env);
  if (!config.ok) {
    log.error(`publish-site: the job environment is invalid, nothing ran.\n${config.message}`);
    return EXIT.CONFIG;
  }
  const resolved = config.resolved;
  const queueId = typeof env.PUBLISH_QUEUE_ID === 'string' && env.PUBLISH_QUEUE_ID.trim()
    ? env.PUBLISH_QUEUE_ID.trim()
    : null;
  const generatedDir = typeof parsed.out === 'string' && parsed.out
    ? path.resolve(parsed.out)
    : path.join(os.tmpdir(), 'run-of-show-publisher', 'generated');

  const plan = buildPlan({ env: resolved, generatedDir });
  if (parsed['dry-run']) {
    log.log('publish-site: plan (dry run, nothing executed)');
    for (const step of plan) {
      log.log(`  [${step.stage}] ${step.label}: ${step.command} ${step.args.join(' ')}`);
    }
    return EXIT.OK;
  }

  // One line an operator can grep for in Cloud Logging to tie an execution
  // to the publish that caused it.
  log.log(`publish-site: start project=${resolved.EVENT_FIREBASE_PROJECT_ID} ` +
    `site=${resolved.EVENT_HOSTING_SITE} queueId=${queueId || '-'}`);

  const db = getDb ? getDb() : null;
  await writeQueueStatus({
    db,
    queueId,
    patch: { publisher: { status: 'running', startedAt: new Date(now()) } },
    log,
  });

  const finish = async (code, stage, error) => {
    const ok = code === EXIT.OK;
    await writeQueueStatus({
      db,
      queueId,
      patch: publisherStatusPatch({ ok, stage, error, at: new Date(now()) }),
      log,
    });
    if (ok) log.log('publish-site: done — hosting refreshed');
    else log.error(`publish-site: failed at stage "${stage}" (exit ${code}): ${error}`);
    return code;
  };

  // The region patch happens once, before the deploy stages read
  // firebase.json. Never committed — the container's copy is discarded
  // with the execution.
  try {
    const firebaseJson = readFirebaseJson
      ? readFirebaseJson()
      : JSON.parse(fs.readFileSync(path.join(ROOT, 'firebase.json'), 'utf8'));
    const patched = patchHostingRegion(firebaseJson, resolved.EVENT_FIREBASE_REGION);
    if (writeFirebaseJson) writeFirebaseJson(patched);
    else fs.writeFileSync(path.join(ROOT, 'firebase.json'), `${JSON.stringify(patched, null, 2)}\n`);
  } catch (err) {
    return finish(EXIT.CONFIG, 'configure', err?.message || err);
  }

  const exec = runStep || defaultRunStep;
  for (const step of plan) {
    log.log(`publish-site: [${step.stage}] ${step.label}`);
    const result = exec(step, { env: resolved });
    if (result.status !== 0) {
      const reason = result.error
        ? result.error.message
        : `${step.command} exited ${result.status === null ? 'on a signal' : result.status}`;
      return finish(STAGE_EXIT[step.stage] || EXIT.UNEXPECTED, step.stage, reason);
    }
  }
  return finish(EXIT.OK);
}

/**
 * Default executor: inherit stdio so every underlying tool's output lands
 * in Cloud Logging unfiltered — a publisher failure is triaged from the
 * execution log, so swallowing vite's or firebase's output would defeat
 * the point.
 */
function defaultRunStep(step, { env }) {
  const result = spawnSync(step.command, step.args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  return { status: result.error ? 1 : result.status, error: result.error };
}

if (require.main === module) {
  main({
    argv: process.argv.slice(2),
    // Same credential resolution as every other operator script: ADC,
    // which on Cloud Run is the job's own service account from the
    // metadata server.
    getDb: () => require('./lib/firebase-init.cjs').initFirebase().db,
  })
    .then((code) => { process.exitCode = code; })
    .catch((err) => {
      console.error(`publish-site: ${err?.stack || err}`);
      process.exitCode = EXIT.UNEXPECTED;
    });
}

module.exports = {
  main,
  buildPlan,
  patchHostingRegion,
  resolvePublisherEnv,
  publisherStatusPatch,
  writeQueueStatus,
  EXIT,
  internals: { usage, defaultRunStep, STAGE_EXIT, FLAGS },
};
