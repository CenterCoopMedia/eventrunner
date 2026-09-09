'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkBudget, measureBundle, parseStaticImports } = require('./bundle-budget.cjs');

test('parseStaticImports excludes dynamic imports', () => {
  assert.deepEqual(
    parseStaticImports(
      'import"./side.js";import{a}from"./shared.js";export{b}from"./export.js";import("./lazy.js");',
    ),
    ['./side.js', './shared.js', './export.js'],
  );
});

test('measureBundle follows only the initial static graph', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-budget-'));
  fs.mkdirSync(path.join(root, 'assets'));
  fs.writeFileSync(
    path.join(root, 'index.html'),
    '<script type="module" src="./assets/index.js"></script>',
  );
  fs.writeFileSync(path.join(root, 'assets/index.js'), 'import"./shared.js"; import("./route.js");');
  fs.writeFileSync(path.join(root, 'assets/shared.js'), 'export const shared = true;');
  fs.writeFileSync(path.join(root, 'assets/route.js'), 'export default 1;');

  const measured = measureBundle(root);
  assert.deepEqual(
    measured.initial.files.map((item) => item.file).sort(),
    ['assets/index.js', 'assets/shared.js'],
  );
  assert.deepEqual(measured.lazyChunks.map((item) => item.file), ['assets/route.js']);
  assert.equal(checkBudget(measured, {
    initial: { raw: 1, gzip: 1 },
    lazyChunk: { raw: 1, gzip: 1 },
  }).length > 0, true);
});

// --- Source-level guard for the initial graph -------------------------------
// The size check above only fires after a build, and it reports one number:
// it can say the entry chunk grew but not that someone re-attached the
// Firebase Storage SDK to Layout by importing one string helper from the
// wrong module. That regression is a two-character edit and costs ~34 kB, so
// it is pinned here, in source, where the reason is readable.
//
// The walk starts at the web app's entry module and follows STATIC imports
// only, exactly as measureBundle follows them in the built output. A
// `lazy(() => import(...))` route is a dynamic import and is skipped, so
// everything reached below is code that ships in the first paint.
const WEB_SRC = path.resolve(__dirname, '..', '..', 'apps', 'web', 'src');

function resolveSource(importer, specifier) {
  let base;
  if (specifier.startsWith('@/')) base = path.join(WEB_SRC, specifier.slice(2));
  else if (specifier.startsWith('.')) base = path.resolve(path.dirname(importer), specifier);
  else return null; // a bare package specifier, or the @generated alias
  for (const candidate of [base, `${base}.js`, `${base}.jsx`, path.join(base, 'index.js')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function eagerSourceGraph(entry) {
  const seen = new Set([entry]);
  const queue = [entry];
  const packages = new Set();
  while (queue.length > 0) {
    const file = queue.shift();
    for (const specifier of parseStaticImports(fs.readFileSync(file, 'utf8'))) {
      const resolved = resolveSource(file, specifier);
      if (!resolved) {
        if (!specifier.startsWith('@generated')) packages.add(specifier);
        continue;
      }
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      queue.push(resolved);
    }
  }
  return { files: seen, packages };
}

test('the first-paint source graph does not reach the Firebase Storage SDK', () => {
  const { files, packages } = eagerSourceGraph(path.join(WEB_SRC, 'main.jsx'));

  // Sanity: the walk really did reach the shell it is meant to police.
  assert.equal(files.has(path.join(WEB_SRC, 'components', 'Layout.jsx')), true);
  assert.equal(files.has(path.join(WEB_SRC, 'lib', 'mediaSource.js')), true);

  assert.equal(
    [...packages].some((name) => name === 'firebase/storage' || name.startsWith('firebase/storage/')),
    false,
    'firebase/storage is back in the first-paint graph: import the write helpers from lib/photoUpload.js instead',
  );
  assert.equal(
    files.has(path.join(WEB_SRC, 'lib', 'photoUpload.js')),
    false,
    'lib/photoUpload.js must stay behind the lazy /profile route',
  );
});
