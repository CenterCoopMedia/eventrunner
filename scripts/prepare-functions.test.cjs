'use strict';

// Argument/command resolution for scripts/prepare-functions.cjs (issue
// #102). The pack-and-vendor work itself is exercised end-to-end by
// `npm run prepare:functions` in CI; what is worth pinning here is the
// one thing that breaks silently on a different OS: how the script finds
// npm to run.
//
// On Windows there is no `npm` executable on PATH — only `npm.cmd` (a
// shim) — so `execFileSync('npm', ...)` throws ENOENT there. Spawning
// through a shell would "fix" that but reopens command injection if any
// argument ever comes from outside this file, so the fix instead runs
// node's own bundled npm-cli.js directly, the same way scripts/build-demo.cjs
// already does.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { npmCommand } = require('./prepare-functions.cjs');

test('on win32, npm is invoked via the bundled npm-cli.js, never a bare "npm"', () => {
  const { command, args } = npmCommand(['pack', './packages/shared'], {
    platform: 'win32',
    execPath: 'C:\\Program Files\\nodejs\\node.exe',
  });
  assert.equal(command, 'C:\\Program Files\\nodejs\\node.exe');
  assert.deepEqual(args, [
    path.win32.join('C:\\Program Files\\nodejs', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    'pack',
    './packages/shared',
  ]);
});

test('on non-Windows platforms, npm is invoked directly with no shell', () => {
  const { command, args } = npmCommand(['install', '--package-lock-only'], {
    platform: 'linux',
    execPath: '/usr/bin/node',
  });
  assert.equal(command, 'npm');
  assert.deepEqual(args, ['install', '--package-lock-only']);
});
