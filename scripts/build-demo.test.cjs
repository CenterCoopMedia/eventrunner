'use strict';

// Argument handling for the static demo build (scripts/build-demo.cjs).
// The build itself is a vite invocation and is exercised by running it; what
// is worth pinning here is the two guards that make the script safe to run
// unattended — the trailing-slash normalization Vite silently depends on, and
// the refusal to delete anything outside the repository.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  parseArgs,
  resolveOutDir,
  DEFAULT_BASE,
  DEFAULT_OUT,
  DEMO_FIREBASE_ENV,
  UsageError,
} = require('./build-demo.cjs');

const REPO_ROOT = path.resolve(__dirname, '..');

test('defaults target the Pages subpath and docs/demo', () => {
  const options = parseArgs([]);
  assert.equal(options.base, DEFAULT_BASE);
  assert.equal(options.out, DEFAULT_OUT);
  assert.equal(options.dryRun, false);
  assert.ok(DEFAULT_BASE.endsWith('/'));
});

test('a base without a trailing slash is normalized', () => {
  assert.equal(parseArgs(['--base', '/run-of-show/demo']).base, '/run-of-show/demo/');
  assert.equal(parseArgs(['--base=/x']).base, '/x/');
});

test('--out and --dry-run parse in both forms', () => {
  assert.equal(parseArgs(['--out', 'docs/preview']).out, 'docs/preview');
  assert.equal(parseArgs(['--out=docs/preview']).out, 'docs/preview');
  assert.equal(parseArgs(['--dry-run']).dryRun, true);
});

test('unknown arguments and missing values are usage errors', () => {
  assert.throws(() => parseArgs(['--nope']), UsageError);
  assert.throws(() => parseArgs(['--out']), UsageError);
  assert.throws(() => parseArgs(['--base', '--dry-run']), UsageError);
});

test('the output directory must be inside the repository', () => {
  assert.equal(resolveOutDir('docs/demo'), path.join(REPO_ROOT, 'docs', 'demo'));
  assert.throws(() => resolveOutDir('/tmp/anywhere'), UsageError);
  assert.throws(() => resolveOutDir('../outside'), UsageError);
  // The repository root itself would be an rm -rf of the checkout.
  assert.throws(() => resolveOutDir('.'), UsageError);
});

test('the placeholder Firebase env carries no real credential', () => {
  const values = Object.values(DEMO_FIREBASE_ENV).join(' ');
  assert.match(values, /demo/);
  assert.doesNotMatch(values, /AIza/); // shape of a real web API key
  assert.equal(DEMO_FIREBASE_ENV.VITE_FIREBASE_PROJECT_ID, 'demo-run-of-show');
});
