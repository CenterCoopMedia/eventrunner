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
