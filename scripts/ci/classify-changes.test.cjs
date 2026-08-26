'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { classifyPaths, JOB_NAMES } = require('./classify-changes.cjs');

function selected(result) {
  return JOB_NAMES.filter((name) => result.jobs[name]);
}

test('docs-only changes select only the documentation tier', () => {
  const result = classifyPaths([
    'README.md',
    'docs/handbook/faq.md',
    'CONTRIBUTING.md',
  ]);

  assert.equal(result.mode, 'docs');
  assert.deepEqual(selected(result), ['docs']);
  assert.equal(result.jobs.demo, false);
  assert.equal(result.jobs.unit, false);
  assert.equal(result.jobs.unitWeb, false);
  assert.equal(result.jobs.rules, false);
  assert.equal(result.jobs.e2e, false);
});

test('demo generator and committed Pages output select demo checks without emulator suites', () => {
  const generator = classifyPaths([
    'scripts/build-demo.cjs',
    'scripts/build-demo.test.cjs',
  ]);
  const output = classifyPaths(['docs/demo/index.html']);

  assert.equal(generator.mode, 'demo');
  assert.deepEqual(selected(generator), ['demo', 'lint']);
  assert.equal(generator.jobs.rules, false);
  assert.equal(generator.jobs.e2e, false);

  assert.equal(output.mode, 'demo');
  assert.deepEqual(selected(output), ['demo']);
});

test('reserved documentation generator paths stay in the documentation tier', () => {
  for (const path of [
    'scripts/build-pages.cjs',
    'scripts/build-pages.test.cjs',
    'scripts/lib/pages-index.cjs',
    'scripts/lib/markdown-pages.cjs',
    'docs/docs/index.html',
  ]) {
    const result = classifyPaths([path]);
    assert.equal(result.mode, 'docs', path);
    assert.deepEqual(selected(result), ['docs'], path);
  }
});

test('application and backend changes select their relevant suites', () => {
  const app = classifyPaths(['apps/web/src/App.jsx']);
  const backend = classifyPaths(['functions/src/core/auth.cjs']);

  assert.equal(app.mode, 'app');
  assert.deepEqual(selected(app), ['demo', 'lint', 'unitWeb', 'build', 'hygiene', 'e2e']);
  assert.equal(app.jobs.unit, false);
  assert.equal(app.jobs.rules, false);

  assert.equal(backend.mode, 'backend');
  assert.deepEqual(selected(backend), ['lint', 'unit', 'rules', 'e2e']);
  assert.equal(backend.jobs.unitWeb, false);
  assert.equal(backend.jobs.build, false);
});

test('workflow, configuration, and dependency changes select the full matrix', () => {
  for (const path of [
    '.github/workflows/ci.yml',
    'package-lock.json',
    'firebase.json',
    'apps/web/vite.config.js',
    'apps/web/vite.config.ts',
    'vitest.rules.config.js',
  ]) {
    const result = classifyPaths([path]);
    assert.equal(result.mode, 'full', path);
    assert.deepEqual(selected(result), JOB_NAMES, path);
  }
});

test('mixed changes take the union of their tiers', () => {
  const result = classifyPaths([
    'README.md',
    'apps/web/src/App.jsx',
    'firestore.rules',
  ]);

  assert.equal(result.mode, 'mixed');
  assert.deepEqual(selected(result), [
    'docs',
    'demo',
    'lint',
    'unitWeb',
    'build',
    'hygiene',
    'rules',
    'e2e',
  ]);
});

test('unknown paths fail open to the full matrix', () => {
  const result = classifyPaths(['scripts/new-tool.cjs']);

  assert.equal(result.mode, 'full');
  assert.deepEqual(selected(result), JOB_NAMES);
});
