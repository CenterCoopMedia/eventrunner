'use strict';

// The client deploy packs the shared tarball once and hands it to later
// jobs as an artifact. Those jobs run a root `npm ci`, which installs every
// workspace, so every workspace's vendored copy must exist before it. The
// workflow names no console path (scripts/console-isolation.test.cjs), so
// each job restores the copies with `prepare-functions.cjs --copy`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FUNCTION_DIRS, copyVendored } = require('./prepare-functions.cjs');

const ROOT = path.join(__dirname, '..');
const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/deploy-client.yml'), 'utf8');
const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

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

test('each job copies the tarball after it downloads it and before npm ci', () => {
  const jobs = workflow.split(/\n {2}(?=[a-z][\w-]*:\n)/).filter((job) => job.includes('name: shared-tgz-'));
  const consumers = jobs.filter((job) => job.includes('actions/download-artifact'));
  assert.ok(consumers.length >= 3);
  for (const job of consumers) {
    const download = job.indexOf('actions/download-artifact');
    const copy = job.indexOf('node scripts/prepare-functions.cjs --copy');
    assert.ok(copy > download, `${job.split('\n')[0]} copies after the download`);
    const install = job.indexOf('run: npm ci');
    if (install !== -1) assert.ok(copy < install, `${job.split('\n')[0]} copies before npm ci`);
  }
});
