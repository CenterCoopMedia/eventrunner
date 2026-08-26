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
    fs.writeFileSync(path.join(root, 'docs', 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    fs.writeFileSync(asset, '');
    fs.writeFileSync(
      entrypoint,
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"><meta name="description" content="Docs"><title>Docs</title><link rel="icon" type="image/svg+xml" href="favicon.svg"></head><body><a href="/eventrunner/docs/admin-guide/">Guide</a></body></html>',
    );
    fs.writeFileSync(
      generated,
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"><meta name="description" content="Guide"><title>Guide</title><link rel="icon" type="image/svg+xml" href="../../favicon.svg"><link rel="canonical" href="https://example.test/eventrunner/docs/admin-guide/"><meta property="og:title" content="Guide"><meta property="og:description" content="Guide"><meta property="og:type" content="website"><meta property="og:url" content="https://example.test/eventrunner/docs/admin-guide/"><meta property="og:image" content="https://example.test/guide.svg"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="Guide"><meta name="twitter:description" content="Guide"><meta name="twitter:image" content="https://example.test/guide.svg"></head><body><script src="/eventrunner/demo/assets/app.js"></script></body></html>',
    );

    assert.deepEqual(checkPages(root), []);
    const resolved = localTargetPath(generated, '/eventrunner/docs/admin-guide/', root);
    assert.equal(resolved.error, undefined);
    assert.equal(resolved.path, path.join(root, 'docs', 'docs', 'admin-guide'));
  });
});

test('generated documentation pages require complete public metadata while the issue 109 demo remains excluded', () => {
  withTempRoot((root) => {
    fs.mkdirSync(path.join(root, 'docs', 'docs', 'guide'), { recursive: true });
    fs.mkdirSync(path.join(root, 'docs', 'demo'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    fs.writeFileSync(
      path.join(root, 'docs', 'index.html'),
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"><meta name="description" content="Docs"><title>Docs</title><link rel="icon" type="image/svg+xml" href="favicon.svg"></head><body></body></html>',
    );
    fs.writeFileSync(path.join(root, 'docs', 'demo', 'index.html'), '<html><body>Demo metadata is owned by issue 109.</body></html>');
    fs.writeFileSync(
      path.join(root, 'docs', 'docs', 'guide', 'index.html'),
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"><meta name="description" content="Guide"><title>Guide</title><link rel="icon" type="image/svg+xml" href="../../favicon.svg"></head><body></body></html>',
    );

    assert.deepEqual(checkPages(root), [
      'docs/docs/guide/index.html: missing canonical',
      'docs/docs/guide/index.html: missing og:title',
      'docs/docs/guide/index.html: missing og:description',
      'docs/docs/guide/index.html: missing og:type',
      'docs/docs/guide/index.html: missing og:url',
      'docs/docs/guide/index.html: missing og:image',
      'docs/docs/guide/index.html: missing twitter:card',
      'docs/docs/guide/index.html: missing twitter:title',
      'docs/docs/guide/index.html: missing twitter:description',
      'docs/docs/guide/index.html: missing twitter:image',
    ]);
  });
});

test('documentation checks reject unsafe and unsupported URL schemes', () => {
  withTempRoot((root) => {
    fs.mkdirSync(path.join(root, 'docs'));
    fs.writeFileSync(path.join(root, 'docs', 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    fs.writeFileSync(
      path.join(root, 'docs', 'index.html'),
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"><meta name="description" content="Docs"><title>Docs</title><link rel="icon" type="image/svg+xml" href="favicon.svg"></head><body><a href="javascript:alert(1)">Bad</a><a href="data:text/plain,unsafe">Data</a><a href="vbscript:msgbox(1)">VB</a><a href="ftp://example.test/file">FTP</a></body></html>',
    );

    assert.deepEqual(checkPages(root), [
      'docs/index.html: javascript:alert(1) (unsupported URL scheme: javascript:)',
      'docs/index.html: data:text/plain,unsafe (unsupported URL scheme: data:)',
      'docs/index.html: vbscript:msgbox(1) (unsupported URL scheme: vbscript:)',
      'docs/index.html: ftp://example.test/file (unsupported URL scheme: ftp:)',
    ]);
    assert.equal(localTargetPath(path.join(root, 'docs', 'index.html'), 'https://example.test/', root), null);
    assert.equal(localTargetPath(path.join(root, 'docs', 'index.html'), 'mailto:ops@example.test', root), null);
  });
});

test('Pages checks reject unsupported root-relative paths', () => {
  withTempRoot((root) => {
    fs.mkdirSync(path.join(root, 'docs'));
    fs.writeFileSync(path.join(root, 'docs', 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    fs.writeFileSync(
      path.join(root, 'docs', 'index.html'),
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"><meta name="description" content="Docs"><title>Docs</title><link rel="icon" type="image/svg+xml" href="favicon.svg"></head><body><script src="/other-site/app.js"></script></body></html>',
    );
    assert.deepEqual(checkPages(root), [
      'docs/index.html: /other-site/app.js (unsupported root-relative path (expected /eventrunner/))',
    ]);
  });
});

test('Pages checks require index.html for relative directory links', () => {
  withTempRoot((root) => {
    fs.mkdirSync(path.join(root, 'docs', 'guide'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    fs.writeFileSync(
      path.join(root, 'docs', 'index.html'),
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"><meta name="description" content="Docs"><title>Docs</title><link rel="icon" type="image/svg+xml" href="favicon.svg"></head><body><a href="guide/">Guide</a></body></html>',
    );

    assert.deepEqual(checkPages(root), ['docs/index.html: missing guide/']);
  });
});
