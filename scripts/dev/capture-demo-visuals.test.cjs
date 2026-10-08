'use strict';

// Pure helpers and a loopback HTTP fixture only. No browser is launched.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const load = () => import(pathToFileURL(path.join(__dirname, 'capture-demo-visuals.mjs')).href);
const sourceSha = 'a'.repeat(40);
const treeSha = 'b'.repeat(40);
const blobSha = 'c'.repeat(40);
const local = 'http://127.0.0.1:12345';

test('the 51-image matrix covers breakpoints, all themes on phone/desktop, and five interaction states', async () => {
  const { captureMatrix, WIDTHS, HEIGHT, captureName } = await load();
  const { THEME_PRESET_IDS } = require('shared/theme');
  assert.deepEqual([...WIDTHS], [485, 639, 640, 1165]);
  assert.equal(HEIGHT, 900);
  const before = captureMatrix('before');
  const after = captureMatrix('after');
  assert.equal(before.length, 12);
  assert.equal(after.length, 39);
  assert.equal(before.length + after.length, 51);
  for (const matrix of [before, after]) {
    assert.equal(new Set(matrix.map(captureName)).size, matrix.length);
    for (const width of WIDTHS) for (const presentation of ['ordinary', 'preview']) {
      assert.equal(matrix.filter((shot) => shot.route === 'program' && shot.width === width && shot.preset === 'newsroom' && shot.mode === 'light' && shot.presentation === presentation && shot.state === 'default').length, 1);
    }
    assert.deepEqual(matrix.filter((shot) => shot.route === 'home').map((shot) => [shot.width, shot.preset, shot.mode, shot.presentation]), WIDTHS.map((width) => [width, 'newsroom', 'light', 'ordinary']));
  }
  for (const width of [485, 1165]) for (const preset of THEME_PRESET_IDS) for (const mode of ['light', 'dark']) {
    assert.equal(after.filter((shot) => shot.route === 'program' && shot.width === width && shot.preset === preset && shot.mode === mode && shot.presentation === 'ordinary' && shot.state === 'default').length, 1);
  }
  assert.deepEqual(after.filter((shot) => shot.state !== 'default').map((shot) => [shot.width, shot.state]), [
    [485, 'menu-open'], [485, 'demo-settings-open'], [485, 'filters-open'], [485, 'no-results'], [1165, 'no-results'],
  ]);
  assert.throws(() => captureMatrix('unknown'), /Unknown capture source/);
});

test('each preview immediately follows its ordinary capture and URL stays a local hash route', async () => {
  const { captureMatrix, captureUrl } = await load();
  for (const source of ['before', 'after']) {
    const matrix = captureMatrix(source);
    for (const [index, shot] of matrix.entries()) {
      if (shot.presentation === 'preview') assert.deepEqual({ ...shot, presentation: 'ordinary' }, matrix[index - 1]);
    }
  }
  const matrix = captureMatrix('after');
  assert.equal(captureUrl(local, matrix[0]), `${local}/eventrunner/demo/?style=newsroom&mode=light#/`);
  assert.equal(captureUrl(local, matrix[1]), `${local}/eventrunner/demo/?style=newsroom&mode=light#/schedule`);
});

test('CLI requires a full base SHA for PRs and makes manual after-only plans explicit', async () => {
  const { parseArgs } = await load();
  assert.equal(parseArgs(['--plan'], {}).base, null);
  assert.equal(parseArgs(['--plan', '--base', sourceSha], {}).base, sourceSha);
  assert.equal(parseArgs(['--out', '/tmp/evidence'], { GITHUB_EVENT_NAME: 'pull_request', DEMO_VISUAL_BASE_SHA: sourceSha }).base, sourceSha);
  assert.throws(() => parseArgs(['--plan'], { GITHUB_EVENT_NAME: 'pull_request' }), /requires its base SHA/);
  for (const base of ['main', '--upload-pack=bad', 'aaaa', `${sourceSha}:docs/demo`]) {
    assert.throws(() => parseArgs(['--base', base, '--plan'], {}));
  }
  assert.throws(() => parseArgs([], {}), /--out/);
  assert.throws(() => parseArgs(['--out', '--plan'], {}), /requires a value/);
  assert.throws(() => parseArgs(['--host', 'example.org'], {}), /Unknown option/);
});

test('ordinary captures discard the previous document even for identical hash URLs', async () => {
  const { navigateOrdinaryCapture } = await load();
  const calls = [];
  const page = { goto: async (...args) => calls.push(args) };
  const shot = { preset: 'newsroom', mode: 'light', route: 'program' };
  await navigateOrdinaryCapture(page, local, shot);
  await navigateOrdinaryCapture(page, local, shot);
  assert.deepEqual(calls, [
    ['about:blank'], [`${local}/eventrunner/demo/?style=newsroom&mode=light#/schedule`, { waitUntil: 'load' }],
    ['about:blank'], [`${local}/eventrunner/demo/?style=newsroom&mode=light#/schedule`, { waitUntil: 'load' }],
  ]);
});

test('network decisions allow only read-only local files or same-snapshot canonical assets', async () => {
  const { requestDecision } = await load();
  assert.deepEqual(requestDecision(`${local}/eventrunner/demo/?style=zine`, local), { kind: 'local', name: 'index.html' });
  assert.deepEqual(requestDecision('https://centercoopmedia.github.io/eventrunner/demo/branding/mark.svg', local), { kind: 'snapshot-alias', name: 'branding/mark.svg' });
  for (const url of [
    'https://example.org/image.png', 'https://centercoopmedia.github.io.evil.test/eventrunner/demo/a.js',
    'https://centercoopmedia.github.io/private.json', 'http://127.0.0.1:9099/eventrunner/demo/',
    `${local}/eventrunner/demo/%2e%2e/private`, `${local}/eventrunner/demo/%2fetc/passwd`,
    `${local}/eventrunner/demo/%5c..%5cprivate`, `${local}/eventrunner/demo/%invalid`,
    'file:///etc/passwd', 'data:text/plain,test', 'not a URL',
  ]) assert.deepEqual(requestDecision(url, local), { kind: 'blocked' }, url);
  assert.deepEqual(requestDecision(`${local}/eventrunner/demo/`, local, 'POST'), { kind: 'blocked' });
});

test('Git tree parsing rejects symlinks, escaping paths and missing demo entrypoints', async () => {
  const { parseTreeEntries } = await load();
  const index = `100644 blob ${blobSha}\tindex.html\0`;
  assert.equal(parseTreeEntries(Buffer.from(index)).get('index.html'), blobSha);
  for (const entry of [
    `120000 blob ${blobSha}\tlink\0`, `160000 commit ${sourceSha}\tsubmodule\0`,
    `100644 blob ${blobSha}\t../private\0`, `100644 blob ${blobSha}\t/absolute\0`,
    `100644 blob ${blobSha}\tassets\\private\0`,
  ]) assert.throws(() => parseTreeEntries(Buffer.from(index + entry)));
  assert.throws(() => parseTreeEntries(Buffer.from('')), /index.html is missing/);
});

test('snapshot content reads only resolved blob IDs and caches immutable bytes', async () => {
  const { readSnapshot } = await load();
  const calls = [];
  const runGit = (args) => {
    calls.push(args);
    if (args[0] === 'rev-parse' && args.includes('--end-of-options')) return Buffer.from(sourceSha);
    if (args[0] === 'rev-parse') return Buffer.from(treeSha);
    if (args[0] === 'ls-tree') return Buffer.from(`100644 blob ${blobSha}\tindex.html\0`);
    assert.deepEqual(args, ['cat-file', 'blob', blobSha]);
    return Buffer.from('<html>snapshot</html>');
  };
  const snapshot = readSnapshot('HEAD', 'after', runGit);
  assert.deepEqual([snapshot.sha, snapshot.treeSha, snapshot.fileCount], [sourceSha, treeSha, 1]);
  assert.equal(snapshot.read('index.html').body.toString(), '<html>snapshot</html>');
  snapshot.read('index.html');
  assert.equal(calls.filter(([command]) => command === 'cat-file').length, 1);
  assert.equal(snapshot.read('../private'), null);
  assert.equal(snapshot.read('missing.js'), null);
  assert.throws(() => readSnapshot('--bad-revision', 'before', runGit), /full commit SHA/);
});

test('loopback snapshot server never falls back to HTML for missing assets and denies fullscreen', async () => {
  const { serveSnapshot } = await load();
  const server = await serveSnapshot({ read: (name) => name === 'index.html' ? { body: Buffer.from('static demo'), contentType: 'text/html' } : null });
  try {
    const response = await fetch(`${server.origin}/eventrunner/demo/`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'static demo');
    assert.match(response.headers.get('permissions-policy'), /fullscreen=\(\)/);
    assert.equal((await fetch(`${server.origin}/eventrunner/demo/missing.js`)).status, 404);
    assert.equal((await fetch(`${server.origin}/private`)).status, 404);
    assert.equal((await fetch(`${server.origin}/eventrunner/demo/`, { method: 'POST' })).status, 404);
  } finally { await server.close(); }
});

test('capture validation never labels the wrong viewport or theme as evidence', async () => {
  const { validateCapture } = await load();
  const shot = { width: 639, height: 900, preset: 'atlas', mode: 'dark', presentation: 'preview', route: 'program' };
  const metrics = { viewport: { width: 639, height: 900 }, theme: 'atlas', mode: 'dark', presentation: 'preview', nativeFullscreen: false, firstSession: { y: 400 } };
  assert.deepEqual(validateCapture(shot, metrics), []);
  assert.equal(validateCapture(shot, { ...metrics, viewport: { width: 640, height: 900 } }).length, 1);
  assert.equal(validateCapture(shot, { ...metrics, theme: 'civic', presentation: 'ordinary', nativeFullscreen: true, firstSession: null }).length, 4);
});

test('interaction captures require the requested disclosure or genuine no-results state', async () => {
  const { validateCapture, NO_RESULTS_QUERY } = await load();
  const shot = { width: 485, height: 900, preset: 'newsroom', mode: 'light', presentation: 'ordinary', route: 'program' };
  const metrics = { viewport: { width: 485, height: 900 }, theme: 'newsroom', mode: 'light', presentation: 'ordinary', nativeFullscreen: false, firstSession: { y: 400 } };
  for (const [state, disclosure] of [['menu-open', 'menu'], ['demo-settings-open', 'demoSettings'], ['filters-open', 'filters']]) {
    assert.equal(validateCapture({ ...shot, state }, metrics).length, 1);
    assert.deepEqual(validateCapture({ ...shot, state }, { ...metrics, disclosures: { [disclosure]: 'true' } }), []);
  }
  const noResults = { ...metrics, firstSession: null, noResults: true, searchValue: NO_RESULTS_QUERY };
  assert.equal(validateCapture({ ...shot, state: 'filters-open' }, {
    ...metrics, disclosures: { menu: 'true', demoSettings: 'false', filters: 'true' },
  }).length, 1);
  assert.equal(validateCapture({ ...shot, state: 'default' }, {
    ...metrics, disclosures: { menu: 'true' },
  }).length, 1);
  assert.deepEqual(validateCapture({ ...shot, state: 'no-results' }, noResults), []);
  assert.equal(validateCapture({ ...shot, state: 'no-results' }, { ...noResults, noResults: false }).length, 1);
  assert.equal(validateCapture({ ...shot, state: 'no-results' }, { ...noResults, firstSession: { y: 400 } }).length, 1);
  assert.equal(validateCapture({ ...shot, state: 'default' }, noResults).length, 1);
});

test('CI captures after emulator journeys, uploads only public evidence for seven days, and preserves the sandbox', () => {
  const root = path.resolve(__dirname, '../..');
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8').replace(/\r\n/g, '\n');
  const e2e = workflow.slice(workflow.indexOf('\n  e2e:'), workflow.indexOf('\n  gate:'));
  assert.match(e2e, /fetch-depth: 0/);
  assert.ok(e2e.indexOf('Capture public demo visual evidence') > e2e.indexOf('run: bash scripts/dev/run-e2e.sh'));
  const capture = e2e.slice(e2e.indexOf('      - name: Capture public demo visual evidence'), e2e.indexOf('      - name: Upload Playwright report'));
  assert.match(capture, /DEMO_VISUAL_BASE_SHA: \$\{\{ github.event.pull_request.base.sha \}\}/);
  assert.match(capture, /path: test-results\/demo-visual-evidence\//);
  assert.match(capture, /retention-days: 7/);
  assert.doesNotMatch(capture, /secrets\.|permissions:|deploy/);
  const script = fs.readFileSync(path.join(__dirname, 'capture-demo-visuals.mjs'), 'utf8');
  assert.match(script, /chromium.launch\(\{ chromiumSandbox: true \}\)/);
  assert.match(script, /serviceWorkers: 'block'/);
  assert.match(script, /context.routeWebSocket/);
  assert.doesNotMatch(script, /--no-sandbox|playwright install|storageState:/);
});
