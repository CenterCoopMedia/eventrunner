'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Normalized to LF: every marker and pattern below matches on literal
// `\n`, and a CRLF checkout (the Windows git default) would otherwise
// leave a stray `\r` right before each `\n`, making every indexOf/regex
// match here miss (issue #102).
// Normalized to LF: every marker and pattern below matches on literal
// `\n`, and a CRLF checkout (the Windows git default) would otherwise
// leave a stray `\r` right before each `\n`, making every indexOf/regex
// match here miss (issue #102).
const workflow = fs
  .readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'deploy-client.yml'), 'utf8')
  .replace(/\r\n/g, '\n');

function step(name) {
  const marker = `      - name: ${name}\n`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `missing workflow step: ${name}`);
  const after = workflow.slice(start + marker.length);
  const next = after.search(/\n {6}- (?:name:|uses:|run:)/);
  return next === -1 ? after : after.slice(0, next);
}

function job(name) {
  const marker = `\n  ${name}:\n`;
  const start = workflow.indexOf(marker, workflow.indexOf('jobs:\n'));
  assert.notEqual(start, -1, `missing workflow job: ${name}`);
  const after = workflow.slice(start + marker.length);
  const next = after.search(/\n {2}[a-z0-9-]+:\n/);
  return next === -1 ? after : after.slice(0, next);
}

// A CRLF checkout of this repo (the Windows git default, core.autocrlf=true)
// puts `\r\n` at the end of every line in deploy-client.yml. Every marker
// and pattern above matches literal `\n` only, so without normalizing the
// file first, `step()` and `job()` would fail to find anything on such a
// checkout (issue #102). Simulate that here without depending on the
// checkout's actual line endings.
test('workflow lookups tolerate a CRLF checkout', () => {
  const crlfWorkflow = workflow.replace(/\n/g, '\r\n');
  const normalized = crlfWorkflow.replace(/\r\n/g, '\n');
  assert.equal(normalized, workflow);

  const marker = '      - name: Validate Tier A environment (spec §2.1) before touching GCP\n';
  assert.notEqual(normalized.indexOf(marker), -1);
  // Proof the bug is real: the same lookup against the un-normalized CRLF
  // text does not find the marker.
  assert.equal(crlfWorkflow.indexOf(marker), -1);
});

test('deploy validation receives the OTP abuse-control variables', () => {
  const validation = step('Validate Tier A environment (spec §2.1) before touching GCP');
  assert.match(
    validation,
    /EVENT_APP_CHECK_ENFORCED: \$\{\{ vars\.EVENT_APP_CHECK_ENFORCED \}\}/,
  );
  assert.match(
    validation,
    /EVENT_OTP_SEND_CEILING_PER_HOUR: \$\{\{ vars\.EVENT_OTP_SEND_CEILING_PER_HOUR \}\}/,
  );
  assert.match(
    validation,
    /VITE_FIREBASE_APP_CHECK_SITE_KEY: \$\{\{ vars\.VITE_FIREBASE_APP_CHECK_SITE_KEY \}\}/,
  );
});

test('deploy validation gates every job that consumes the validated environment', () => {
  for (const name of ['provision', 'functions', 'content']) {
    assert.match(job(name), /needs: \[[^\]\n]*validate-env[^\]\n]*\]/);
  }
});

test('functions deployment writes both OTP abuse-control variables with safe defaults', () => {
  const runtimeEnv = step('Write the functions runtime env for this project');
  assert.match(
    runtimeEnv,
    /EVENT_APP_CHECK_ENFORCED: \$\{\{ vars\.EVENT_APP_CHECK_ENFORCED \}\}/,
  );
  assert.match(runtimeEnv, /EVENT_APP_CHECK_ENFORCED=\$\{EVENT_APP_CHECK_ENFORCED:-false\}/);
  assert.match(
    runtimeEnv,
    /EVENT_OTP_SEND_CEILING_PER_HOUR: \$\{\{ vars\.EVENT_OTP_SEND_CEILING_PER_HOUR \}\}/,
  );
  assert.match(
    runtimeEnv,
    /EVENT_OTP_SEND_CEILING_PER_HOUR=\$\{EVENT_OTP_SEND_CEILING_PER_HOUR:-500\}/,
  );
});

test('web deployment passes the App Check site key and excludes the debug token', () => {
  const build = step('Build the web app against the generated snapshot');
  assert.match(
    build,
    /VITE_FIREBASE_APP_CHECK_SITE_KEY: \$\{\{ vars\.VITE_FIREBASE_APP_CHECK_SITE_KEY \}\}/,
  );
  assert.doesNotMatch(workflow, /VITE_APP_CHECK_DEBUG_TOKEN/);
});

test('web deployment passes the client error reporting setting', () => {
  const build = step('Build the web app against the generated snapshot');
  assert.match(
    build,
    /VITE_ENABLE_CLIENT_ERROR_REPORTING: \$\{\{ vars\.VITE_ENABLE_CLIENT_ERROR_REPORTING \}\}/,
  );
});

// A fresh deployment, and every ordinary code deploy, never runs the
// Cloud Run publisher (that only fires on a CMS publish) — without this
// step apps/web/dist would carry no sitemap.xml or robots.txt until
// someone happened to publish a content change afterward.
test('the build job writes sitemap.xml, robots.txt, and the manifest right after the vite build, from the same generated snapshot', () => {
  const buildJob = job('build');
  const buildIdx = buildJob.indexOf('- name: Build the web app against the generated snapshot');
  const writeIdx = buildJob.indexOf('- name: Write sitemap.xml, robots.txt, and the web manifest');
  assert.notEqual(buildIdx, -1, 'the build step must exist');
  assert.notEqual(writeIdx, -1, 'the site-files write step must exist');
  assert.ok(writeIdx > buildIdx, 'the site-files write must run after the vite build');

  const write = step('Write sitemap.xml, robots.txt, and the web manifest');
  assert.match(write, /node scripts\/write-site-files\.cjs/);
  assert.match(write, /--dist apps\/web\/dist/);
  // The SAME generated snapshot the build step just downloaded and built
  // from (runner.temp/generated), never the committed demo copy.
  assert.match(write, /--generated "\$\{\{ runner\.temp \}\}\/generated"/);
  assert.match(write, /--public-url "\$\{\{ vars\.EVENT_PUBLIC_URL \}\}"/);
});

// --- site publisher (spec §8.4 phase 5, issue #36) -----------------------------

test('deploy validation receives the site-publisher variables before GCP is touched', () => {
  const validation = step('Validate Tier A environment (spec §2.1) before touching GCP');
  for (const name of [
    'EVENT_SITE_PUBLISHER_ENABLED',
    'EVENT_PUBLISHER_SERVICE_ACCOUNT',
    'EVENT_FUNCTIONS_SERVICE_ACCOUNT',
  ]) {
    assert.match(validation, new RegExp(`${name}: \\$\\{\\{ vars\\.${name} \\}\\}`));
  }
});

test('the publisher job is opt-in per client and skipped on a bootstrap run', () => {
  const publisher = job('publisher');
  assert.match(publisher, /if: vars\.EVENT_SITE_PUBLISHER_ENABLED == 'true' && inputs\.bootstrap != true/);
  assert.match(publisher, /needs: \[[^\]\n]*validate-env[^\]\n]*\]/);
});

test('the publisher image is built into the client\'s own Artifact Registry, tagged by commit', () => {
  const build = step('Build and push the site-publisher image');
  assert.match(build, /\$\{region\}-docker\.pkg\.dev\/\$\{EVENT_FIREBASE_PROJECT_ID\}\/run-of-show\/site-publisher:\$\{GITHUB_SHA\}/);
  assert.match(build, /docker build -f publisher\/Dockerfile/);
  // A floating tag would make "what is this client running" unanswerable.
  assert.doesNotMatch(build, /site-publisher:latest/);
});

test('the Cloud Run job runs as the client\'s own publisher service account', () => {
  const deploy = step('Create or update the Cloud Run job');
  assert.match(deploy, /--service-account "\$EVENT_PUBLISHER_SERVICE_ACCOUNT"/);
  assert.match(deploy, /--task-timeout=30m/);
  // publish-site.cjs is idempotent, but a silent retry would hide a
  // flapping publish; cmsPublish already records and alerts on failure.
  assert.match(deploy, /--max-retries=0/);
});

test('the job environment is written with jq, because EVENT_ALLOWED_ORIGINS contains commas', () => {
  const envStep = step('Write the Cloud Run job environment');
  assert.match(envStep, /jq -n/);
  assert.match(envStep, /EVENT_ALLOWED_ORIGINS: \$\{\{ vars\.EVENT_ALLOWED_ORIGINS \}\}/);
  // Same per-client env the build step consumes — no subdomain coupling.
  assert.match(envStep, /VITE_EVENT_PUBLIC_URL: \$EVENT_PUBLIC_URL/);

  // gcloud's --set-env-vars parser splits on commas, which would shred
  // EVENT_ALLOWED_ORIGINS; the job must be deployed from the file instead.
  const deploy = step('Create or update the Cloud Run job');
  assert.match(deploy, /--env-vars-file "\$RUNNER_TEMP\/publisher-env\.json"/);
  assert.doesNotMatch(deploy, /--set-env-vars/);
});

test('run.invoker is granted on the one job, not project-wide', () => {
  const grant = step('Grant the functions runtime service account run.invoker on the job');
  assert.match(grant, /gcloud run jobs add-iam-policy-binding site-publisher/);
  assert.match(grant, /--role roles\/run\.invoker/);
  // The default runtime identity is derived from the project NUMBER (the
  // default compute service account), not guessed from the project id.
  assert.match(grant, /-compute@developer\.gserviceaccount\.com/);
  assert.match(grant, /gcloud projects describe .* --format='value\(projectNumber\)'/);
  assert.doesNotMatch(grant, /projects add-iam-policy-binding/);
});

test('the functions runtime learns about the publisher only when the client enabled it', () => {
  // Both env-file writers (the `functions` job and the `post` job's
  // single-function redeploy) must agree, or a redeploy of updatesMeta
  // would drop the key from functions/.env.<project-id>.
  const writers = workflow.split('- name: Write the functions runtime env for this project').slice(1);
  assert.equal(writers.length, 2);
  for (const writer of writers) {
    assert.match(writer, /EVENT_SITE_PUBLISHER_ENABLED: \$\{\{ vars\.EVENT_SITE_PUBLISHER_ENABLED \}\}/);
    assert.match(writer, /if \[ "\$\{EVENT_SITE_PUBLISHER_ENABLED:-false\}" = "true" \]; then/);
    assert.match(writer, /echo "EVENT_SITE_PUBLISHER_JOB=site-publisher"/);
  }
});

test('the job name in the workflow matches the one the shared config pins', () => {
  const { SITE_PUBLISHER_JOB_NAME } = require('../packages/shared/src/config/deploy.cjs');
  assert.match(workflow, new RegExp(`EVENT_SITE_PUBLISHER_JOB=${SITE_PUBLISHER_JOB_NAME}`));
  assert.match(workflow, new RegExp(`gcloud run jobs deploy ${SITE_PUBLISHER_JOB_NAME}`));
});

test('no continue-on-error key anywhere, publisher included (spec §8.1)', () => {
  // The prose at the top of the workflow explains why; what must not exist
  // is the key itself.
  assert.doesNotMatch(workflow, /^\s*continue-on-error:/m);
});

// ----------------------------------------------------------- firebase.json
//
// The hosting rewrites decide which requests reach a function and which
// are answered by the static shell, and the deploy steps above patch that
// same file, so the two are checked together.

const firebaseJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'firebase.json'), 'utf8'),
);

/** The private routes that are answered by the shell, never by routeMeta. */
const PRIVATE_SOURCES = [
  '/signin',
  '/profile',
  '/attendees',
  '/attendees/**',
  '/schedule/mine',
  '/speaker/**',
  '/ticket/**',
  '/admin',
  '/admin/**',
];

test('every private route is rewritten to the static shell, above the routeMeta catch-all', () => {
  const rewrites = firebaseJson.hosting.rewrites;
  const catchAll = rewrites.findIndex((r) => r.source === '**');
  assert.notEqual(catchAll, -1);
  assert.equal(rewrites[catchAll].function.functionId, 'routeMeta');
  assert.equal(catchAll, rewrites.length - 1, 'the catch-all must be last, or it swallows what follows');

  for (const source of PRIVATE_SOURCES) {
    const index = rewrites.findIndex((r) => r.source === source);
    assert.notEqual(index, -1, `missing rewrite for ${source}`);
    assert.equal(rewrites[index].destination, '/index.html', `${source} must not reach a function`);
    assert.ok(index < catchAll, `${source} must come before the catch-all`);
  }
});

test('every private route also carries X-Robots-Tag: noindex from hosting itself', () => {
  // The shell those routes serve is the same bytes for every route, so it
  // cannot carry a per-route robots meta. Hosting states it in the
  // response header instead, which crawlers read the same way.
  const headers = firebaseJson.hosting.headers || [];
  for (const source of PRIVATE_SOURCES) {
    const entry = headers.find((h) => h.source === source);
    assert.ok(entry, `missing headers entry for ${source}`);
    const tag = entry.headers.find((h) => h.key === 'X-Robots-Tag');
    assert.ok(tag, `missing X-Robots-Tag for ${source}`);
    assert.equal(tag.value, 'noindex');
  }
});

test('both function rewrites name their region in object form, and the deploy patches every one', () => {
  // The bare string form ("function": "routeMeta") silently defaults to
  // us-central1, which routes a non-default-region client at a backend
  // that does not exist there.
  const functionRewrites = firebaseJson.hosting.rewrites.filter((r) => r.function);
  assert.equal(functionRewrites.length, 2);
  for (const rewrite of functionRewrites) {
    assert.equal(typeof rewrite.function, 'object');
    assert.ok(rewrite.function.functionId);
    assert.ok(rewrite.function.region);
  }
  assert.deepEqual(
    functionRewrites.map((r) => r.function.functionId).sort(),
    ['routeMeta', 'updatesMeta'],
  );

  const patch = step('Set the function rewrite regions for this project');
  assert.match(patch, /\(\.function \| type\) == "object"/);
  assert.doesNotMatch(patch, /functionId == "/, 'the patch must not name one function by id');
});

test('the post job redeploys every function that self-fetches the hosting template', () => {
  // A hosting deploy replaces index.html and its hashed asset names; a
  // container holding the previous copy has to be restarted, or it keeps
  // naming files the release no longer has.
  const redeploy = step('Redeploy the SSR meta functions only');
  assert.match(redeploy, /--only functions:updatesMeta,functions:routeMeta/);
});

test('every function rewrite names a function the smoke list preflights', () => {
  const { endpoints } = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '.github', 'smoke-endpoints.json'), 'utf8'),
  );
  for (const rewrite of firebaseJson.hosting.rewrites.filter((r) => r.function)) {
    assert.ok(
      endpoints.includes(rewrite.function.functionId),
      `${rewrite.function.functionId} is rewritten to but never smoke-tested`,
    );
  }
});
