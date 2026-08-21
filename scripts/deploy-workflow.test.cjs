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
