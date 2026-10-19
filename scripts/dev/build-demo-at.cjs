#!/usr/bin/env node
'use strict';

/**
 * Build the public demo of an earlier commit, for before/after evidence.
 *
 *   node scripts/dev/build-demo-at.cjs --rev <full-SHA> --out <empty-or-new-dir>
 *
 * docs/demo/ is build output and is not committed, so the "before" side of
 * scripts/dev/capture-demo-visuals.mjs has to be built from the PR base.
 * This script checks the commit out into a detached worktree in a temporary
 * directory, installs its own locked dependencies there, runs that commit's
 * own scripts/build-demo.cjs, and copies the result to --out. A commit from
 * before this change still has its docs/demo/ committed; that copy is used
 * as is, with no install and no build. The temporary worktree is always
 * removed. The current checkout is never changed.
 *
 * Exit codes: 0 ok, 1 failure, 2 bad arguments.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '../..');
const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i;

class UsageError extends Error {}

function parseArgs(argv) {
  const options = { rev: null, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag !== '--rev' && flag !== '--out') throw new UsageError(`Unknown option: ${flag}`);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new UsageError(`${flag} requires a value`);
    options[flag.slice(2)] = value;
    i += 1;
  }
  if (!options.rev || !SHA.test(options.rev)) throw new UsageError('--rev must be a full commit SHA');
  if (!options.out) throw new UsageError('--out is required');
  return options;
}

/**
 * The steps for one revision, as data, so the plan is testable without a
 * build. `committed` is true when the commit still carries docs/demo/.
 */
function buildSteps(committed) {
  if (committed) return [];
  return [
    ['npm', ['run', 'prepare:functions']],
    ['npm', ['ci', '--no-audit', '--no-fund']],
    ['node', ['scripts/build-demo.cjs']],
  ];
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { stdio: 'inherit', ...options });
}

function hasCommittedDemo(rev) {
  try {
    execFileSync('git', ['cat-file', '-e', `${rev}:docs/demo/index.html`], { cwd: REPO_ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message);
      return 2;
    }
    throw error;
  }
  const out = path.resolve(options.out);
  if (fs.existsSync(out) && fs.readdirSync(out).length > 0) {
    console.error(`--out must be empty or absent: ${out}`);
    return 2;
  }
  const rev = execFileSync('git', ['rev-parse', '--verify', '--end-of-options', `${options.rev}^{commit}`], {
    cwd: REPO_ROOT, encoding: 'utf8',
  }).trim();

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-at-'));
  const worktree = path.join(tmpRoot, 'tree');
  try {
    run('git', ['worktree', 'add', '--detach', worktree, rev], { cwd: REPO_ROOT });
    const committed = hasCommittedDemo(rev);
    console.log(committed
      ? `build-demo-at: ${rev} has docs/demo committed; using it.`
      : `build-demo-at: building the demo of ${rev}.`);
    const env = { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' };
    for (const [command, args] of buildSteps(committed)) run(command, args, { cwd: worktree, env });
    const built = path.join(worktree, 'docs', 'demo');
    if (!fs.existsSync(path.join(built, 'index.html'))) {
      console.error(`build-demo-at: no demo at ${built}`);
      return 1;
    }
    fs.mkdirSync(out, { recursive: true });
    fs.cpSync(built, out, { recursive: true });
    console.log(`build-demo-at: wrote the demo of ${rev} to ${out}`);
    return 0;
  } finally {
    try {
      execFileSync('git', ['worktree', 'remove', '--force', worktree], { cwd: REPO_ROOT, stdio: 'ignore' });
    } catch {
      // The directory below is removed either way; prune drops the record.
      execFileSync('git', ['worktree', 'prune'], { cwd: REPO_ROOT, stdio: 'ignore' });
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`build-demo-at: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { buildSteps, main, parseArgs, UsageError };
