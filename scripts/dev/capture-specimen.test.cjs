'use strict';

// The capture script's own reading of the command line and its file names.
//
// The capture itself needs a browser and a served build, so it is not
// tested here. What is tested is everything that decides WHAT gets written
// and WHERE, because a wrong name silently overwrites the capture beside it
// and a wrong URL captures the wrong style.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MODULE_URL = pathToFileURL(path.resolve(__dirname, 'capture-specimen.mjs')).href;

async function load() {
  return import(MODULE_URL);
}

test('the defaults cover six styles, both modes, and two widths', async () => {
  const { DEFAULT_STYLES, DEFAULT_MODES, DEFAULT_WIDTHS } = await load();
  assert.equal(DEFAULT_STYLES.length, 6);
  assert.deepEqual([...DEFAULT_MODES], ['light', 'dark']);
  assert.deepEqual([...DEFAULT_WIDTHS], [1440, 390]);
});

test('--out is required', async () => {
  const { parseArgs } = await load();
  const parsed = parseArgs(['--dist', '/tmp/build']);
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /--out/u);
});

test('a source is required, and only one', async () => {
  const { parseArgs } = await load();
  assert.equal(parseArgs(['--out', '/tmp/shots']).ok, false);
  const both = parseArgs(['--out', '/tmp/shots', '--dist', '/tmp/b', '--base-url', 'http://x/']);
  assert.equal(both.ok, false);
  assert.match(both.error, /not both/u);
});

test('an unknown option is refused rather than ignored', async () => {
  const { parseArgs } = await load();
  const parsed = parseArgs(['--out', '/tmp/shots', '--dist', '/tmp/b', '--styles-please', 'x']);
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /unknown option/u);
});

test('the lists are read as comma-separated values', async () => {
  const { parseArgs } = await load();
  const parsed = parseArgs([
    '--out', '/tmp/shots', '--dist', '/tmp/b',
    '--styles', 'zine, atlas', '--modes', 'light', '--widths', '1440, 390',
  ]);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.options.styles, ['zine', 'atlas']);
  assert.deepEqual(parsed.options.modes, ['light']);
  assert.deepEqual(parsed.options.widths, [1440, 390]);
});

test('a mode outside light and dark is refused', async () => {
  const { parseArgs } = await load();
  const parsed = parseArgs(['--out', '/tmp/s', '--dist', '/tmp/b', '--modes', 'sepia']);
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /unknown mode sepia/u);
});

test('a base path always ends in a slash', async () => {
  const { parseArgs } = await load();
  const parsed = parseArgs(['--out', '/tmp/s', '--dist', '/tmp/b', '--base-path', '/demo']);
  assert.equal(parsed.options.basePath, '/demo/');
});

test('a scale that is not a positive number is refused', async () => {
  const { parseArgs } = await load();
  const parsed = parseArgs(['--out', '/tmp/s', '--dist', '/tmp/b', '--scale', '0']);
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /--scale/u);
});

test('the scale defaults to one', async () => {
  const { parseArgs } = await load();
  const parsed = parseArgs(['--out', '/tmp/s', '--dist', '/tmp/b']);
  assert.equal(parsed.options.scale, 1);
});

test('a capture is named style, mode, then width', async () => {
  const { captureName } = await load();
  assert.equal(captureName({ style: 'zine', mode: 'dark', width: 390 }), 'zine--dark--390.png');
});

test('a section capture adds the section to the name', async () => {
  const { captureName } = await load();
  assert.equal(
    captureName({ style: 'civic', mode: 'light', width: 1440, section: 'specimen-controls' }),
    'civic--light--1440--specimen-controls.png',
  );
});

test('the URL carries the style and the mode ahead of the hash route', async () => {
  const { captureUrl } = await load();
  assert.equal(
    captureUrl({ baseUrl: 'http://127.0.0.1:8901/eventrunner/demo/', style: 'atlas', mode: 'dark' }),
    'http://127.0.0.1:8901/eventrunner/demo/?style=atlas&mode=dark#/specimen',
  );
});

test('a base URL with no trailing slash still resolves', async () => {
  const { captureUrl } = await load();
  assert.equal(
    captureUrl({ baseUrl: 'http://127.0.0.1:8901/demo', style: 'zine', mode: 'light' }),
    'http://127.0.0.1:8901/demo/?style=zine&mode=light#/specimen',
  );
});

test('the fixed furniture is put back even when the shot throws', async () => {
  // The furniture is hidden for a section shot and shown again after. A
  // screenshot that threw used to leave the page hidden, and every capture
  // after it in the same run was taken on a page missing its furniture.
  const { withFixedFurnitureHidden } = await load();
  let evaluations = 0;
  const page = { evaluate: async () => { evaluations += 1; } };
  await assert.rejects(
    withFixedFurnitureHidden(page, async () => {
      assert.equal(evaluations, 1);
      throw new Error('the section is not on the page');
    }),
    /not on the page/u,
  );
  assert.equal(evaluations, 2);
});

test('a style outside the known list is refused', async () => {
  // A misspelled id used to parse, and the demo band then fell back to the
  // first style while the file name still said the id that was typed. The
  // capture was evidence for a style nobody rendered.
  const { parseArgs } = await load();
  const parsed = parseArgs(['--out', '/tmp/s', '--dist', '/tmp/b', '--styles', 'newsroon']);
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /unknown style newsroon/u);
});

test('the first bad style is named, not the last', async () => {
  const { parseArgs } = await load();
  const parsed = parseArgs([
    '--out', '/tmp/s', '--dist', '/tmp/b', '--styles', 'zine,atlantis,broadsheat',
  ]);
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /unknown style atlantis/u);
});

test('every default style passes its own check', async () => {
  const { parseArgs, DEFAULT_STYLES } = await load();
  const parsed = parseArgs([
    '--out', '/tmp/s', '--dist', '/tmp/b', '--styles', DEFAULT_STYLES.join(','),
  ]);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.options.styles, [...DEFAULT_STYLES]);
});

test('the known style list is the preset catalog, not a copy that can drift', async () => {
  // The book is captured per site style, and the site styles are the
  // presets. A hand-kept second list is a list that goes stale the day a
  // seventh preset lands.
  const { DEFAULT_STYLES } = await load();
  const { THEME_PRESET_IDS } = require('shared/theme');
  assert.deepEqual([...DEFAULT_STYLES], [...THEME_PRESET_IDS]);
});
