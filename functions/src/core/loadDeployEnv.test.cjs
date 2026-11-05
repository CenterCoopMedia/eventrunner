'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const FUNCTIONS_DIR = path.join(__dirname, '..', '..');

/** What the functions see when Firebase reads the code: only its own variables. */
function discover(script, env) {
  return execFileSync(process.execPath, ['-e', script], {
    cwd: FUNCTIONS_DIR,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
    encoding: 'utf8',
  }).trim();
}

const READ = (dir) => `
  const loaded = require('./src/core/loadDeployEnv.cjs').loadDeployEnv({ dir: ${JSON.stringify(dir)} });
  console.log(JSON.stringify({ loaded, provider: process.env.EVENT_EMAIL_PROVIDER ?? null }));`;

test('the deploy-time read picks up this project\'s variables, and set variables win', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-env-'));
  fs.writeFileSync(path.join(dir, '.env.p1'), 'EVENT_EMAIL_PROVIDER=postmark\n');
  const flag = { FUNCTIONS_CONTROL_API: 'true', GCLOUD_PROJECT: 'p1' };
  assert.deepEqual(JSON.parse(discover(READ(dir), flag)), { loaded: true, provider: 'postmark' });
  assert.deepEqual(JSON.parse(discover(READ(dir), { ...flag, EVENT_EMAIL_PROVIDER: 'console' })), { loaded: true, provider: 'console' });
});

test('nothing is read at run time, or when the project has no file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-env-'));
  fs.writeFileSync(path.join(dir, '.env.p1'), 'EVENT_EMAIL_PROVIDER=postmark\n');
  assert.deepEqual(JSON.parse(discover(READ(dir), { GCLOUD_PROJECT: 'p1' })), { loaded: false, provider: null });
  assert.deepEqual(JSON.parse(discover(READ(dir), { FUNCTIONS_CONTROL_API: 'true', GCLOUD_PROJECT: 'p2' })), { loaded: false, provider: null });
});

test('the functions entry point loads the variables before any handler module', () => {
  const source = fs.readFileSync(path.join(FUNCTIONS_DIR, 'index.js'), 'utf8');
  const first = source.search(/require\(/);
  assert.ok(source.slice(first).startsWith("require('./src/core/loadDeployEnv.cjs').loadDeployEnv();"));
});
