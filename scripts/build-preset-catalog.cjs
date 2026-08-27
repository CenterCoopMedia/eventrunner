#!/usr/bin/env node
'use strict';

/**
 * Mirror the preset design data into `packages/shared` (design brief §3.5,
 * §5.2).
 *
 * `design/tokens/presets/*.json`, `design/tokens/admin.json`, and
 * `design/tokens/motifs.json` are the source of truth. Three readers need
 * that data and only one of them can read the directory:
 *
 *   - the token generator (`scripts/lib/tokens.cjs`) runs in the repo;
 *   - the browser runtime (`apps/web/src/lib/themeRuntime.js`) is bundled;
 *   - `updateTheme` runs in Cloud Functions, where the deploy uploads
 *     `functions/` only. `packages/shared` reaches it because
 *     `scripts/prepare-functions.cjs` packs it into
 *     `functions/vendor/shared.tgz`, and `npm pack` cannot reach a file
 *     outside the package directory.
 *
 * So the design data is mirrored into the shared package, and this script
 * writes the mirror. `scripts/build-preset-catalog.test.cjs` regenerates it
 * and fails when the committed file has drifted, exactly as the demo
 * snapshot gate works. Adding a seventh preset stays a data change: drop the
 * JSON in, run this, commit both.
 *
 * Keys beginning with `$` are notes for a human reading the JSON. They are
 * stripped here, so the mirror carries data only.
 *
 * No hex color literal appears in the output: the palettes are channel
 * numbers in the source and channel numbers in the mirror (spec §7.6).
 *
 * Usage: node scripts/build-preset-catalog.cjs [--check]
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TOKENS_DIR = path.join(ROOT, 'design', 'tokens');
const PRESETS_DIR = path.join(TOKENS_DIR, 'presets');
const TARGET = path.join(ROOT, 'packages', 'shared', 'src', 'presetCatalog.cjs');

/** Preset ids, in the order the brief §4 lists them. */
const PRESET_ORDER = Object.freeze([
  'broadsheet', 'newsroom', 'zine', 'civic', 'field-guide', 'atlas',
]);

/** Strip every `$`-prefixed note key, at every depth. */
function stripNotes(value) {
  if (Array.isArray(value)) return value.map(stripNotes);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      if (key.startsWith('$')) continue;
      out[key] = stripNotes(inner);
    }
    return out;
  }
  return value;
}

/** @param {string} file @returns {object} */
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Serialize as a JS literal in the repo's generated-file style: two-space
 * indent, single quotes, trailing commas. Channel arrays stay on one line,
 * because a palette reads as a table or it reads as nothing.
 *
 * @param {*} value
 * @param {number} [depth]
 * @returns {string}
 */
function jsValue(value, depth = 0) {
  const pad = '  '.repeat(depth + 1);
  const closePad = '  '.repeat(depth);
  if (value === null) return 'null';
  if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (value.every((v) => typeof v === 'number')) {
      return `[${value.map((v) => String(v)).join(', ')}]`;
    }
    return `[\n${value.map((v) => `${pad}${jsValue(v, depth + 1)},`).join('\n')}\n${closePad}]`;
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return '{}';
  const body = entries
    .map(([key, inner]) => `${pad}${/^[A-Za-z_$][\w$]*$/.test(key) ? key : `'${key}'`}: ${jsValue(inner, depth + 1)},`)
    .join('\n');
  return `{\n${body}\n${closePad}}`;
}

/**
 * Build the mirror source text.
 *
 * @param {{ tokensDir?: string }} [options]
 * @returns {string}
 */
function buildPresetCatalog({ tokensDir = TOKENS_DIR } = {}) {
  const presetsDir = path.join(tokensDir, 'presets');
  const presets = {};
  for (const id of PRESET_ORDER) {
    const file = path.join(presetsDir, `${id}.json`);
    const preset = stripNotes(readJson(file));
    if (preset.id !== id) {
      throw new Error(`design/tokens/presets/${id}.json: id is ${JSON.stringify(preset.id)}`);
    }
    presets[id] = preset;
  }

  const adminSource = readJson(path.join(tokensDir, 'admin.json'));
  const admin = {
    colors: stripNotes(adminSource.colors),
    aliases: { ...adminSource.aliases },
    components: { ...adminSource.components },
    scalars: { ...adminSource.scalars },
    fonts: { ...adminSource.fonts },
  };

  const motifs = readJson(path.join(tokensDir, 'motifs.json'));
  const motifSetIds = Object.keys(motifs.sets || {});

  return [
    "'use strict';",
    '',
    '/**',
    ' * GENERATED FILE — do not edit by hand.',
    ' *',
    ' * The design source of truth is `design/tokens/presets/*.json`,',
    ' * `design/tokens/admin.json`, and `design/tokens/motifs.json`. This file',
    ' * mirrors them into `packages/shared` so `updateTheme` can resolve a',
    ' * preset inside Cloud Functions, where only `functions/` is uploaded and',
    ' * the shared package arrives as a packed tarball.',
    ' *',
    ' * Regenerate with `node scripts/build-preset-catalog.cjs`.',
    ' * `scripts/build-preset-catalog.test.cjs` fails when this file is stale.',
    ' */',
    '',
    `const PRESETS = Object.freeze(${jsValue(presets)});`,
    '',
    `const ADMIN_TOKENS = Object.freeze(${jsValue(admin)});`,
    '',
    `const MOTIF_SET_IDS = Object.freeze(${jsValue(motifSetIds)});`,
    '',
    'module.exports = { PRESETS, ADMIN_TOKENS, MOTIF_SET_IDS };',
    '',
  ].join('\n');
}

if (require.main === module) {
  const text = buildPresetCatalog();
  const check = process.argv.includes('--check');
  const current = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : null;
  if (check) {
    if (current !== text) {
      process.stderr.write(
        'packages/shared/src/presetCatalog.cjs is stale. ' +
        'Run: node scripts/build-preset-catalog.cjs\n',
      );
      process.exitCode = 1;
    }
  } else if (current !== text) {
    fs.writeFileSync(TARGET, text);
    process.stdout.write(`wrote ${path.relative(ROOT, TARGET)}\n`);
  } else {
    process.stdout.write('packages/shared/src/presetCatalog.cjs is up to date\n');
  }
}

module.exports = { buildPresetCatalog, PRESET_ORDER, TARGET, TOKENS_DIR, PRESETS_DIR };
