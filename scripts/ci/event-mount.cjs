'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildPlan } = require('../publish-site.cjs');
const { buildWebManifest } = require('../lib/site-manifest.cjs');
const { MAX_BYTES, OFFLINE_INPUTS_FILE } = require('../lib/offline-public.cjs');

const root = path.resolve(__dirname, '../..');
const origin = 'https://events.example.org';

function verifyBuild(dist, base, manifest) {
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  const chunks = JSON.parse(fs.readFileSync(path.join(dist, '.vite/manifest.json'), 'utf8'));
  const offline = JSON.parse(fs.readFileSync(path.join(dist, OFFLINE_INPUTS_FILE), 'utf8'));
  const entry = chunks['index.html'];
  assert.ok(html.includes(`<link rel="modulepreload" crossorigin href="${base}${entry.file}" data-app-entry>`),
    'entry module preload must use the asset base');
  assert.ok(html.includes('<script data-app-entry>'), 'entry module must have an importer');
  assert.ok(html.includes(`href="${base}branding/favicon.svg"`), 'favicon must use the asset base');
  assert.ok(html.includes(`href="${base}manifest.webmanifest"`), 'manifest must use the asset base');
  for (const stylesheet of entry.css ?? []) {
    assert.ok(html.includes(`href="${base}${stylesheet}"`), `stylesheet outside ${base}`);
  }
  for (const [, url] of html.matchAll(/(?:src|href)="(\/(?!\/)[^"]+)"/g)) {
    assert.ok(url.startsWith(base), `HTML reference outside ${base}: ${url}`);
    assert.ok(fs.existsSync(path.join(dist, url.slice(base.length))), `missing file: ${url}`);
  }

  // The Vite config groups Schedule into a named chunk. Rolldown's manifest
  // can key the group by its output file instead of by Schedule.jsx.
  const [schedule, lazy] = Object.entries(chunks).find(([, chunk]) => /^assets\/schedule-[^/]+\.js$/.test(chunk.file)) ?? [];
  assert.ok(lazy, 'missing schedule chunk in the Vite manifest');
  assert.ok(fs.existsSync(path.join(dist, lazy.file)), 'missing lazy schedule chunk');
  const importers = Object.values(chunks).filter((chunk) => chunk.dynamicImports?.includes(schedule));
  assert.ok(importers.some(({ file }) => {
    const code = fs.readFileSync(path.join(dist, file), 'utf8');
    // Vite may use a relative import or a base-prefixed absolute import.
    const relative = path.posix.relative(path.posix.dirname(file), lazy.file);
    return code.includes(`./${relative}`) || code.includes(`${base}${lazy.file}`);
  }), 'schedule import must resolve within the built event');

  assert.equal(offline.base, base);
  assert.ok(offline.routes.includes('/') && offline.routes.includes('/schedule'));
  assert.ok(offline.files.includes(lazy.file), 'offline set must contain the schedule group');
  for (const source of ['src/pages/MySchedule.jsx', 'src/pages/UpdateDetail.jsx', 'src/components/SavedPublicNotice.jsx']) {
    assert.ok(offline.files.includes(chunks[source]?.file), `offline set must contain ${source}`);
  }
  const sdk = Object.values(chunks).find(({ file }) => /^assets\/firebase-sdk-/.test(file));
  assert.ok(sdk && offline.files.includes(sdk.file), 'offline My schedule needs the shared Firebase runtime');
  for (const source of ['src/admin/AdminApp.jsx', 'src/pages/Tickets.jsx', 'src/pages/SharedSchedule.jsx']) {
    assert.ok(!offline.files.includes(chunks[source]?.file), `offline set must exclude ${source}`);
  }
  const offlineBytes = offline.files.reduce((total, file) => {
    const served = file === 'app-shell.html' ? 'index.html' : file;
    return total + fs.statSync(path.join(dist, served)).size;
  }, 0);
  assert.ok(offlineBytes <= MAX_BYTES, `public copy has ${offlineBytes} decoded bytes at ${base}`);

  const manifestUrl = `${origin}${base}manifest.webmanifest`;
  for (const field of ['scope', 'start_url']) {
    assert.equal(new URL(manifest[field], manifestUrl).href, `${origin}${base}`);
  }
  assert.equal(manifest.icons.length, 2);
  for (const { src } of manifest.icons) {
    const icon = new URL(src, manifestUrl);
    assert.equal(icon.origin, origin);
    assert.ok(icon.pathname.startsWith(`${base}branding/`));
    assert.ok(fs.existsSync(path.join(dist, icon.pathname.slice(base.length))));
  }
  console.log(`Verified web entry, branding and ${offlineBytes}-byte public offline set at ${base}`);
}

function build({ command, args, env }, dist) {
  const result = spawnSync(command, [...args, '--', '--manifest', '--outDir', dist], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, 'mounted web build failed');
}

const builtRoot = path.join(root, 'apps/web/dist');
const readManifest = (dist) => JSON.parse(fs.readFileSync(path.join(dist, 'manifest.webmanifest'), 'utf8'));
verifyBuild(builtRoot, '/', readManifest(builtRoot));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'event-mount-'));
try {
  const ordinary = path.join(temp, 'ordinary');
  build({ command: 'npm', args: ['run', 'build', '-w', 'apps/web'], env: {
    VITE_EVENT_PUBLIC_URL: `${origin}/conference`,
  } }, ordinary);
  verifyBuild(ordinary, '/conference/', readManifest(ordinary));

  const publisher = path.join(temp, 'publisher');
  const [, publisherBuild] = buildPlan({
    generatedDir: path.join(root, 'apps/web/src/generated'),
    env: { ...process.env, EVENT_PUBLIC_URL: `${origin}/events/conference-2027/` },
  });
  build(publisherBuild, publisher);
  verifyBuild(publisher, '/events/conference-2027/', buildWebManifest({}));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
