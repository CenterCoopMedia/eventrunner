'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildPlan } = require('../publish-site.cjs');
const { buildWebManifest } = require('../lib/site-manifest.cjs');

const root = path.resolve(__dirname, '../..');
const origin = 'https://events.example.org';
const schedule = 'src/pages/Schedule.jsx';

function verifyBuild(dist, base, manifest) {
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  const chunks = JSON.parse(fs.readFileSync(path.join(dist, '.vite/manifest.json'), 'utf8'));
  const entry = chunks['index.html'];
  assert.ok(html.includes(`src="${base}${entry.file}"`), 'entry script must use the asset base');
  assert.ok(html.includes(`href="${base}branding/favicon.svg"`), 'favicon must use the asset base');
  assert.ok(html.includes(`href="${base}manifest.webmanifest"`), 'manifest must use the asset base');
  for (const stylesheet of entry.css ?? []) {
    assert.ok(html.includes(`href="${base}${stylesheet}"`), `stylesheet outside ${base}`);
  }
  for (const [, url] of html.matchAll(/(?:src|href)="(\/(?!\/)[^"]+)"/g)) {
    assert.ok(url.startsWith(base), `HTML reference outside ${base}: ${url}`);
    assert.ok(fs.existsSync(path.join(dist, url.slice(base.length))), `missing file: ${url}`);
  }

  const lazy = chunks[schedule];
  assert.ok(lazy?.isDynamicEntry, 'the schedule must remain a lazy entry');
  assert.ok(fs.existsSync(path.join(dist, lazy.file)), 'missing lazy schedule chunk');
  const importers = Object.values(chunks).filter((chunk) => chunk.dynamicImports?.includes(schedule));
  assert.ok(importers.some(({ file }) => {
    const code = fs.readFileSync(path.join(dist, file), 'utf8');
    // Vite may use a relative import or a base-prefixed absolute import.
    const relative = path.posix.relative(path.posix.dirname(file), lazy.file);
    return code.includes(`./${relative}`) || code.includes(`${base}${lazy.file}`);
  }), 'schedule import must resolve within the built event');

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
  console.log(`Verified web entry, branding, lazy schedule and manifest at ${base}`);
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
