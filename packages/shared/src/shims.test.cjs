'use strict';

// Every .cjs module has an .mjs shim that re-exports it for the web
// bundles. A shim that misses a name breaks the first web import of that
// name, so each shim must export exactly what its module exports.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SRC = __dirname;
const PACKAGE_ROOT = path.join(SRC, '..');

// Internal generated data: only theme.cjs requires it, and the exports map
// does not name it.
const NO_SHIM = new Set(['presetCatalog.cjs']);

function listModules(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listModules(full));
    else if (entry.name.endsWith('.cjs') && !entry.name.endsWith('.test.cjs')) out.push(full);
  }
  return out;
}

function exportNames(namespace) {
  return Object.keys(namespace).filter((name) => name !== 'default' && name !== 'module.exports').sort();
}

async function compare(cjsFile, mjsFile) {
  const cjs = require(cjsFile);
  const esm = await import(pathToFileURL(mjsFile).href);
  const cjsNames = Object.keys(cjs).sort();
  const esmNames = exportNames(esm);
  const label = path.relative(PACKAGE_ROOT, mjsFile);
  const missing = cjsNames.filter((name) => !esmNames.includes(name));
  const extra = esmNames.filter((name) => !cjsNames.includes(name));
  assert.deepEqual(missing, [], `${label} is missing: ${missing.join(', ')}`);
  assert.deepEqual(extra, [], `${label} exports names its module lacks: ${extra.join(', ')}`);
  for (const name of cjsNames) assert.equal(esm[name], cjs[name], `${label} ${name} is a different value`);
}

const modules = listModules(SRC);

test('every module has a shim, except the internal preset catalog', () => {
  const withoutShim = modules
    .filter((file) => !fs.existsSync(file.replace(/\.cjs$/, '.mjs')))
    .map((file) => path.relative(SRC, file));
  assert.deepEqual(withoutShim, [...NO_SHIM]);
});

for (const file of modules) {
  const shim = file.replace(/\.cjs$/, '.mjs');
  if (!fs.existsSync(shim)) continue;
  test(`${path.relative(SRC, shim)} exports the same names as its module`, () => compare(file, shim));
}

const { exports: exportsMap } = require('../package.json');

for (const [subpath, target] of Object.entries(exportsMap)) {
  test(`exports map "${subpath}" resolves to a matching pair`, () => {
    const cjsFile = path.join(PACKAGE_ROOT, target.require);
    const mjsFile = path.join(PACKAGE_ROOT, target.import);
    assert.ok(fs.existsSync(cjsFile), `${target.require} does not exist`);
    assert.ok(fs.existsSync(mjsFile), `${target.import} does not exist`);
    return compare(cjsFile, mjsFile);
  });
}
