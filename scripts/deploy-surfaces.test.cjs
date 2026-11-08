'use strict';

// .github/deploy-surfaces.json says which paths need which deploy. Two
// readers share it: deploy-client.yml's paths filter, and Oathgate's
// `eventrunner needs-deploy` (jamditis/jawn-ops), which implements only the
// small glob grammar checked here. A pattern outside that grammar would be
// read differently by the two, so it fails this test first.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const surfaces = JSON.parse(fs.readFileSync(path.join(root, '.github/deploy-surfaces.json'), 'utf8'));

const SEGMENT = '[A-Za-z0-9._@-]+';
// A literal path, `dir/**` (anything under dir/), or one `*` in the last segment.
const GLOB_RE = new RegExp(`^(?:${SEGMENT}/)*(?:${SEGMENT}|\\*\\*|[A-Za-z0-9._@-]*\\*[A-Za-z0-9._@-]*)$`);

test('the surfaces file has exactly the four surfaces Oathgate maps environments to', () => {
  assert.deepEqual(Object.keys(surfaces), ['functions', 'web', 'rules', 'console']);
  for (const [name, globs] of Object.entries(surfaces)) {
    assert.ok(Array.isArray(globs) && globs.length > 0, name);
    assert.equal(new Set(globs).size, globs.length, `${name} has a duplicate`);
  }
});

test('every pattern uses the shared glob grammar and names a path that exists', () => {
  for (const [name, globs] of Object.entries(surfaces)) {
    for (const glob of globs) {
      assert.match(glob, GLOB_RE, `${name}: ${glob}`);
      assert.ok(!glob.includes('**') || glob.endsWith('/**'), `${name}: ** only as the last segment: ${glob}`);
      const fixed = glob.endsWith('/**') ? glob.slice(0, -3) : glob.includes('*') ? path.dirname(glob) : glob;
      assert.ok(fs.existsSync(path.join(root, fixed)), `${name}: ${glob} names nothing in the repository`);
    }
  }
});

test('the client deploy reads its functions filter from the surfaces file, with the same paths as before', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/deploy-client.yml'), 'utf8');
  assert.match(workflow, /uses: dorny\/paths-filter@v3[\s\S]*?filters: \.github\/deploy-surfaces\.json/);
  assert.deepEqual(surfaces.functions, [
    'functions/**', 'packages/shared/**', 'package-lock.json', 'firebase.json',
    'scripts/prepare-functions.cjs', '.github/workflows/deploy-client.yml',
  ]);
});
