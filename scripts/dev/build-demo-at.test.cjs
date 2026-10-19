'use strict';

// Argument handling and the build plan for scripts/dev/build-demo-at.cjs.
// The worktree, install, and build are exercised for real by the CI e2e
// job's "Build the public demo for visual evidence" step.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildSteps, main, parseArgs, UsageError } = require('./build-demo-at.cjs');

const SHA = 'a'.repeat(40);

test('a full commit SHA and an output directory are required', () => {
  assert.deepEqual(parseArgs(['--rev', SHA, '--out', '/tmp/before']), { rev: SHA, out: '/tmp/before' });
  for (const argv of [
    [], ['--out', '/tmp/before'], ['--rev', SHA], ['--rev', 'main', '--out', '/tmp/x'],
    ['--rev', `${SHA}:docs/demo`, '--out', '/tmp/x'], ['--rev', '--out', '/tmp/x'], ['--host', 'x'],
  ]) assert.throws(() => parseArgs(argv), UsageError, JSON.stringify(argv));
});

test('a commit with a committed demo is copied as is; any other commit installs and builds its own', () => {
  assert.deepEqual(buildSteps(true), []);
  assert.deepEqual(buildSteps(false), [
    ['npm', ['run', 'prepare:functions']],
    ['npm', ['ci', '--no-audit', '--no-fund']],
    ['node', ['scripts/build-demo.cjs']],
  ]);
});

test('bad arguments and a non-empty output directory are refused before any worktree is made', () => {
  assert.equal(main(['--rev', 'main', '--out', '/tmp/x']), 2);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'build-demo-at-test-'));
  try {
    fs.writeFileSync(path.join(out, 'stale.txt'), 'x');
    assert.equal(main(['--rev', SHA, '--out', out]), 2);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
