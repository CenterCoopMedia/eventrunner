const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepareHostingShell } = require('./prepare-hosting-shell.cjs');
const { OFFLINE_INPUTS_FILE } = require('./lib/offline-public.cjs');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'firebase.json'), 'utf8'));

test('all Hosting entry points prohibit framing, including direct SPA access', () => {
  const rules = config.hosting.headers;
  const global = rules.find((rule) => rule.source === '**');
  assert.ok(global, 'Protect every entry point, including /admin, nested routes and /index.html');
  const headers = Object.fromEntries(global.headers.map(({ key, value }) => [key.toLowerCase(), value]));
  assert.match(headers['content-security-policy'], /(?:^|;)\s*frame-ancestors 'none'\s*(?:;|$)/);
  assert.equal(headers['x-frame-options'], 'DENY');
  for (const rule of rules) {
    for (const { key, value } of rule.headers) {
      if (key.toLowerCase() === 'content-security-policy') {
        assert.match(value, /(?:^|;)\s*frame-ancestors 'none'\s*(?:;|$)/);
      }
      if (key.toLowerCase() === 'x-frame-options') assert.equal(value, 'DENY');
    }
  }
});

test('Hosting permits the Google Maps embed and the sign-in and App Check frames', () => {
  const global = config.hosting.headers.find((rule) => rule.source === '**');
  const policy = global.headers.find(({ key }) => key === 'Content-Security-Policy').value;
  const frameSources = policy.split(';').map((directive) => directive.trim())
    .find((directive) => directive.startsWith('frame-src ')).split(/\s+/).slice(1);
  assert.deepEqual(new Set(frameSources), new Set([
    "'self'",
    'https://*.firebaseapp.com/__/auth/iframe',
    'https://www.google.com/recaptcha/',
    'https://recaptcha.google.com/recaptcha/',
    'https://www.google.com/maps/embed',
    'https://www.google.com/maps',
  ]));
});

test('admin rewrites retain noindex alongside the global framing policy', () => {
  for (const source of ['/admin', '/admin/**']) {
    assert.ok(config.hosting.rewrites.some((rule) => rule.source === source && rule.destination === '/app-shell.html'));
    assert.ok(config.hosting.headers.some((rule) => rule.source === source &&
      rule.headers.some(({ key, value }) => key === 'X-Robots-Tag' && value === 'noindex')));
  }
});

test('no static app page outlives a deploy in a browser', () => {
  const pages = ['/', '/app-shell.html', ...config.hosting.rewrites.filter((rule) => rule.destination === '/app-shell.html').map((rule) => rule.source)];
  for (const source of pages) {
    const rule = config.hosting.headers.find((candidate) => candidate.source === source
      && candidate.headers.some(({ key }) => key === 'Cache-Control'));
    assert.ok(rule, `${source} needs a Cache-Control header`);
    assert.match(rule.headers.find(({ key }) => key === 'Cache-Control').value, /max-age=0.*must-revalidate/);
  }
});

test('Hosting ships the SPA shell without a root index shadowing the function', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'event-hosting-shell-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const index = path.join(dir, 'index.html');
  const shell = path.join(dir, 'app-shell.html');
  assert.deepEqual(config.hosting.predeploy, ['node "$PROJECT_DIR/scripts/prepare-hosting-shell.cjs" "$RESOURCE_DIR"']);
  assert.throws(() => prepareHostingShell(dir), { code: 'ENOENT' });
  const template = '<div id="root"></div><script src="/assets/entry.js"></script>';
  fs.writeFileSync(index, template);
  prepareHostingShell(dir);
  prepareHostingShell(dir);
  assert.equal(fs.existsSync(index), false);
  assert.equal(fs.readFileSync(shell, 'utf8'), template);
  const alias = config.hosting.rewrites.findIndex(({ source }) => source === '/index.html');
  const routeMeta = config.hosting.rewrites.findIndex(({ source }) => source === '**');
  assert.ok(alias >= 0 && alias < routeMeta);
  assert.equal(config.hosting.rewrites[alias].destination, '/app-shell.html');
  assert.equal(config.hosting.rewrites[routeMeta].function.functionId, 'routeMeta');
});

test('hashed files stay for a year, and nothing else is immutable', () => {
  const cacheRules = config.hosting.headers.flatMap(({ source, headers }) => headers
    .filter(({ key }) => key === 'Cache-Control').map(({ value }) => [source, value]));
  assert.deepEqual(cacheRules.filter(([, value]) => value.includes('immutable')).map(([source]) => source), ['/assets/**']);
  assert.ok(cacheRules.some(([source, value]) => source === '/assets/**' && value.includes('max-age=31536000')));
  assert.ok(cacheRules.some(([source]) => source === '/fonts/**'));
});

test('the public offline worker and kill switch always revalidate from Hosting', () => {
  for (const source of ['/sw.js', '/offline-policy.json']) {
    const rule = config.hosting.headers.find((candidate) => candidate.source === source);
    assert.equal(rule?.headers.find(({ key }) => key === 'Cache-Control')?.value, 'no-store');
  }
});

test('Hosting builds the worker and disable endpoint from an artifact without hidden files', (t) => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'event-offline-artifact-'));
  t.after(() => fs.rmSync(dist, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dist, 'index.html'), '<html><head></head><body></body></html>');
  fs.writeFileSync(path.join(dist, 'offline-public-build.json'), JSON.stringify({
    project: 'offline-fixture', base: '/', routes: ['/'], generatedAt: null, files: ['app-shell.html'],
  }));
  assert.ok(fs.readdirSync(dist).every((file) => !file.startsWith('.')));
  prepareHostingShell(dist);
  assert.match(fs.readFileSync(path.join(dist, 'sw.js'), 'utf8'), /^const BUILD = /);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dist, 'offline-policy.json'), 'utf8')), {
    enabled: false, routes: ['/'],
  });
  assert.ok(config.hosting.ignore.includes(OFFLINE_INPUTS_FILE));
});
