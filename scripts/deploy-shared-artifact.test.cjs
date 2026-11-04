'use strict';

// The client deploy packs the vendored shared tarballs once and hands them
// to later jobs as an artifact. Those jobs run a root `npm ci`, which
// installs every workspace, so each tarball a workspace depends on must be
// in the artifact and land back at its own path.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/deploy-client.yml'), 'utf8');
const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

function vendoredTarballs() {
  const found = [];
  for (const workspace of rootPkg.workspaces) {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, workspace, 'package.json'), 'utf8'));
    for (const spec of Object.values({ ...pkg.dependencies, ...pkg.devDependencies })) {
      const match = /^file:\.\/(vendor\/.+\.tgz)$/.exec(spec);
      if (match) found.push(`${workspace}/${match[1]}`);
    }
  }
  return found.sort();
}

/** Each upload-artifact or download-artifact step of the shared tarball artifact. */
function artifactSteps(action) {
  const steps = workflow.split(/\n\s+- (?=uses: )/).filter((step) => step.startsWith(`uses: actions/${action}`));
  return steps.filter((step) => step.includes('name: shared-tgz-'));
}

test('the deploy artifact carries every vendored tarball a workspace installs', () => {
  const tarballs = vendoredTarballs();
  assert.ok(tarballs.includes('functions/vendor/shared.tgz'));
  assert.ok(tarballs.includes('console/functions/vendor/shared.tgz'));
  const [upload] = artifactSteps('upload-artifact');
  assert.ok(upload, 'the shared job uploads the tarballs');
  for (const tarball of tarballs) assert.ok(upload.includes(tarball), `${tarball} is uploaded`);
});

test('every job restores the tarballs at the repository root, so each lands at its own path', () => {
  const downloads = artifactSteps('download-artifact');
  assert.ok(downloads.length >= 3);
  for (const step of downloads) assert.match(step, /\n\s+path: \.$/m, step);
});
