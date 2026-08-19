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
const { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } = require('node:fs');
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

// npm's --package-lock-only reuses an existing file: entry instead of
// re-hashing the freshly packed archive, which would leave a changed
// shared package pinned to the OLD integrity — exactly the silent skew
// this script exists to prevent. Drop every stale shared entry first so
// the regeneration below must re-read the tarball.
function dropSharedEntries(lockPath) {
  if (!existsSync(lockPath)) return;
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  for (const [key, entry] of Object.entries(lock.packages || {})) {
    if (typeof entry?.resolved === 'string' && entry.resolved.endsWith('vendor/shared.tgz')) {
      delete lock.packages[key];
    }
  }
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
}

dropSharedEntries(path.join(root, 'functions', 'package-lock.json'));
dropSharedEntries(path.join(root, 'package-lock.json'));

// Refresh functions/package-lock.json so it pins the tarball's integrity
// hash without installing anything, then the root workspace lockfile,
// which pins the same tarball through the functions workspace.
npm(['install', '--prefix', path.join(root, 'functions'), '--package-lock-only'], {
  cwd: path.join(root, 'functions'),
});
npm(['install', '--package-lock-only']);

console.log(`prepare-functions: wrote ${path.relative(root, target)}`);
