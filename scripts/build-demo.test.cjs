'use strict';

// Argument handling for the static demo build (scripts/build-demo.cjs).
// The build itself is a vite invocation and is exercised by running it; what
// is worth pinning here is the two guards that make the script safe to run
// unattended — the trailing-slash normalization Vite silently depends on, and
// the refusal to delete anything outside the repository — plus the pure
// directory-diff logic --check is built on (issue #94). The end-to-end
// "does --check actually catch drift" case is exercised by running the CLI
// for real; see the ci.yml `demo` job and RELEASING.md for that evidence.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  parseArgs,
  resolveOutDir,
  compareDirs,
  listFilesRecursive,
  DEFAULT_BASE,
  DEFAULT_OUT,
  DEMO_FIREBASE_ENV,
  UsageError,
} = require('./build-demo.cjs');

const REPO_ROOT = path.resolve(__dirname, '..');

test('defaults target the Pages subpath and docs/demo', () => {
  const options = parseArgs([]);
  assert.equal(options.base, DEFAULT_BASE);
  assert.equal(options.out, DEFAULT_OUT);
  assert.equal(options.dryRun, false);
  assert.ok(DEFAULT_BASE.endsWith('/'));
});

test('a base without a trailing slash is normalized', () => {
  assert.equal(parseArgs(['--base', '/run-of-show/demo']).base, '/run-of-show/demo/');
  assert.equal(parseArgs(['--base=/x']).base, '/x/');
});

test('--out and --dry-run parse in both forms', () => {
  assert.equal(parseArgs(['--out', 'docs/preview']).out, 'docs/preview');
  assert.equal(parseArgs(['--out=docs/preview']).out, 'docs/preview');
  assert.equal(parseArgs(['--dry-run']).dryRun, true);
});

test('unknown arguments and missing values are usage errors', () => {
  assert.throws(() => parseArgs(['--nope']), UsageError);
  assert.throws(() => parseArgs(['--out']), UsageError);
  assert.throws(() => parseArgs(['--base', '--dry-run']), UsageError);
});

test('the output directory must be inside the repository', () => {
  assert.equal(resolveOutDir('docs/demo'), path.join(REPO_ROOT, 'docs', 'demo'));
  assert.throws(() => resolveOutDir('/tmp/anywhere'), UsageError);
  assert.throws(() => resolveOutDir('../outside'), UsageError);
  // The repository root itself would be an rm -rf of the checkout.
  assert.throws(() => resolveOutDir('.'), UsageError);
});

test('the placeholder Firebase env carries no real credential', () => {
  const values = Object.values(DEMO_FIREBASE_ENV).join(' ');
  assert.match(values, /demo/);
  assert.doesNotMatch(values, /AIza/); // shape of a real web API key
  assert.equal(DEMO_FIREBASE_ENV.VITE_FIREBASE_PROJECT_ID, 'demo-run-of-show');
});

test('--check parses as a boolean flag, off by default', () => {
  assert.equal(parseArgs([]).check, false);
  assert.equal(parseArgs(['--check']).check, true);
  assert.equal(parseArgs(['--check', '--dry-run']).check, true);
});

function withTempDirs(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'build-demo-compare-test-'));
  const a = path.join(root, 'a');
  const b = path.join(root, 'b');
  fs.mkdirSync(a, { recursive: true });
  fs.mkdirSync(b, { recursive: true });
  try {
    fn(a, b);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('compareDirs: identical trees (incl. nested dirs) drift-free', () => {
  withTempDirs((a, b) => {
    fs.mkdirSync(path.join(a, 'assets'));
    fs.mkdirSync(path.join(b, 'assets'));
    fs.writeFileSync(path.join(a, 'index.html'), '<html></html>');
    fs.writeFileSync(path.join(b, 'index.html'), '<html></html>');
    fs.writeFileSync(path.join(a, 'assets', 'app-abc123.js'), 'console.log(1)');
    fs.writeFileSync(path.join(b, 'assets', 'app-abc123.js'), 'console.log(1)');

    const result = compareDirs(a, b);
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.extra, []);
    assert.deepEqual(result.differing, []);
    assert.deepEqual(result.drifted, []);
  });
});

test('compareDirs: detects a changed file (edited source, stale commit)', () => {
  withTempDirs((a, b) => {
    fs.writeFileSync(path.join(a, 'index.html'), 'old content');
    fs.writeFileSync(path.join(b, 'index.html'), 'new content');

    const result = compareDirs(a, b);
    assert.deepEqual(result.differing, ['index.html']);
    assert.equal(result.drifted.length, 1);
    assert.match(result.drifted[0], /^changed:\s+index\.html$/);
  });
});

test('compareDirs: detects a renamed content-hashed asset as missing + extra', () => {
  withTempDirs((a, b) => {
    fs.mkdirSync(path.join(a, 'assets'));
    fs.mkdirSync(path.join(b, 'assets'));
    fs.writeFileSync(path.join(a, 'assets', 'app-oldhash.js'), 'console.log(1)');
    fs.writeFileSync(path.join(b, 'assets', 'app-newhash.js'), 'console.log(2)');

    const result = compareDirs(a, b);
    assert.deepEqual(result.missing, ['assets/app-oldhash.js']);
    assert.deepEqual(result.extra, ['assets/app-newhash.js']);
    assert.equal(result.drifted.length, 2);
  });
});

test('compareDirs: binary-safe (does not compare as utf8 text)', () => {
  withTempDirs((a, b) => {
    const bytes = Buffer.from([0x00, 0xff, 0x10, 0x80]);
    fs.writeFileSync(path.join(a, 'font.woff2'), bytes);
    fs.writeFileSync(path.join(b, 'font.woff2'), Buffer.from(bytes));

    const result = compareDirs(a, b);
    assert.deepEqual(result.drifted, []);
  });
});

test('listFilesRecursive: nested paths use forward slashes, missing dir is empty', () => {
  withTempDirs((a) => {
    fs.mkdirSync(path.join(a, 'nested', 'deeper'), { recursive: true });
    fs.writeFileSync(path.join(a, 'nested', 'deeper', 'f.txt'), 'x');

    assert.deepEqual(listFilesRecursive(a), ['nested/deeper/f.txt']);
    assert.deepEqual(listFilesRecursive(path.join(a, 'does-not-exist')), []);
  });
});
