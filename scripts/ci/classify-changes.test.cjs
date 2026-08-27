'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { changedPaths, classifyPaths, JOB_NAMES } = require('./classify-changes.cjs');

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

test('Pages generator paths select documentation checks and lint', () => {
  for (const path of [
    'scripts/build-pages.cjs',
    'scripts/build-pages.test.cjs',
    'scripts/lib/pages-index.cjs',
    'scripts/lib/markdown-pages.cjs',
  ]) {
    const result = classifyPaths([path]);
    assert.equal(result.mode, 'docs', path);
    assert.deepEqual(selected(result), ['docs', 'lint'], path);
  }

  assert.deepEqual(selected(classifyPaths(['docs/docs/index.html'])), ['docs']);
});

test('application and backend changes select their relevant suites', () => {
  const app = classifyPaths(['apps/web/src/App.jsx']);
  const backend = classifyPaths(['functions/src/core/auth.cjs']);
  const shared = classifyPaths(['packages/shared/src/registration.cjs']);

  assert.equal(app.mode, 'app');
  assert.deepEqual(selected(app), ['demo', 'lint', 'unitWeb', 'build', 'hygiene', 'e2e']);
  assert.equal(app.jobs.unit, false);
  assert.equal(app.jobs.rules, false);

  assert.equal(backend.mode, 'backend');
  assert.deepEqual(selected(backend), ['lint', 'unit', 'rules', 'e2e']);
  assert.equal(backend.jobs.unitWeb, false);
  assert.equal(backend.jobs.build, false);

  assert.equal(shared.mode, 'shared');
  assert.deepEqual(selected(shared), [
    'demo',
    'lint',
    'unit',
    'unitWeb',
    'build',
    'hygiene',
    'rules',
    'e2e',
  ]);
});

test('PR change collection uses the merge base and retains both sides of renames', () => {
  let invocation;
  const paths = changedPaths('abcdef1', '1234567', (command, args, options) => {
    invocation = { command, args, options };
    return Buffer.from('docs/old-guide.md\0apps/web/src/Guide.jsx\0');
  });

  assert.deepEqual(paths, ['docs/old-guide.md', 'apps/web/src/Guide.jsx']);
  assert.deepEqual(selected(classifyPaths(paths)), [
    'docs',
    'demo',
    'lint',
    'unitWeb',
    'build',
    'hygiene',
    'e2e',
  ]);
  assert.equal(invocation.command, 'git');
  assert.deepEqual(invocation.args, [
    'diff',
    '--name-only',
    '-z',
    '--no-renames',
    'abcdef1...1234567',
  ]);
  assert.deepEqual(invocation.options, { encoding: 'buffer' });
});

test('the documentation and gate jobs retain their required checks', () => {
  const workflowPath = path.resolve(__dirname, '..', '..', '.github', 'workflows', 'ci.yml');
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  const docs = workflow.slice(workflow.indexOf('\n  docs:'), workflow.indexOf('\n  lint:'));

  assert.match(docs, /node --test scripts\/build-pages\.test\.cjs\s+- name: Check generated documentation freshness\s+run: node scripts\/build-pages\.cjs --check/s);
  assert.doesNotMatch(docs, /if \[ -f scripts\/build-pages(?:\.cjs|\.test\.cjs) \]; then/);
  assert.match(workflow, /run: node scripts\/ci\/verify-gate\.cjs/);
  const gate = workflow.slice(workflow.indexOf('\n  gate:'));
  assert.match(gate, /steps:\s+- uses: actions\/checkout@v4\s+- name: Verify the selected CI tiers passed[\s\S]*run: node scripts\/ci\/verify-gate\.cjs/);
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
