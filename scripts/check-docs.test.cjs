'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { checkMarkdownLinks, checkPages, checkRepository, localTargetPath } = require('./check-docs.cjs');

const REPO_ROOT = path.resolve(__dirname, '..');

function withTempRoot(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-docs-test-'));
  try {
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('the repository documentation passes link and Pages checks', () => {
  assert.deepEqual(checkRepository(REPO_ROOT), []);
});

test('missing relative Markdown targets are reported', () => {
  withTempRoot((root) => {
    fs.writeFileSync(path.join(root, 'README.md'), '[missing](missing.md)\n');
    assert.deepEqual(checkMarkdownLinks(root), ['README.md: missing missing.md']);
  });
});

test('missing reference-style Markdown targets are reported through their definitions', () => {
  withTempRoot((root) => {
    fs.writeFileSync(
      path.join(root, 'README.md'),
      'Read the [staff guide][guide].\n\n[guide]: handbook/missing.md\n',
    );

    assert.deepEqual(checkMarkdownLinks(root), ['README.md: missing handbook/missing.md']);
  });
});

test('local task and agent-state notes are outside the published documentation scope', () => {
  withTempRoot((root) => {
    for (const directory of ['tasks', '.claude']) {
      fs.mkdirSync(path.join(root, directory));
      fs.writeFileSync(path.join(root, directory, 'private.md'), '[missing](missing.md)\n');
    }

    assert.deepEqual(checkMarkdownLinks(root), []);
  });
});

test('Pages markup checks report missing required metadata', () => {
  withTempRoot((root) => {
    fs.mkdirSync(path.join(root, 'docs'));
    fs.writeFileSync(
      path.join(root, 'docs', 'index.html'),
      '<html><head><title>Example</title></head><body></body></html>',
    );
    assert.deepEqual(checkPages(root), [
      'docs/index.html: missing doctype',
      'docs/index.html: missing language',
      'docs/index.html: missing viewport',
      'docs/index.html: missing description',
      'docs/index.html: missing favicon',
    ]);
  });
});

test('Pages checks map the Eventrunner base and scan generated HTML', () => {
  withTempRoot((root) => {
    const entrypoint = path.join(root, 'docs', 'index.html');
    const generated = path.join(root, 'docs', 'docs', 'admin-guide', 'index.html');
    const asset = path.join(root, 'docs', 'demo', 'assets', 'app.js');
    fs.mkdirSync(path.dirname(generated), { recursive: true });
    fs.mkdirSync(path.dirname(asset), { recursive: true });
    fs.writeFileSync(asset, '');
    fs.writeFileSync(
      entrypoint,
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"><meta name="description" content="Docs"><title>Docs</title><link rel="icon" href="data:image/svg+xml,%3Csvg%3E%3C/svg%3E"></head><body><a href="/eventrunner/docs/admin-guide/">Guide</a></body></html>',
    );
    fs.writeFileSync(
      generated,
      '<!doctype html><html lang="en"><head><title>Guide</title></head><body><script src="/eventrunner/demo/assets/app.js"></script></body></html>',
    );

    assert.deepEqual(checkPages(root), []);
    const resolved = localTargetPath(generated, '/eventrunner/docs/admin-guide/', root);
    assert.equal(resolved.error, undefined);
    assert.equal(resolved.path, path.join(root, 'docs', 'docs', 'admin-guide'));
  });
});

test('Pages checks reject unsupported root-relative paths', () => {
  withTempRoot((root) => {
    fs.mkdirSync(path.join(root, 'docs'));
    fs.writeFileSync(
      path.join(root, 'docs', 'index.html'),
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"><meta name="description" content="Docs"><title>Docs</title><link rel="icon" href="data:image/svg+xml,%3Csvg%3E%3C/svg%3E"></head><body><script src="/other-site/app.js"></script></body></html>',
    );
    assert.deepEqual(checkPages(root), [
      'docs/index.html: /other-site/app.js (unsupported root-relative path (expected /eventrunner/))',
    ]);
  });
});

test('Pages checks require index.html for relative directory links', () => {
  withTempRoot((root) => {
    fs.mkdirSync(path.join(root, 'docs', 'guide'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'docs', 'index.html'),
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"><meta name="description" content="Docs"><title>Docs</title><link rel="icon" href="data:image/svg+xml,%3Csvg%3E%3C/svg%3E"></head><body><a href="guide/">Guide</a></body></html>',
    );

    assert.deepEqual(checkPages(root), ['docs/index.html: missing guide/']);
  });
});
