'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

// Issue #7's contract: the functions runtime must resolve require('shared')
// from its own dependency graph — Firebase uploads only functions/, so the
// workspace sibling reaches it via vendor/shared.tgz (spec §1.1).

const functionsDir = path.resolve(__dirname, '..');

test("require('shared') resolves from the functions directory", () => {
  const resolved = require.resolve('shared', { paths: [functionsDir] });
  const shared = require(resolved);
  assert.equal(typeof shared, 'object');
  const config = require(require.resolve('shared/config', { paths: [functionsDir] }));
  assert.equal(typeof config.getEventPhase, 'function');
  assert.equal(typeof config.validateDeployEnv, 'function');
});

test('the vendored tarball exists and is pinned by the functions lockfile', () => {
  assert.ok(
    fs.existsSync(path.join(functionsDir, 'vendor', 'shared.tgz')),
    'run `npm run prepare:functions` — the tarball is gitignored and regenerated',
  );
  const lock = JSON.parse(fs.readFileSync(path.join(functionsDir, 'package-lock.json'), 'utf8'));
  const entry = lock.packages?.['node_modules/shared'];
  assert.ok(entry, 'functions/package-lock.json must pin node_modules/shared');
  assert.match(entry.integrity || '', /^sha512-/);
});
