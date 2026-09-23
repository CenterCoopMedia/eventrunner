'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  main,
  readGeneratedSnapshot,
  excludedRoutesFound,
  excludedRouteMessage,
  DEFAULT_GENERATED_DIR,
  NEVER_IN_SITEMAP,
} = require('./write-site-files.cjs');
const { REASONS, readPlaceholderIcons } = require('./lib/app-icons.cjs');
const { decodePng, encodePng } = require('./lib/png.cjs');

const quiet = { log() {}, error() {} };

/** A fake importGenerated: returns canned module exports per filename. */
function fakeImporter(modules) {
  return async (dir, file) => {
    if (!(file in modules)) throw new Error(`fakeImporter: unexpected file ${file} (dir ${dir})`);
    return modules[file];
  };
}

const MODULES = {
  'organizationsData.js': { organizationsData: [{ id: 'beacon', visible: true }] },
  'eventConfig.js': {
    eventConfig: { name: 'Harborlight Summit', shortName: 'HARBOR' },
    features: { schedule: true, speakers: true, sponsors: true, attendeeDirectory: true, updates: false },
    theme: {},
  },
  'pagesData.js': {
    pagesData: [
      { id: 'home', path: '/', order: 0, visible: true, systemPage: true },
      { id: 'schedule', path: '/schedule', order: 1, visible: true, systemPage: true },
      { id: 'travel', path: '/travel', order: 4, visible: true, systemPage: false },
    ],
  },
  'scheduleData.js': {
    scheduleData: [{ id: 'keynote', visible: true }],
    speakers: [{ slug: 'rae-okonkwo' }],
  },
};

// --- readGeneratedSnapshot ---------------------------------------------------

test('readGeneratedSnapshot maps the generated files into buildSiteArtifacts shape', async () => {
  const snapshot = await readGeneratedSnapshot({ generatedDir: '/fake', importModule: fakeImporter(MODULES) });
  assert.equal(snapshot.event.name, 'Harborlight Summit');
  assert.equal(snapshot.features.schedule, true);
  assert.deepEqual(snapshot.theme, {});
  assert.equal(snapshot.pages.length, 3);
  assert.deepEqual(snapshot.sessions, [{ id: 'keynote', visible: true }]);
  assert.deepEqual(snapshot.speakers, [{ slug: 'rae-okonkwo' }]);
  assert.deepEqual(snapshot.organizations, [{ id: 'beacon', visible: true }]);
  // cmsUpdates has no build-time snapshot at all — see the module docstring.
  assert.deepEqual(snapshot.updates, []);
});

test('readGeneratedSnapshot tolerates a scheduleData.js with no speakers export', async () => {
  const modules = { ...MODULES, 'scheduleData.js': { scheduleData: [] } };
  const snapshot = await readGeneratedSnapshot({ generatedDir: '/fake', importModule: fakeImporter(modules) });
  assert.deepEqual(snapshot.speakers, []);
});

test('the default generated directory is the committed demo snapshot', () => {
  assert.match(DEFAULT_GENERATED_DIR, /apps[\\/]web[\\/]src[\\/]generated$/);
});

// --- main(): argv validation --------------------------------------------------

test('--dist is required', async () => {
  const code = await main(['--public-url', 'https://example.org'], { log: quiet });
  assert.equal(code, 2);
});

test('--public-url is required', async () => {
  const code = await main(['--dist', '/tmp/x'], { log: quiet });
  assert.equal(code, 2);
});

test('an unknown flag is refused', async () => {
  const code = await main(['--dist', '/tmp/x', '--public-url', 'https://example.org', '--bogus'], { log: quiet });
  assert.equal(code, 2);
});

test('--help prints usage and exits 0 without requiring the other flags', async () => {
  const lines = [];
  const code = await main(['--help'], { log: { log: (l) => lines.push(l), error: () => {} } });
  assert.equal(code, 0);
  assert.match(lines.join('\n'), /Usage: node scripts\/write-site-files\.cjs/);
});

test('a snapshot read failure is reported and exits 3, not 1', async () => {
  const code = await main(
    ['--dist', '/tmp/x', '--public-url', 'https://example.org', '--generated', '/does/not/exist'],
    { importModule: async () => { throw new Error('ENOENT'); }, log: quiet },
  );
  assert.equal(code, 3);
});

// --- main(): end to end, against a real (fixture) generated directory --------

/**
 * A real fixture directory with tiny, real ES module files, so this
 * exercises the actual `import()` mechanism this script depends on, not
 * only the injected-importer unit tests above.
 */
function writeFixtureGeneratedDir({ theme = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'write-site-files-fixture-'));
  fs.writeFileSync(
    path.join(dir, 'eventConfig.js'),
    "export const eventConfig = { name: 'Fixture Event', shortName: 'FIX' };\n"
    + "export const features = { schedule: true, speakers: true, sponsors: true, attendeeDirectory: true, updates: false };\n"
    + `export const theme = ${JSON.stringify(theme)};\n`,
  );
  fs.writeFileSync(
    path.join(dir, 'pagesData.js'),
    'export const pagesData = ['
    + "{ id: 'home', path: '/', order: 0, visible: true, systemPage: true },"
    + "{ id: 'schedule', path: '/schedule', order: 1, visible: true, systemPage: true },"
    + "{ id: 'sponsors', path: '/sponsors', order: 3, visible: true, systemPage: true },"
    + '];\n',
  );
  fs.writeFileSync(
    path.join(dir, 'scheduleData.js'),
    "export const scheduleData = [{ id: 'keynote', visible: true }];\n"
    + "export const speakers = [{ slug: 'rae-okonkwo' }];\n",
  );
  fs.writeFileSync(path.join(dir, 'organizationsData.js'), "export const organizationsData = [{ id: 'beacon', visible: true }];\n");
  return dir;
}

test('a full run reads a real generated directory and writes all three files', async () => {
  const generatedDir = writeFixtureGeneratedDir();
  const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'write-site-files-dist-'));
  try {
    const code = await main(
      ['--dist', distDir, '--public-url', 'https://example.org', '--generated', generatedDir],
      { log: quiet },
    );
    assert.equal(code, 0);

    const sitemap = fs.readFileSync(path.join(distDir, 'sitemap.xml'), 'utf8');
    assert.match(sitemap, /<loc>https:\/\/example\.org\/<\/loc>/);
    assert.match(sitemap, /<loc>https:\/\/example\.org\/schedule<\/loc>/);
    assert.match(sitemap, /<loc>https:\/\/example\.org\/sponsors\/beacon<\/loc>/);

    const robots = fs.readFileSync(path.join(distDir, 'robots.txt'), 'utf8');
    assert.match(robots, /^Sitemap: https:\/\/example\.org\/sitemap\.xml$/m);

    const manifest = JSON.parse(fs.readFileSync(path.join(distDir, 'manifest.webmanifest'), 'utf8'));
    assert.equal(manifest.name, 'Fixture Event');
    assert.equal(manifest.start_url, './');
    assertCommittedIcons(distDir);
  } finally {
    fs.rmSync(generatedDir, { recursive: true, force: true });
    fs.rmSync(distDir, { recursive: true, force: true });
  }
});

test('a real run against the committed demo snapshot (no --generated) succeeds', async () => {
  const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'write-site-files-demo-'));
  try {
    const code = await main(['--dist', distDir, '--public-url', 'https://example.org'], { log: quiet });
    assert.equal(code, 0);
    assert.ok(fs.existsSync(path.join(distDir, 'sitemap.xml')));
    assert.ok(fs.existsSync(path.join(distDir, 'robots.txt')));
    assert.ok(fs.existsSync(path.join(distDir, 'manifest.webmanifest')));
    // The demo keeps the seeded mark, so it ships the placeholder icons.
    assertCommittedIcons(distDir);
  } finally {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
});

// --- the two app icons ---------------------------------------------------------

const UPLOADED_MARK = 'branding/a1b2c3/square-icon.png';
const BUCKET = 'demo-run-of-show.appspot.com';

/** Run main() against a fixture snapshot; returns the dist dir and the log. */
async function runWithTheme(t, theme, extraArgs = [], deps = {}) {
  const generatedDir = writeFixtureGeneratedDir({ theme });
  const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'write-site-files-icons-'));
  t.after(() => {
    fs.rmSync(generatedDir, { recursive: true, force: true });
    fs.rmSync(distDir, { recursive: true, force: true });
  });
  const lines = [];
  const code = await main(
    ['--dist', distDir, '--public-url', 'https://example.org', '--generated', generatedDir, ...extraArgs],
    { log: { log: (line) => lines.push(line), error: (line) => lines.push(line) }, ...deps },
  );
  assert.equal(code, 0, lines.join('\n'));
  const manifest = JSON.parse(fs.readFileSync(path.join(distDir, 'manifest.webmanifest'), 'utf8'));
  return { distDir, lines, manifest };
}

const neverFetch = () => { throw new Error('fetch must not be called'); };

function assertCommittedIcons(distDir) {
  for (const file of readPlaceholderIcons()) {
    assert.ok(fs.readFileSync(path.join(distDir, file.path)).equals(file.bytes), `${file.path} is the committed file`);
  }
}

test('a run writes both placeholder icons, byte for byte, and the manifest lists them as maskable', async (t) => {
  const { distDir, lines, manifest } = await runWithTheme(
    t, { logos: { mark: 'branding/mark.svg' } }, [], { fetchImpl: neverFetch },
  );
  assertCommittedIcons(distDir);
  assert.deepEqual(manifest.icons.map((icon) => [icon.src, icon.sizes, icon.purpose]), [
    ['branding/app-icon-192.png', '192x192', 'any maskable'],
    ['branding/app-icon-512.png', '512x512', 'any maskable'],
  ]);
  assert.ok(lines.includes(`app icons: neutral placeholder: ${REASONS.placeholder}`));
});

test('no --storage-bucket never fetches an uploaded mark, and says so', async (t) => {
  const { distDir, lines } = await runWithTheme(t, { logos: { mark: UPLOADED_MARK } }, [], { fetchImpl: neverFetch });
  assertCommittedIcons(distDir);
  assert.ok(lines.includes(`app icons: neutral placeholder: ${REASONS.noBucket}`));
});

test('an empty --storage-bucket gives the placeholder with the no-bucket reason', async (t) => {
  const { distDir, lines } = await runWithTheme(
    t, { logos: { mark: UPLOADED_MARK } }, ['--storage-bucket='], { fetchImpl: neverFetch },
  );
  assertCommittedIcons(distDir);
  assert.ok(lines.includes('app icons: neutral placeholder: no storage bucket was given'));
});

test('--storage-bucket with an uploaded square PNG writes resampled icons listed for purpose any', async (t) => {
  const upload = encodePng({ width: 600, height: 600, rgba: Buffer.alloc(600 * 600 * 4, 128) });
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(upload, { status: 200 });
  };
  const { distDir, lines, manifest } = await runWithTheme(
    t, { logos: { mark: UPLOADED_MARK } }, ['--storage-bucket', BUCKET], { fetchImpl },
  );
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/demo-run-of-show\.appspot\.com\/o\/branding%2Fa1b2c3%2Fsquare-icon\.png\?alt=media$/);
  assert.equal(calls[0].init.redirect, 'error');
  for (const size of [192, 512]) {
    const icon = decodePng(fs.readFileSync(path.join(distDir, 'branding', `app-icon-${size}.png`)));
    assert.equal(icon.width, size);
    assert.equal(icon.height, size);
  }
  assert.deepEqual(manifest.icons.map((icon) => icon.purpose), ['any', 'any']);
  assert.ok(lines.includes(`app icons: from the square icon slot (${UPLOADED_MARK})`));
});

test('an upload that fails to download still ships the placeholder and exits 0', async (t) => {
  const { distDir, lines, manifest } = await runWithTheme(
    t, { logos: { mark: UPLOADED_MARK } }, ['--storage-bucket', BUCKET],
    { fetchImpl: async () => new Response('gone', { status: 404 }) },
  );
  assertCommittedIcons(distDir);
  assert.equal(manifest.icons[0].purpose, 'any maskable');
  assert.ok(lines.includes('app icons: neutral placeholder: the square icon could not be downloaded (HTTP 404)'));
});

test('the usage names --storage-bucket', async () => {
  const lines = [];
  await main(['--help'], { log: { log: (l) => lines.push(l), error: () => {} } });
  assert.match(lines.join('\n'), /--storage-bucket <name>/);
});

// --- the specimen book stays out of the sitemap ------------------------------

test('the review-only route list names the specimen book', () => {
  assert.deepEqual([...NEVER_IN_SITEMAP], ['/specimen']);
});

test('a clean sitemap reports no excluded route', () => {
  const xml = [
    '<urlset>',
    '  <url><loc>https://example.org/</loc></url>',
    '  <url><loc>https://example.org/schedule</loc></url>',
    '</urlset>',
  ].join('\n');
  assert.deepEqual(excludedRoutesFound(xml), []);
});

test('a sitemap that lists the specimen book is refused', () => {
  const xml = '<urlset><url><loc>https://example.org/specimen</loc></url></urlset>';
  assert.deepEqual(excludedRoutesFound(xml), ['/specimen']);
});

test('a sitemap that lists a page under the specimen book is refused too', () => {
  const xml = '<urlset><url><loc>https://example.org/specimen/type</loc></url></urlset>';
  assert.deepEqual(excludedRoutesFound(xml), ['/specimen']);
});

test('a page whose path merely starts with the same letters is allowed', () => {
  const xml = '<urlset><url><loc>https://example.org/specimens-of-the-year</loc></url></urlset>';
  assert.deepEqual(excludedRoutesFound(xml), []);
});

test('a refused route no page holds says what to remove instead', () => {
  // The sitemap is built from pages, sessions, speakers and updates. A
  // route that reached it from one of the other three has no page path to
  // rename, so the message says the one thing that is still true.
  const message = excludedRouteMessage(['/specimen'], []);
  assert.match(message, /reserved for the specimen book/u);
  assert.match(message, /Remove it from the route source/u);
});

test('the refusal names the reserved segment and the page that took it', async (t) => {
  // An operator reading this message has to know two things: that the
  // segment belongs to the specimen book, and which of their own pages is
  // sitting on it. Without the page path there is nothing to rename.
  const generatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'write-site-files-clash-'));
  const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'write-site-files-clash-dist-'));
  t.after(() => {
    fs.rmSync(generatedDir, { recursive: true, force: true });
    fs.rmSync(distDir, { recursive: true, force: true });
  });
  fs.writeFileSync(
    path.join(generatedDir, 'eventConfig.js'),
    "export const eventConfig = { name: 'Fixture Event', shortName: 'FIX' };\n"
    + 'export const features = { schedule: false, speakers: false, sponsors: false, '
    + 'attendeeDirectory: false, updates: false };\n'
    + 'export const theme = {};\n',
  );
  fs.writeFileSync(
    path.join(generatedDir, 'pagesData.js'),
    'export const pagesData = ['
    + "{ id: 'home', path: '/', order: 0, visible: true, systemPage: true },"
    + "{ id: 'specimen', path: '/specimen', order: 4, visible: true, systemPage: false },"
    + '];\n',
  );
  fs.writeFileSync(
    path.join(generatedDir, 'scheduleData.js'),
    'export const scheduleData = [];\nexport const speakers = [];\n',
  );

  fs.writeFileSync(path.join(generatedDir, 'organizationsData.js'), 'export const organizationsData = [];\n');
  const errors = [];
  const code = await main(
    ['--dist', distDir, '--public-url', 'https://example.org', '--generated', generatedDir],
    { log: { log() {}, error: (line) => errors.push(line) } },
  );
  assert.equal(code, 4);
  const message = errors.join('\n');
  assert.match(message, /reserved for the specimen book/u);
  assert.match(message, /\/specimen/u);
  // A refused sitemap writes nothing, the app icons included.
  assert.deepEqual(fs.readdirSync(distDir), []);
});

test('the demo snapshot writes a sitemap that does not list the specimen book', async (t) => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'write-site-files-specimen-'));
  t.after(() => fs.rmSync(dist, { recursive: true, force: true }));
  const code = await main(
    ['--dist', dist, '--public-url', 'https://example.org'],
    { log: quiet },
  );
  assert.equal(code, 0);
  const sitemap = fs.readFileSync(path.join(dist, 'sitemap.xml'), 'utf8');
  assert.equal(sitemap.includes('/specimen'), false);
});
