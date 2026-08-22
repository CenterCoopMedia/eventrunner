'use strict';

/**
 * The container itself cannot run in CI (no Docker, no GCP), so everything
 * about the publisher that CAN be pinned without one is pinned here: the
 * exact argv of every stage, the per-stage exit codes, the firebase.json
 * region patch, and the cmsPublishQueue status lifecycle. What remains
 * operator-verified is only the parts a test cannot reach — that the image
 * builds, that ADC on Cloud Run authenticates firebase-tools, and that the
 * hosting release lands (docs/DEPLOY_RUNBOOK.md §9).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  main,
  buildPlan,
  patchHostingRegion,
  resolvePublisherEnv,
  publisherStatusPatch,
  writeQueueStatus,
  EXIT,
} = require('./publish-site.cjs');

const ENV = {
  EVENT_SLUG: 'demo-event',
  EVENT_FIREBASE_PROJECT_ID: 'demo-project',
  EVENT_FIREBASE_REGION: 'us-east4',
  EVENT_HOSTING_SITE: 'demo-site',
  EVENT_PUBLIC_URL: 'https://summit.example.org',
  EVENT_STORAGE_BUCKET: 'demo-project.appspot.com',
  EVENT_ALLOWED_ORIGINS: 'https://summit.example.org',
  EVENT_EMAIL_PROVIDER: 'console',
  EVENT_TICKETING_PROVIDER: 'none',
  EVENT_OPERATOR_NOTIFIER: 'none',
  VITE_FIREBASE_API_KEY: 'AIzaFake',
  VITE_FIREBASE_AUTH_DOMAIN: 'demo-project.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'demo-project',
  VITE_FIREBASE_STORAGE_BUCKET: 'demo-project.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '1234567890',
  VITE_FIREBASE_APP_ID: '1:1234567890:web:abc',
  VITE_FIREBASE_MEASUREMENT_ID: 'G-FAKE',
  VITE_EVENT_PUBLIC_URL: 'https://summit.example.org',
};

const NOW = 1_750_000_000_000;
const quiet = { log() {}, error() {} };

/** A firestore-shaped double recording merge-sets on cmsPublishQueue rows. */
function fakeDb({ throwOnSet = false } = {}) {
  const sets = [];
  return {
    sets,
    collection(name) {
      return {
        doc(id) {
          return {
            async set(data, options) {
              if (throwOnSet) throw new Error('permission denied');
              sets.push({ path: `${name}/${id}`, data, options });
            },
          };
        },
      };
    },
  };
}

/**
 * Run main() with every side effect stubbed. `failAt` is a stage name whose
 * FIRST step fails.
 */
async function run({ env = ENV, argv = [], failAt = null, db = null, spawnError = false } = {}) {
  const ran = [];
  const written = [];
  const code = await main({
    env,
    argv,
    log: quiet,
    now: () => NOW,
    getDb: db ? () => db : undefined,
    readFirebaseJson: () => ({
      hosting: {
        rewrites: [
          { source: '/updates/**', function: { functionId: 'updatesMeta', region: 'us-central1' } },
          { source: '**', destination: '/index.html' },
        ],
      },
    }),
    writeFirebaseJson: (config) => written.push(config),
    runStep: (step) => {
      ran.push(step);
      if (step.stage === failAt) {
        return spawnError
          ? { status: 1, error: new Error('spawn ENOENT') }
          : { status: 9 };
      }
      return { status: 0 };
    },
  });
  return { code, ran, written };
}

// --- configuration ------------------------------------------------------------

test('an invalid environment exits 2 and runs nothing', async () => {
  const { EVENT_HOSTING_SITE, ...incomplete } = ENV;
  const { code, ran } = await run({ env: incomplete });
  assert.equal(code, EXIT.CONFIG);
  assert.deepEqual(ran, []);
});

test('resolvePublisherEnv names every missing key, not just the first', () => {
  const { EVENT_HOSTING_SITE, VITE_FIREBASE_APP_ID, ...incomplete } = ENV;
  const result = resolvePublisherEnv(incomplete);
  assert.equal(result.ok, false);
  assert.match(result.message, /EVENT_HOSTING_SITE/);
  assert.match(result.message, /VITE_FIREBASE_APP_ID/);
});

test('an unknown flag exits 2 rather than running a publish the operator did not ask for', async () => {
  const { code, ran } = await run({ argv: ['--dryrun'] });
  assert.equal(code, EXIT.CONFIG);
  assert.deepEqual(ran, []);
});

test('--dry-run prints the plan and executes nothing', async () => {
  const { code, ran, written } = await run({ argv: ['--dry-run'] });
  assert.equal(code, EXIT.OK);
  assert.deepEqual(ran, []);
  assert.deepEqual(written, []);
});

// --- the plan -----------------------------------------------------------------

test('the plan is generate, build, then hosting deploy — in that order', () => {
  const plan = buildPlan({ env: ENV, generatedDir: '/scratch/generated' });
  assert.deepEqual(plan.map((s) => s.stage), ['generate', 'build', 'deploy', 'deploy']);
});

test('generation writes out of tree and reads this project only', () => {
  const [generate] = buildPlan({ env: ENV, generatedDir: '/scratch/generated' });
  assert.match(generate.args[0], /scripts[\\/]generate-content\.cjs$/);
  assert.deepEqual(generate.args.slice(1), ['--out', '/scratch/generated']);
  assert.equal(generate.env.EVENT_FIREBASE_PROJECT_ID, 'demo-project');
  // --demo would publish the synthetic fixture over a client's real site.
  assert.ok(!generate.args.includes('--demo'));
});

test('the build stage passes the same VITE_ keys as deploy-client.yml', () => {
  const build = buildPlan({ env: ENV, generatedDir: '/scratch/generated' })[1];
  assert.deepEqual(build.args, ['run', 'build', '-w', 'apps/web']);
  assert.equal(build.env.GENERATED_DIR, '/scratch/generated');
  assert.equal(build.env.VITE_EVENT_PUBLIC_URL, ENV.EVENT_PUBLIC_URL);
  // The bundle's functions origin is built from the region; an unset value
  // here silently calls us-central1.
  assert.equal(build.env.VITE_FIREBASE_REGION, 'us-east4');
  for (const key of Object.keys(ENV).filter((k) => k.startsWith('VITE_FIREBASE_'))) {
    assert.equal(build.env[key], ENV[key], `${key} must reach the build`);
  }
});

test('the deploy stage targets this client site and never prompts', () => {
  const [, , target, deploy] = buildPlan({ env: ENV, generatedDir: '/scratch/generated' });
  assert.deepEqual(target.args.slice(1), [
    'target:apply', 'hosting', 'site', 'demo-site', '--project', 'demo-project',
  ]);
  assert.deepEqual(deploy.args.slice(1), [
    'deploy', '--only', 'hosting:site', '--project', 'demo-project', '--non-interactive',
  ]);
  // Hosting only: the job must never redeploy functions or rules.
  assert.ok(!deploy.args.includes('functions'));
});

// --- exit codes ---------------------------------------------------------------

test('each stage failure maps to its own exit code and stops the plan', async () => {
  const cases = [
    ['generate', EXIT.GENERATE, 1],
    ['build', EXIT.BUILD, 2],
    ['deploy', EXIT.DEPLOY, 3],
  ];
  for (const [failAt, expected, stepsRun] of cases) {
    const { code, ran } = await run({ failAt });
    assert.equal(code, expected, `failure at ${failAt}`);
    assert.equal(ran.length, stepsRun, `${failAt} must stop the plan`);
  }
});

test('a step that cannot be spawned is a stage failure, not an unexpected error', async () => {
  const { code } = await run({ failAt: 'build', spawnError: true });
  assert.equal(code, EXIT.BUILD);
});

test('a full run exits 0', async () => {
  const { code, ran } = await run();
  assert.equal(code, EXIT.OK);
  assert.equal(ran.length, 4);
});

// --- firebase.json region patch -----------------------------------------------

test('the hosting region patch is applied before the deploy stages run', async () => {
  const { written } = await run();
  assert.equal(written.length, 1);
  assert.equal(written[0].hosting.rewrites[0].function.region, 'us-east4');
  assert.equal(written[0].hosting.rewrites[1].destination, '/index.html');
});

test('patchHostingRegion leaves non-function rewrites alone and does not mutate its input', () => {
  const config = {
    hosting: {
      rewrites: [
        { source: '/updates/**', function: { functionId: 'updatesMeta', region: 'us-central1' } },
        { source: '**', destination: '/index.html' },
      ],
    },
  };
  const patched = patchHostingRegion(config, 'europe-west1');
  assert.equal(patched.hosting.rewrites[0].function.region, 'europe-west1');
  assert.equal(config.hosting.rewrites[0].function.region, 'us-central1');
  assert.deepEqual(patched.hosting.rewrites[1], { source: '**', destination: '/index.html' });
});

test('patchHostingRegion is total on a config with no hosting rewrites', () => {
  assert.deepEqual(patchHostingRegion({}, 'us-east4'), {});
  assert.deepEqual(patchHostingRegion({ hosting: {} }, 'us-east4'), { hosting: {} });
});

// --- cmsPublishQueue status ---------------------------------------------------

test('the queue row goes running then done over one successful execution', async () => {
  const db = fakeDb();
  const { code } = await run({ db, env: { ...ENV, PUBLISH_QUEUE_ID: 'q1' } });
  assert.equal(code, EXIT.OK);
  assert.deepEqual(db.sets.map((s) => s.path), ['cmsPublishQueue/q1', 'cmsPublishQueue/q1']);
  assert.equal(db.sets[0].data.publisher.status, 'running');
  assert.equal(db.sets[1].data.publisher.status, 'done');
  // Merge-set, so cmsPublish's own `status` on the row is untouched.
  assert.deepEqual(db.sets[1].options, { merge: true });
  assert.equal(db.sets[1].data.status, undefined);
});

test('a failed execution records the failing stage on the row', async () => {
  const db = fakeDb();
  const { code } = await run({ db, failAt: 'build', env: { ...ENV, PUBLISH_QUEUE_ID: 'q1' } });
  assert.equal(code, EXIT.BUILD);
  const terminal = db.sets.at(-1).data.publisher;
  assert.equal(terminal.status, 'failed');
  assert.equal(terminal.failedStage, 'build');
  assert.match(terminal.error, /exited 9/);
});

test('no PUBLISH_QUEUE_ID means no status writes — a scheduled or manual run still publishes', async () => {
  const db = fakeDb();
  const { code } = await run({ db });
  assert.equal(code, EXIT.OK);
  assert.deepEqual(db.sets, []);
});

test('a status write that throws never changes the exit code', async () => {
  const db = fakeDb({ throwOnSet: true });
  const { code } = await run({ db, env: { ...ENV, PUBLISH_QUEUE_ID: 'q1' } });
  assert.equal(code, EXIT.OK);
});

test('writeQueueStatus is a no-op without a db or a queue id', async () => {
  assert.equal(await writeQueueStatus({ db: null, queueId: 'q1', patch: {}, log: quiet }), false);
  assert.equal(await writeQueueStatus({ db: fakeDb(), queueId: null, patch: {}, log: quiet }), false);
});

test('the terminal patch is scoped under `publisher` and caps the error text', () => {
  const ok = publisherStatusPatch({ ok: true, at: new Date(NOW) });
  assert.deepEqual(Object.keys(ok), ['publisher']);
  assert.equal(ok.publisher.status, 'done');
  assert.equal(ok.publisher.error, undefined);

  const failed = publisherStatusPatch({
    ok: false, stage: 'deploy', error: 'x'.repeat(2000), at: new Date(NOW),
  });
  assert.equal(failed.publisher.status, 'failed');
  assert.equal(failed.publisher.error.length, 500);
});
