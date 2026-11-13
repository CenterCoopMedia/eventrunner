'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isLighthouseInput, webLockfile, shouldMeasure } = require('./lighthouse-changes.cjs');

const base = 'a'.repeat(40);
const head = 'b'.repeat(40);
const ancestor = 'c'.repeat(40);
const lock = {
  lockfileVersion: 3,
  packages: {
    '': { devDependencies: { vite: '8.3.4' } },
    'apps/web': { dependencies: { react: '18.3.1' } },
    'packages/shared': { version: '0.1.0' },
    'console/functions': { dependencies: { shared: 'file:./vendor/shared.tgz' } },
    'console/web': { dependencies: { react: '18.3.1' } },
    functions: { dependencies: { stripe: '23.0.0' } },
    'node_modules/stripe': { version: '23.0.0' },
    'node_modules/react': { version: '18.3.1' },
  },
};

function selection(paths, after = lock, eventName = 'pull_request') {
  const calls = [];
  const measure = shouldMeasure({ eventName, base, head, runGit(command, args) {
    assert.equal(command, 'git');
    calls.push(args);
    if (args[0] === 'merge-base') return ancestor;
    if (args[0] === 'diff') return paths.join('\0');
    if (args[0] === 'show') return JSON.stringify(args[1] === `${head}:package-lock.json` ? after : lock);
    throw new Error(`Unexpected git call: ${args}`);
  } });
  return { measure, calls };
}

test('Console-only Stripe manifest addition skips collection; installed packages stay significant', () => {
  const after = structuredClone(lock);
  after.packages['console/functions'].dependencies.stripe = '23.0.0';
  const paths = ['console/functions/src/stripeWebhooks.cjs', 'scripts/provision-client.cjs',
    'docs/DEPLOY_RUNBOOK.md', 'console/functions/package.json', 'package-lock.json'];
  assert.equal(selection(paths, after).measure, false);
  after.packages['node_modules/stripe'].version = '24.0.0';
  assert.equal(selection(paths, after).measure, true);
});

test('web, shared, root and transitive lock changes always select collection', () => {
  for (const key of ['', 'apps/web', 'packages/shared', 'node_modules/react', 'console/web/node_modules/react']) {
    const after = structuredClone(lock);
    after.packages[key] = { version: 'changed' };
    assert.equal(selection(['package-lock.json'], after).measure, true, key);
  }
  assert.throws(() => webLockfile({ lockfileVersion: 4, packages: {} }), /version 3/);
  assert.throws(() => webLockfile({ lockfileVersion: 3 }), /version 3/);
});

test('load inputs select collection even alongside unrelated workspace metadata', () => {
  for (const file of ['apps/web/src/main.jsx', 'apps/web/src/pages/Schedule.jsx', 'apps/web/public/hero.webp',
    'apps/web/package.json', 'packages/shared/src/theme.cjs', 'design/tokens/base.json',
    'scripts/lib/demo-event.cjs', 'scripts/build-demo.cjs', 'scripts/write-site-files.cjs',
    'scripts/ci/lighthouserc.cjs', 'scripts/ci/lighthouse-changes.cjs', '.github/workflows/lighthouse.yml',
    'package.json', '.npmrc']) {
    assert.equal(selection([file, 'package-lock.json']).measure, true, file);
  }
  for (const file of ['apps/web/src/admin/Settings.jsx', 'apps/web/src/test/setup.js',
    'apps/web/src/App.test.jsx', 'packages/shared/src/time.test.cjs', 'scripts/lib/demo-event.test.cjs',
    'docs/guide.md', 'console/web/src/App.jsx']) assert.equal(isLighthouseInput(file), false, file);
});

test('PRs compare the merge base, pushes compare before; renames keep both paths', () => {
  const pr = selection(['apps/web/old.jsx', 'console/web/new.jsx']);
  assert.equal(pr.measure, true);
  assert.deepEqual(pr.calls, [['merge-base', base, head],
    ['diff', '--name-only', '-z', '--no-renames', ancestor, head]]);
  const push = selection(['package-lock.json'], lock, 'push');
  assert.equal(push.measure, false);
  assert.deepEqual(push.calls[0], ['diff', '--name-only', '-z', '--no-renames', base, head]);
});

test('weekly, manual and initial pushes measure; missing PR identity fails visibly', () => {
  for (const eventName of ['schedule', 'workflow_dispatch']) assert.equal(shouldMeasure({ eventName }), true);
  assert.equal(shouldMeasure({ eventName: 'push', base: '0'.repeat(40), head }), true);
  assert.throws(() => shouldMeasure({ eventName: 'pull_request', head }), /commit IDs/);
});
