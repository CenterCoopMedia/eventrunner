'use strict';

// ADR 0007 Principle 5: the console checks answers with the same rules as
// init-event.cjs, so it requires the shared package. Firebase uploads only
// console/functions, so the package reaches it as vendor/shared.tgz, which
// scripts/prepare-functions.cjs writes, as for functions/ (spec §1.1).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const functionsDir = path.resolve(__dirname, '..');

test("require('shared/answers') resolves from the console functions directory", () => {
  const answers = require(require.resolve('shared/answers', { paths: [functionsDir] }));
  assert.equal(typeof answers.buildEvent, 'function');
  const config = require(require.resolve('shared/config', { paths: [functionsDir] }));
  assert.equal(typeof config.validateEventConfig, 'function');
});

test('the vendored tarball exists and the console lockfile pins it', () => {
  assert.ok(
    fs.existsSync(path.join(functionsDir, 'vendor', 'shared.tgz')),
    'run `npm run prepare:functions`: the tarball is not in Git and is made again',
  );
  const lock = JSON.parse(fs.readFileSync(path.join(functionsDir, 'package-lock.json'), 'utf8'));
  const entry = lock.packages?.['node_modules/shared'];
  assert.ok(entry, 'console/functions/package-lock.json must pin node_modules/shared');
  assert.match(entry.integrity || '', /^sha512-/);
  const clientLockPath = path.join(functionsDir, '..', '..', 'functions', 'package-lock.json');
  const clientLock = JSON.parse(fs.readFileSync(clientLockPath, 'utf8'));
  assert.equal(entry.integrity, clientLock.packages['node_modules/shared'].integrity, 'one shared package for both');
});
