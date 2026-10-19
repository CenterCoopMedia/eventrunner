'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { main, readArgs, formatReport } = require('./export-event-package.cjs');
const { makeFakeDb } = require('../functions/src/cms/firestoreFake.cjs');
const { buildEventPackage, zipPackage, internals: { SECTION_IDS } } = require('../functions/src/admin/eventPackage.cjs');
const { exportSeed } = require('../functions/src/admin/exportFixture.cjs');

const T0 = new Date('2026-10-01T12:00:00.000Z');

test('readArgs: an export takes --out, optional sections in package order, and the staff-note choice', () => {
  assert.deepEqual(readArgs(['--out', 'p.zip'], SECTION_IDS), {
    ok: true, mode: 'export', out: 'p.zip', sections: [...SECTION_IDS], includeStaffNotes: false, force: false,
  });
  assert.deepEqual(readArgs(['--out=p.zip', '--sections', 'pitches,program', '--include-staff-notes'], SECTION_IDS), {
    ok: true, mode: 'export', out: 'p.zip', sections: ['program', 'pitches'], includeStaffNotes: true, force: false,
  });
});

test('readArgs refuses a typo, an unknown section, a missing file and a file that is not a zip', () => {
  assert.equal(readArgs(['--out', 'p.zip', '--section', 'x'], SECTION_IDS).ok, false);
  assert.match(readArgs(['--out', 'p.zip', '--sections', 'secrets'], SECTION_IDS).message, /comma-separated list/);
  assert.equal(readArgs([], SECTION_IDS).ok, false);
  assert.equal(readArgs(['--out', 'p.json'], SECTION_IDS).ok, false);
  assert.equal(readArgs(['--verify'], SECTION_IDS).ok, false);
  assert.deepEqual(readArgs(['--verify', 'p.zip'], SECTION_IDS), { ok: true, mode: 'verify', file: 'p.zip' });
});

test('--verify reads a saved package back and names every count and relationship', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'event-package-'));
  try {
    const db = makeFakeDb(exportSeed());
    const built = await buildEventPackage({ db, config: {}, sections: [...SECTION_IDS], includeStaffNotes: false, at: T0 });
    const file = path.join(dir, 'package.zip');
    fs.writeFileSync(file, await zipPackage({ name: built.name, files: built.files, at: T0 }));

    const out = [];
    const err = [];
    const code = await main(['--verify', file], { stdout: (line) => out.push(line), stderr: (line) => err.push(line) });
    assert.equal(code, 0, err.join('\n'));
    assert.match(out[0], /^Format eventrunner-event-data-package, schema version 1, exported 2026-10-01T12:00:00.000Z\.$/);
    assert.ok(out.includes('  program/sessions.json: 2 records'));
    assert.ok(out.includes('  program/sessions.json speakerIds[] -> speakers/speakers.json: 3 checked'));
    assert.equal(out.at(-1), 'The package is complete. Every file matches its checksum.');

    fs.writeFileSync(file, 'not a zip');
    const damaged = [];
    assert.equal(await main(['--verify', file], { stdout() {}, stderr: (line) => damaged.push(line) }), 1);
    assert.equal(damaged[0], 'The package is damaged:');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('formatReport names a dangling reference with an example', () => {
  const lines = formatReport({
    ok: true,
    manifest: null,
    counts: {},
    relationships: [{ from: 'a.json', field: 'x', to: 'b.json', checked: 2, unresolved: 1, sample: ['gone'] }],
  });
  assert.deepEqual(lines, ['  a.json x -> b.json: 2 checked, 1 not found (for example gone)', 'The package is complete. Every file matches its checksum.']);
});

test('an export refuses to overwrite a file without --force', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'event-package-'));
  try {
    const file = path.join(dir, 'existing.zip');
    fs.writeFileSync(file, 'keep me');
    const err = [];
    assert.equal(await main(['--out', file], { stdout() {}, stderr: (line) => err.push(line) }), 2);
    assert.match(err[0], /exists\. Choose another name, or pass --force/);
    assert.equal(fs.readFileSync(file, 'utf8'), 'keep me');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
