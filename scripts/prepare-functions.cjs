#!/usr/bin/env node
'use strict';

/**
 * Pack packages/shared into functions/vendor/shared.tgz (spec §1.1).
 *
 * Firebase uploads only the functions/ directory on deploy, so the shared
 * workspace sibling must be physically vendored — a root node_modules
 * symlink does not survive the upload and the functions crash at cold
 * start with "Cannot find module 'shared'".
 *
 * Run by the firebase.json functions predeploy hook and by CI, so a laptop
 * deploy gets exactly the same treatment. Deterministic: npm pack
 * normalizes tarball mtimes, so an unchanged shared package produces a
 * byte-identical tarball and functions/package-lock.json stays quiet; a
 * changed one flips the pinned integrity hash, making a stale tarball a
 * loud lockfile mismatch instead of a silent version skew.
 *
 * No dependencies beyond npm itself, so it runs on a fresh clone before
 * any install.
 */

const { execFileSync } = require('node:child_process');
const { mkdirSync, renameSync, rmSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const vendorDir = path.join(root, 'functions', 'vendor');
const target = path.join(vendorDir, 'shared.tgz');
const tmp = `${target}.tmp`;

function npm(args, opts = {}) {
  // npm_config_* vars from an outer npm invocation (e.g. --package-lock-only
  // leaking into the pack step) must not change behavior here.
  const env = { ...process.env };
  delete env.npm_config_package_lock_only;
  return execFileSync('npm', args, { cwd: root, encoding: 'utf8', env, ...opts });
}

mkdirSync(vendorDir, { recursive: true });

// `npm pack --json` reports the tarball filename it wrote.
const packOutput = npm([
  'pack',
  './packages/shared',
  '--pack-destination',
  vendorDir,
  '--json',
]);
const [{ filename }] = JSON.parse(packOutput);
// npm may report the raw name with a scope slash; the file on disk is escaped.
const writtenName = filename.replace('/', '-');

renameSync(path.join(vendorDir, writtenName), tmp);
rmSync(target, { force: true });
renameSync(tmp, target);

// Refresh functions/package-lock.json so it pins the tarball's integrity
// hash without installing anything.
npm(['install', '--prefix', path.join(root, 'functions'), '--package-lock-only'], {
  cwd: path.join(root, 'functions'),
});

console.log(`prepare-functions: wrote ${path.relative(root, target)}`);
