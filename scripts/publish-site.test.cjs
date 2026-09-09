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
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  main,
  buildPlan,
  patchHostingRegion,
  resolvePublisherEnv,
  publisherStatusPatch,
  writeQueueStatus,
  readSiteDocs,
  generateSiteFiles,
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
 * FIRST step fails — 'sitemap' fails the site-files write rather than a
 * spawned step. `order` (when passed) collects the stage name of every
 * spawned step AND the site-files write, in the order main() ran them.
 */
async function run({
  env = ENV, argv = [], failAt = null, db = null, spawnError = false,
  generateSiteFiles, order = null,
} = {}) {
  const ran = [];
  const written = [];
  const siteFilesCalls = [];
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
      if (order) order.push(step.stage);
      if (step.stage === failAt) {
        return spawnError
          ? { status: 1, error: new Error('spawn ENOENT') }
          : { status: 9 };
      }
      return { status: 0 };
    },
    generateSiteFiles: generateSiteFiles || (async (args) => {
      siteFilesCalls.push(args);
      if (order) order.push('sitemap');
      if (failAt === 'sitemap') throw new Error('sitemap write failed');
    }),
  });
  return { code, ran, written, siteFilesCalls };
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

test('--dry-run also names the sitemap/robots/manifest write, in its real place after the build', async () => {
  const lines = [];
  const code = await main({
    env: ENV, argv: ['--dry-run'], now: () => NOW,
    log: { log: (line) => lines.push(line), error: (line) => lines.push(line) },
  });
  assert.equal(code, EXIT.OK);
  const buildIndex = lines.findIndex((l) => l.includes('[build]'));
  const sitemapIndex = lines.findIndex((l) => l.includes('[sitemap]'));
  const deployIndex = lines.findIndex((l) => l.includes('[deploy]'));
  assert.ok(buildIndex >= 0 && sitemapIndex > buildIndex && deployIndex > sitemapIndex);
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
    // 'sitemap' is not a spawned step (see the "site files" section below):
    // both spawned steps before it still ran, and neither deploy step did.
    ['sitemap', EXIT.SITEMAP, 2],
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

// --- site files (sitemap.xml, robots.txt, manifest) ---------------------------

test('the site files are written after the build stage and before the hosting deploy steps', async () => {
  const order = [];
  const { code } = await run({ order });
  assert.equal(code, EXIT.OK);
  assert.deepEqual(order, ['generate', 'build', 'sitemap', 'deploy', 'deploy']);
});

test('generateSiteFiles is called with this project\'s db, its public URL, and the hosting dist directory', async () => {
  const db = fakeDb();
  const { siteFilesCalls } = await run({ db });
  assert.equal(siteFilesCalls.length, 1);
  assert.equal(siteFilesCalls[0].db, db);
  assert.equal(siteFilesCalls[0].publicUrl, ENV.EVENT_PUBLIC_URL);
  assert.match(siteFilesCalls[0].distDir, /apps[\\/]web[\\/]dist$/);
});

test('a site-files failure stops the plan before the hosting deploy, at its own exit code', async () => {
  const { code, ran } = await run({ failAt: 'sitemap' });
  assert.equal(code, EXIT.SITEMAP);
  assert.equal(ran.length, 2);
});

test('a site-files write that throws is reported with its own message, like every other stage', async () => {
  const { code } = await run({
    generateSiteFiles: async () => { throw new Error('config/theme.colors.primary is not a string'); },
  });
  assert.equal(code, EXIT.SITEMAP);
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

// --- readSiteDocs / generateSiteFiles (scripts/lib/site-manifest.cjs) ---------

/** Docs as `{ id, data() }` pairs, the shape every fake collection needs. */
function asFakeDocs(records) {
  return records.map((r) => {
    const { id, ...rest } = r;
    return { id, data: () => rest };
  });
}

/**
 * A firestore-shaped double for readSiteDocs: config docs, cmsPages
 * (unfiltered), and cmsSchedule/speakers_public/cmsUpdates — the latter two
 * collections support the one `.where('visible', '==', true)` query
 * `readSiteDocs` actually runs.
 */
function fakeSiteDb({
  event, features, theme, pages, sessions = [], speakers = [], updates = [],
}) {
  const configDocs = { event, features, theme };
  const filterableCollection = (records) => ({
    async get() { return { docs: asFakeDocs(records) }; },
    where(field, op, value) {
      if (field !== 'visible' || op !== '==') throw new Error(`fakeSiteDb: unexpected where(${field}, ${op})`);
      return { async get() { return { docs: asFakeDocs(records.filter((r) => r.visible === value)) }; } };
    },
  });
  return {
    collection(name) {
      if (name === 'config') return { doc: (id) => ({ __configId: id }) };
      if (name === 'cmsPages') return { async get() { return { docs: asFakeDocs(pages) }; } };
      if (name === 'cmsSchedule') return filterableCollection(sessions);
      if (name === 'cmsUpdates') return filterableCollection(updates);
      if (name === 'speakers_public') return { async get() { return { docs: asFakeDocs(speakers) }; } };
      throw new Error(`fakeSiteDb: unexpected collection ${name}`);
    },
    async getAll(...refs) {
      return refs.map((ref) => {
        const value = configDocs[ref.__configId];
        return { exists: value != null, data: () => value };
      });
    },
  };
}

const SITE_DOCS = {
  event: { name: 'Harborlight Summit', shortName: 'HARBOR' },
  features: { schedule: true, speakers: true, sponsors: true, attendeeDirectory: true, updates: false },
  theme: {},
  pages: [
    { id: 'home', path: '/', order: 0, visible: true, systemPage: true },
    { id: 'travel', path: '/travel', order: 4, visible: true, systemPage: false },
    // Off by default (features.updates is false above).
    { id: 'updates', path: '/updates', order: 11, visible: true, systemPage: true },
    // Hidden.
    { id: 'secret', path: '/secret', order: 20, visible: false, systemPage: false },
  ],
  sessions: [
    { id: 'keynote', visible: true },
    { id: 'draft-session', visible: false },
  ],
  speakers: [{ slug: 'rae-okonkwo' }],
  updates: [{ id: 'week-one', visible: true }],
};

test('readSiteDocs reads cmsPages unfiltered, including a hidden page', async () => {
  const db = fakeSiteDb(SITE_DOCS);
  const docs = await readSiteDocs({ db });
  assert.equal(docs.event.name, 'Harborlight Summit');
  assert.equal(docs.features.updates, false);
  assert.ok(docs.pages.some((p) => p.id === 'secret' && p.visible === false));
});

test('readSiteDocs filters cmsSchedule and cmsUpdates to visible === true, but not speakers_public', () => {
  return (async () => {
    const db = fakeSiteDb(SITE_DOCS);
    const docs = await readSiteDocs({ db });
    assert.deepEqual(docs.sessions.map((s) => s.id), ['keynote']);
    assert.deepEqual(docs.speakers.map((s) => s.slug), ['rae-okonkwo']);
    // updates is off in SITE_DOCS.features, but readSiteDocs itself applies
    // no feature gate — that is buildSiteArtifacts's job.
    assert.deepEqual(docs.updates.map((u) => u.id), ['week-one']);
  })();
});

test('readSiteDocs refuses to run against a project with no config/event doc', async () => {
  const db = fakeSiteDb({ ...SITE_DOCS, event: null });
  await assert.rejects(readSiteDocs({ db }), /config\/event is missing/);
});

test('generateSiteFiles writes all three files, and the sitemap and robots agree with each other', async () => {
  const db = fakeSiteDb(SITE_DOCS);
  const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-site-test-'));
  try {
    await generateSiteFiles({ db, distDir, publicUrl: 'https://example.org', log: quiet });

    const sitemap = fs.readFileSync(path.join(distDir, 'sitemap.xml'), 'utf8');
    assert.match(sitemap, /<loc>https:\/\/example\.org\/travel<\/loc>/);
    assert.match(sitemap, /<loc>https:\/\/example\.org\/schedule\/keynote<\/loc>/);
    assert.match(sitemap, /<loc>https:\/\/example\.org\/speakers\/rae-okonkwo<\/loc>/);
    assert.doesNotMatch(sitemap, /\/schedule\/draft-session</);
    // features.updates is off in SITE_DOCS, so no update route at all,
    // even though a published cmsUpdates doc exists.
    assert.doesNotMatch(sitemap, /\/updates\/week-one</);
    assert.doesNotMatch(sitemap, /\/updates</);
    assert.doesNotMatch(sitemap, /\/secret</);

    const robots = fs.readFileSync(path.join(distDir, 'robots.txt'), 'utf8');
    assert.match(robots, /^Disallow: \/updates\$$/m);
    assert.match(robots, /^Disallow: \/updates\/\*$/m);
    assert.match(robots, /^Disallow: \/secret\$$/m);
    assert.match(robots, /^Sitemap: https:\/\/example\.org\/sitemap\.xml$/m);

    const manifest = JSON.parse(fs.readFileSync(path.join(distDir, 'manifest.webmanifest'), 'utf8'));
    assert.equal(manifest.name, 'Harborlight Summit');
    assert.equal(manifest.short_name, 'HARBOR');
  } finally {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
});

test('generateSiteFiles creates the dist directory when it does not exist yet', async () => {
  const db = fakeSiteDb(SITE_DOCS);
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-site-test-'));
  const distDir = path.join(parent, 'dist');
  try {
    await generateSiteFiles({ db, distDir, publicUrl: 'https://example.org', log: quiet });
    assert.ok(fs.existsSync(path.join(distDir, 'sitemap.xml')));
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('generateSiteFiles refuses to run without a db handle', async () => {
  await assert.rejects(
    generateSiteFiles({ db: null, distDir: '/tmp/x', publicUrl: 'https://example.org', log: quiet }),
    /no Firestore handle/,
  );
});
