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

const SITE = 'https://centercoopmedia.github.io/eventrunner/';

// A generated page carrying the full public-metadata set, for the cases where
// its presence is scaffolding rather than the thing under test.
function generatedPage(title, canonical, prefix = '../..') {
  return [
    '<!doctype html><html lang="en"><head>',
    '<meta name="viewport" content="width=device-width">',
    `<meta name="description" content="${title}"><title>${title}</title>`,
    `<link rel="icon" type="image/svg+xml" href="${prefix}/favicon.svg">`,
    `<link rel="canonical" href="${canonical}">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${title}">`,
    '<meta property="og:type" content="website">',
    `<meta property="og:url" content="${canonical}">`,
    `<meta property="og:image" content="${SITE}og-default.png">`,
    '<meta property="og:image:type" content="image/png">',
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    `<meta property="og:image:alt" content="${title}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${title}">`,
    `<meta name="twitter:image" content="${SITE}og-default.png">`,
    `<meta name="twitter:image:alt" content="${title}">`,
    '</head><body>',
  ].join('');
}

// A landing page that satisfies every check, so a test about something else
// is not also re-asserting the metadata list. It brings the documentation hub
// its entry-point link has to reach.
function writeLanding(root, body = '') {
  fs.mkdirSync(path.join(root, 'docs', 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  fs.writeFileSync(
    path.join(root, 'docs', 'docs', 'index.html'),
    `${generatedPage('Documentation', `${SITE}docs/`, '..')}</body></html>`,
  );
  fs.writeFileSync(path.join(root, 'docs', 'index.html'), [
    '<!doctype html><html lang="en"><head>',
    '<meta name="viewport" content="width=device-width">',
    '<meta name="description" content="Event CMS"><title>Docs</title>',
    '<link rel="icon" type="image/svg+xml" href="favicon.svg">',
    `<link rel="canonical" href="${SITE}">`,
    '<meta property="og:type" content="website">',
    '<meta property="og:title" content="Event Runner">',
    '<meta property="og:description" content="Event CMS">',
    `<meta property="og:url" content="${SITE}">`,
    `<meta property="og:image" content="${SITE}og-default.png">`,
    '<meta property="og:image:type" content="image/png">',
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta property="og:image:alt" content="Event Runner">',
    '<meta name="twitter:card" content="summary_large_image">',
    '<meta name="twitter:title" content="Event Runner">',
    '<meta name="twitter:description" content="Event CMS">',
    `<meta name="twitter:image" content="${SITE}og-default.png">`,
    '<meta name="twitter:image:alt" content="Event Runner">',
    '</head><body><a href="./docs/">Documentation</a>',
    body,
    '</body></html>',
  ].join(''));
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
      'docs/index.html: missing canonical',
      'docs/index.html: missing og:title',
      'docs/index.html: missing og:description',
      'docs/index.html: missing og:type',
      'docs/index.html: missing og:url',
      'docs/index.html: missing og:image',
      'docs/index.html: missing og:image:type',
      'docs/index.html: missing og:image:width',
      'docs/index.html: missing og:image:height',
      'docs/index.html: missing og:image:alt',
      'docs/index.html: missing twitter:card',
      'docs/index.html: missing twitter:title',
      'docs/index.html: missing twitter:description',
      'docs/index.html: missing twitter:image',
      'docs/index.html: missing twitter:image:alt',
      'docs/index.html: missing documentation entry point',
    ]);
  });
});

test('Pages checks map the Eventrunner base and scan generated HTML', () => {
  withTempRoot((root) => {
    const generated = path.join(root, 'docs', 'docs', 'admin-guide', 'index.html');
    const asset = path.join(root, 'docs', 'demo', 'assets', 'app.js');
    fs.mkdirSync(path.dirname(generated), { recursive: true });
    fs.mkdirSync(path.dirname(asset), { recursive: true });
    fs.writeFileSync(asset, '');
    writeLanding(root, '<a href="/eventrunner/docs/admin-guide/">Guide</a>');
    fs.writeFileSync(
      generated,
      `${generatedPage('Guide', `${SITE}docs/admin-guide/`)}<script src="/eventrunner/demo/assets/app.js"></script></body></html>`,
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
    writeLanding(root);
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
      'docs/docs/guide/index.html: missing og:image:type',
      'docs/docs/guide/index.html: missing og:image:width',
      'docs/docs/guide/index.html: missing og:image:height',
      'docs/docs/guide/index.html: missing og:image:alt',
      'docs/docs/guide/index.html: missing twitter:card',
      'docs/docs/guide/index.html: missing twitter:title',
      'docs/docs/guide/index.html: missing twitter:description',
      'docs/docs/guide/index.html: missing twitter:image',
      'docs/docs/guide/index.html: missing twitter:image:alt',
    ]);
  });
});

test('documentation checks reject unsafe and unsupported URL schemes', () => {
  withTempRoot((root) => {
    writeLanding(root, '<a href="javascript:alert(1)">Bad</a><a href="data:text/plain,unsafe">Data</a><a href="vbscript:msgbox(1)">VB</a><a href="ftp://example.test/file">FTP</a>');

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
    writeLanding(root, '<script src="/other-site/app.js"></script>');
    assert.deepEqual(checkPages(root), [
      'docs/index.html: /other-site/app.js (unsupported root-relative path (expected /eventrunner/))',
    ]);
  });
});

test('Pages checks require index.html for relative directory links', () => {
  withTempRoot((root) => {
    fs.mkdirSync(path.join(root, 'docs', 'guide'), { recursive: true });
    writeLanding(root, '<a href="guide/">Guide</a>');

    assert.deepEqual(checkPages(root), ['docs/index.html: missing guide/']);
  });
});
