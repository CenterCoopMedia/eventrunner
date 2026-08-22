'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflow = fs.readFileSync(
  path.join(__dirname, '..', '.github', 'workflows', 'deploy-client.yml'),
  'utf8',
);

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
