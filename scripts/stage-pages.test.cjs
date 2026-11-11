'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { stagePages } = require('./stage-pages.cjs');
const { PUBLIC_HTML_FILES, isPublicFile } = require('./lib/pages-public-files.cjs');

function withSite(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-pages-'));
  const write = (relative, text = 'fixture') => {
    const file = path.join(root, 'docs', relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  try {
    for (const file of [...PUBLIC_HTML_FILES, 'demo/index.html']) write(file);
    fn(root, write);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('the upload contains the website and demo while source records stay in the repository', () => {
  withSite((root, write) => {
    const assets = ['.nojekyll', 'tokens.css', 'site.js', 'docs-ui.js', 'favicon.svg',
      'fonts/source-sans-3-latin.woff2', 'fonts/README.md', 'assets/event-preview.webp',
      'videos/publish-page-landscape.mp4', 'videos/publish-page-transcript.md',
      'demo/assets/app.js'];
    const sourceFiles = ['adr/0001-event-platform-v1.md', 'DEPLOY_RUNBOOK.md',
      'operator/archive-handoff.md', 'handbook/overview.md', 'plans/new-plan.md',
      'pr-evidence/new-capture.png', 'testing/new-check.html', 'new-private-notes.md', 'new-source-script.js',
      'docs/unlisted-engineering-page/index.html', 'assets/source-notes.md'];
    for (const file of [...assets, ...sourceFiles]) write(file);
    const { output, files } = stagePages({ root });
    for (const file of [...PUBLIC_HTML_FILES, ...assets]) {
      assert.ok(files.includes(file), `missing public file: ${file}`);
      assert.ok(fs.existsSync(path.join(output, file)), file);
    }
    for (const file of sourceFiles) {
      assert.ok(!fs.existsSync(path.join(output, file)), `source record was published: ${file}`);
      assert.ok(fs.existsSync(path.join(root, 'docs', file)), `source record was removed: ${file}`);
    }
  });
});

test('an incomplete demo does not replace the last staged artifact', () => {
  withSite((root) => {
    const { output } = stagePages({ root });
    fs.writeFileSync(path.join(output, 'keep.txt'), 'previous artifact');
    fs.rmSync(path.join(root, 'docs', 'demo', 'index.html'));
    assert.throws(() => stagePages({ root }), /incomplete.*demo\/index\.html/);
    assert.equal(fs.readFileSync(path.join(output, 'keep.txt'), 'utf8'), 'previous artifact');
  });
});

test('a restage drops files that no longer belong in the public artifact', () => {
  withSite((root) => {
    const { output } = stagePages({ root });
    fs.mkdirSync(path.join(output, 'adr'));
    fs.writeFileSync(path.join(output, 'adr', 'old-record.md'), 'old upload');
    stagePages({ root });
    assert.ok(!fs.existsSync(path.join(output, 'adr')));
  });
});

test('staging refuses symlinks and paths that escape the public source tree', () => {
  for (const name of ['../index.html', '/index.html', 'assets/../../private.svg', 'assets\\..\\secret.svg']) {
    assert.equal(isPublicFile(name), false, name);
  }
  withSite((root) => {
    fs.symlinkSync(path.join(root, 'docs', 'index.html'), path.join(root, 'docs', 'linked.html'));
    assert.throws(() => stagePages({ root }), /symbolic link/);
    assert.ok(!fs.existsSync(path.join(root, 'dist', 'pages')));
  });
});
