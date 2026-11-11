'use strict';

// The client deploy packs the shared tarball and its lockfiles once and
// hands them to later jobs as one artifact. A warm npm cache can install
// the old package when a newer archive arrives with a stale integrity.
// Those jobs run root `npm ci`, which installs every workspace, so every
// workspace's vendored copy and matching lockfile must exist before it. The
// workflow names no console path (scripts/console-isolation.test.cjs), so
// each job restores the copies with `prepare-functions.cjs --copy`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { FUNCTION_DIRS, copyVendored } = require('./prepare-functions.cjs');

const ROOT = path.join(__dirname, '..');
const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/deploy-client.yml'), 'utf8');
const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

test('full and partial deploys derive the Auth compute runtime from the target project number', () => {
  const blocks = [...workflow.matchAll(/name: Write the functions runtime env for this project\n[\s\S]*?        run: \|\n((?:          .*\n)+)/g)];
  assert.equal(blocks.length, 2, 'both runtime env writers are covered');
  for (const [, block] of blocks) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-env-'));
    try {
      fs.mkdirSync(path.join(dir, 'functions'));
      const bin = path.join(dir, 'bin');
      fs.mkdirSync(bin);
      fs.writeFileSync(path.join(bin, 'gcloud'), '#!/bin/sh\n[ "$1" = projects ] && [ "$2" = describe ] && [ "$3" = demo-runtime-contract ] || exit 42\nprintf "555000111\\n"\n', { mode: 0o755 });
      const script = block.replace(/^ {10}/gm, '');
      const env = Object.fromEntries([...script.matchAll(/\$\{?(EVENT_[A-Z_]+)/g)].map((match) => [match[1], '']));
      env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;
      env.EVENT_FIREBASE_PROJECT_ID = 'demo-runtime-contract';
      execFileSync('bash', ['-c', script], { cwd: dir, env, timeout: 5000 });
      const saved = fs.readFileSync(path.join(dir, 'functions/.env.demo-runtime-contract'), 'utf8');
      assert.match(saved, /^EVENT_COMPUTE_SERVICE_ACCOUNT=555000111-compute@developer\.gserviceaccount\.com$/m);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('prepare-functions knows every workspace that vendors a tarball', () => {
  const vendoring = rootPkg.workspaces.filter((workspace) => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, workspace, 'package.json'), 'utf8'));
    return Object.values({ ...pkg.dependencies, ...pkg.devDependencies }).some((spec) => /^file:\.\/vendor\/.+\.tgz$/.test(spec));
  });
  assert.deepEqual(vendoring.sort(), FUNCTION_DIRS.map((dir) => dir.split(path.sep).join('/')).sort());
});

test('--copy puts the packed tarball in every other vendor folder', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-copy-'));
  fs.mkdirSync(path.join(dir, 'functions', 'vendor'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'functions', 'vendor', 'shared.tgz'), 'tarball');
  copyVendored(dir);
  for (const fnDir of FUNCTION_DIRS) {
    assert.equal(fs.readFileSync(path.join(dir, fnDir, 'vendor', 'shared.tgz'), 'utf8'), 'tarball');
  }
  fs.rmSync(dir, { recursive: true, force: true });
  assert.throws(() => copyVendored(fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-none-'))), /prepare:functions/);
});

test('deployment artifacts carry archive and matching lockfiles before npm ci', () => {
  const jobs = workflow.split(/\n {2}(?=[a-z][\w-]*:\n)/).filter((job) => job.includes('name: shared-workspace-'));
  const producer = jobs.find((job) => job.includes('actions/upload-artifact'));
  assert.ok(producer, 'the pack job publishes the shared workspace');
  const paths = producer.match(/path: \|\n((?: +[^\n]+\n)+?)(?= +retention-days:)/)?.[1]
    .trim().split('\n').map((entry) => entry.trim());
  assert.ok(paths, 'the artifact preserves paths from the repository root');
  for (const file of ['functions/vendor/shared.tgz', 'package-lock.json',
    ...FUNCTION_DIRS.map((dir) => `${dir.split(path.sep).join('/')}/package-lock.json`)]) {
    assert.ok(paths.some((pattern) => !pattern.startsWith('!') && path.matchesGlob(file, pattern)), `${file} is shipped`);
    assert.ok(!paths.some((pattern) => pattern.startsWith('!') && path.matchesGlob(file, pattern.slice(1))), `${file} is not excluded`);
  }
  const consumers = jobs.filter((job) => job.includes('actions/download-artifact'));
  assert.ok(consumers.length >= 3);
  for (const job of consumers) {
    const download = job.indexOf('actions/download-artifact');
    assert.match(job.slice(download), /path: \.(?:\r?\n|$)/, `${job.split('\n')[0]} restores archive and locks at the repository root`);
    const copy = job.indexOf('node scripts/prepare-functions.cjs --copy');
    assert.ok(copy > download, `${job.split('\n')[0]} copies after the download`);
    const install = job.indexOf('run: npm ci');
    if (install !== -1) assert.ok(copy < install, `${job.split('\n')[0]} copies before npm ci`);
  }
});
