#!/usr/bin/env node
'use strict';

/**
 * Mirror the preset design data out of `design/tokens/` (design brief §3.5,
 * §5.2), split by who reads it.
 *
 * `design/tokens/presets/*.json`, `design/tokens/admin.json`, and
 * `design/tokens/motifs.json` are the source of truth. Several readers need
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
 * FOUR OUTPUTS, ONE SOURCE (owner review, 2026-08-27; split again for the
 * 2026-09-10 vocabulary expansion). The catalog used to be one file carrying
 * both the values that render and the prose that explains them, which meant
 * every deploy shipped design rationale into Cloud Functions, where nothing
 * can read it.
 *
 *   1. `packages/shared/src/presetCatalog.cjs` — WHAT EVERY PATH READS.
 *      Palettes, type maps, shape, motif default, and every option group's
 *      default and choice IDS: what the validator, the contrast check and
 *      the palette resolver need on every path, in Cloud Functions and in
 *      the chunk every visitor downloads.
 *   2. `packages/shared/src/presetRemaps.cjs` — WHAT A STYLE MOVES. Each
 *      style's own token and component-font remaps, what every choice of
 *      every option group moves, and the component defaults a style change
 *      resets. The public site's first paint needs none of it: the
 *      generated stylesheet already carries the chosen style with its picks
 *      resolved. It is needed to RESOLVE a style at runtime — a live
 *      config/theme overlay, the demo's style switcher, the admin's
 *      branding editor, the specimen book — so those paths load it lazily,
 *      and a Node caller requires it once. Loading it registers the remaps
 *      with the resolver (shared/theme registerPresetRemaps).
 *   3. `apps/web/src/admin/presetCopy.js` — THE WORDS STAFF READ. Style
 *      names, one-line summaries, who each style suits, and the label and
 *      reason for every curated choice. It rides the lazily-loaded admin
 *      chunk and reaches no public page and no function.
 *   4. `design/tokens/presets/README.md` — THE DOCUMENTATION CATALOG. Every
 *      design note in the source JSON, rendered for a human deciding which
 *      style an event should wear.
 *
 * `scripts/build-preset-catalog.test.cjs` regenerates all four and fails
 * when any committed file has drifted, exactly as the demo snapshot gate
 * works. Adding a seventh preset stays a data change: drop the JSON in, run
 * this, commit the outputs.
 *
 * Keys beginning with `$` are notes for a human reading the JSON. They are
 * stripped from the two code outputs and rendered into the documentation
 * one, which is where prose belongs.
 *
 * No hex color literal appears in any output: the palettes are channel
 * numbers in the source and channel numbers in the mirrors (spec §7.6).
 *
 * Usage: node scripts/build-preset-catalog.cjs [--check]
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TOKENS_DIR = path.join(ROOT, 'design', 'tokens');
const PRESETS_DIR = path.join(TOKENS_DIR, 'presets');
const TARGET = path.join(ROOT, 'packages', 'shared', 'src', 'presetCatalog.cjs');
const REMAPS_TARGET = path.join(ROOT, 'packages', 'shared', 'src', 'presetRemaps.cjs');
const COPY_TARGET = path.join(ROOT, 'apps', 'web', 'src', 'admin', 'presetCopy.js');
const DOC_TARGET = path.join(ROOT, 'design', 'tokens', 'presets', 'README.md');

/**
 * Preset ids, in the order the style picker offers them.
 *
 * ALL SIX ARE FIRST-CLASS (owner calibration, 2026-08-27). There is no
 * stability tier and no experimental group. Order is the only ranking the
 * catalog carries, and it is a RECOMMENDATION, not a verdict: Institutional
 * leads because it is what a fresh deployment starts on, the two broadly
 * applicable publication looks follow, and the three with the strongest
 * point of view come last — where a client who wants one will still find it
 * complete.
 *
 * The brief §4 lists them in a different order. That list is the writing
 * order of the spec, not a picker order, so this supersedes it for the
 * picker only.
 */
const PRESET_ORDER = Object.freeze([
  'civic', 'newsroom', 'broadsheet', 'atlas', 'field-guide', 'zine',
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
 * The values of one preset that every path reads: the palette the contrast
 * check and the palette resolver need, the type map, the shape, the motif
 * default, and each option group's default and choice ids the validator
 * needs. Nothing else.
 *
 * What the style MOVES — its own token and component-font remaps, and what
 * each choice moves — goes to the remaps output (remapValues below), which
 * only a path that resolves a style at runtime loads. A choice's label and
 * the sentence explaining why it belongs to the story are copy, and copy
 * goes to the copy and documentation outputs.
 *
 * @param {object} preset a preset with its `$` notes already stripped
 * @returns {object}
 */
function renderingValues(preset) {
  const values = {
    id: preset.id,
    palette: preset.palette,
    fonts: preset.fonts,
    shape: preset.shape,
    motifSet: preset.motifSet,
  };
  const options = {};
  for (const [group, spec] of Object.entries(preset.options || {})) {
    options[group] = {
      default: spec.default,
      choices: (spec.choices || []).map((choice) => ({ id: choice.id })),
    };
  }
  values.options = options;
  return values;
}

/**
 * What one preset moves: its own remaps, and every choice's, keyed
 * group → choice id → { fonts?, componentFonts?, tokens? }.
 *
 * @param {object} preset a preset with its `$` notes already stripped
 * @returns {{ componentFonts?: object, tokens?: object, options: object }}
 */
function remapValues(preset) {
  const values = {};
  if (preset.componentFonts) values.componentFonts = preset.componentFonts;
  if (preset.tokens) values.tokens = preset.tokens;
  const options = {};
  for (const [group, spec] of Object.entries(preset.options || {})) {
    const bodies = {};
    for (const choice of spec.choices || []) {
      const body = {};
      if (choice.fonts) body.fonts = choice.fonts;
      if (choice.componentFonts) body.componentFonts = choice.componentFonts;
      if (choice.tokens) body.tokens = choice.tokens;
      bodies[choice.id] = body;
    }
    options[group] = bodies;
  }
  values.options = options;
  return values;
}

/**
 * The words a staff member reads while picking a style — and only those.
 *
 * @param {object} preset a preset with its `$` notes already stripped
 * @returns {object}
 */
function copyValues(preset) {
  const options = {};
  for (const [group, spec] of Object.entries(preset.options || {})) {
    const choices = {};
    for (const choice of spec.choices || []) {
      choices[choice.id] = { label: choice.label, why: choice.why };
    }
    options[group] = { label: spec.label, prompt: spec.prompt, choices };
  }
  return {
    label: preset.label,
    summary: preset.summary,
    bestFor: preset.bestFor,
    options,
  };
}

/** Every `$`-prefixed note on an object, in source order. */
function notesOf(value) {
  return Object.entries(value)
    .filter(([key, note]) => key.startsWith('$') && typeof note === 'string')
    .map(([key, note]) => [key.slice(1), note]);
}

/**
 * The documentation catalog: the design prose, per style, for a human
 * choosing one.
 *
 * @param {Record<string, object>} sources raw JSON, `$` notes intact
 * @returns {string} Markdown
 */
function buildPresetDoc(sources) {
  const lines = [
    '# The site style catalog',
    '',
    '<!-- GENERATED FILE - do not edit by hand.',
    '     Source: design/tokens/presets/*.json.',
    '     Regenerate: node scripts/build-preset-catalog.cjs',
    '     scripts/build-preset-catalog.test.cjs fails when this is stale. -->',
    '',
    'This catalog lists each site style, its default configuration, and the options',
    'staff can select. Runtime values are in `packages/shared/src/presetCatalog.cjs`',
    'and `packages/shared/src/presetRemaps.cjs`.',
    'Admin labels and explanations are in `apps/web/src/admin/presetCopy.js`.',
    'All four outputs are generated from the same JSON source files.',
    '',
    'The picker uses the order shown below. A new deployment starts with Institutional.',
    'Each style includes one default configuration. Options marked *default* are selected',
    'when staff choose the style.',
    '',
    'Design rationale is in `docs/plans/2026-08-27-preset-visual-stories.md`.',
    'Implementation requirements are in `docs/plans/2026-08-27-design-system-overhaul.md`.',
    '',
  ];

  for (const id of PRESET_ORDER) {
    const preset = sources[id];
    lines.push(`## ${preset.label}`, '');
    lines.push(`\`data-theme="${preset.id}"\``, '');
    lines.push(preset.summary, '');
    if (preset.bestFor) lines.push(preset.bestFor, '');

    lines.push(
      '| | |',
      '|---|---|',
      `| Headings | \`${preset.fonts.heading}\` |`,
      `| Body | \`${preset.fonts.body}\` |`,
      `| Data | \`${preset.fonts.data}\` |`,
      `| Figures and code | \`${preset.fonts.mono}\` |`,
      `| Corners | ${preset.shape.radius} |`,
      `| Surface | ${preset.shape.texture} |`,
      `| Density | ${preset.shape.density} |`,
      `| Illustrations | ${preset.motifSet} |`,
      '',
    );

    for (const [name, note] of notesOf(preset)) {
      lines.push(`**${name}.** ${note}`, '');
    }

    for (const [group, spec] of Object.entries(preset.options || {})) {
      lines.push(`### ${spec.label}: \`${group}\``, '');
      if (spec.prompt) lines.push(spec.prompt, '');
      for (const [name, note] of notesOf(spec)) {
        lines.push(`**${name}.** ${note}`, '');
      }
      for (const choice of spec.choices || []) {
        const mark = choice.id === spec.default ? ' *(default)*' : '';
        lines.push(`- **${choice.label}**${mark}: ${choice.why}`);
      }
      lines.push('');
    }
  }

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

/**
 * Build all four outputs from one read of the design tokens.
 *
 * @param {{ tokensDir?: string }} [options]
 * @returns {{ runtime: string, remaps: string, copy: string, doc: string }}
 */
function buildPresetCatalog({ tokensDir = TOKENS_DIR } = {}) {
  const presetsDir = path.join(tokensDir, 'presets');
  const sources = {};
  const presets = {};
  const remaps = {};
  const copy = {};
  for (const id of PRESET_ORDER) {
    const file = path.join(presetsDir, `${id}.json`);
    const source = readJson(file);
    const preset = stripNotes(source);
    if (preset.id !== id) {
      throw new Error(`design/tokens/presets/${id}.json: id is ${JSON.stringify(preset.id)}`);
    }
    sources[id] = source;
    presets[id] = renderingValues(preset);
    remaps[id] = remapValues(preset);
    copy[id] = copyValues(preset);
  }

  // Only preset-remapped properties need explicit resets on a style change.
  // Untouched component defaults already remain in the generated stylesheet.
  // A style's own remaps and every choice's are in the remaps, so one walk
  // finds them all.
  const remappedNames = new Set();
  function collectRemaps(value) {
    if (!value || typeof value !== 'object') return;
    for (const [name, child] of Object.entries(value)) {
      if (name.startsWith('--')) remappedNames.add(name);
      collectRemaps(child);
    }
  }
  collectRemaps(remaps);
  const componentContracts = stripNotes(readJson(path.join(tokensDir, 'components.json')));
  const componentDefaults = Object.fromEntries(Object.values(componentContracts)
    .flatMap((contract) => Object.entries(contract))
    .filter(([name]) => !name.endsWith('-rgb') && remappedNames.has(name)));

  const adminSource = readJson(path.join(tokensDir, 'admin.json'));
  const admin = {
    colors: stripNotes(adminSource.colors),
    aliases: { ...adminSource.aliases },
    components: { ...adminSource.components },
    scalars: { ...adminSource.scalars },
    fonts: { ...adminSource.fonts },
    schemes: { ...adminSource.schemes },
  };

  const motifs = readJson(path.join(tokensDir, 'motifs.json'));
  const motifSetIds = Object.keys(motifs.sets || {});

  const runtime = [
    "'use strict';",
    '',
    '/**',
    ' * GENERATED FILE — do not edit by hand.',
    ' *',
    ' * WHAT EVERY PATH READS. Palettes, type maps, shape, the motif default,',
    ' * and the option ids and defaults — what the config validator, the',
    ' * contrast check and the palette resolver read on every path, and',
    ' * nothing a human reads. What a style MOVES — its token and',
    ' * component-font remaps, what each choice moves, the component defaults',
    ' * a style change resets — is `presetRemaps.cjs`, which only a path that',
    ' * resolves a style at runtime loads. The style names and the reasons',
    ' * behind each curated choice are copy: they live in',
    ' * `apps/web/src/admin/presetCopy.js`, which rides the admin chunk, and',
    ' * the design prose lives in `design/tokens/presets/README.md`.',
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

  const remapsText = [
    "'use strict';",
    '',
    '/**',
    ' * GENERATED FILE — do not edit by hand.',
    ' *',
    ' * WHAT A STYLE MOVES. `presets` carries, per style, its own token and',
    ' * component-font remaps and what every choice of every option group',
    ' * moves (`options`, keyed group → choice id → { fonts?, componentFonts?,',
    ' * tokens? }); `componentDefaults` carries the contract default of every',
    ' * token some style or choice remaps, which a style change resets before',
    ' * it applies the new style. `presetCatalog.cjs` carries the palettes,',
    ' * type maps and choice IDS every path needs; this file carries what only',
    ' * a path that RESOLVES a style at runtime needs — a live config/theme',
    ' * overlay, the demo style switcher, the admin branding editor, the',
    " * specimen book, the token generator. The public site's first paint",
    ' * needs none of it, because the generated stylesheet already carries the',
    ' * chosen style with its picks resolved, so the web app loads this module',
    ' * lazily (apps/web/src/lib/presetRemaps.js) and a Node caller requires',
    ' * it once.',
    ' *',
    ' * REQUIRING IT REGISTERS IT. The resolver (theme.cjs) keeps a registry',
    ' * its token and pick resolvers read, and the last line here fills it, so',
    " * a caller that has required 'shared/presetRemaps' resolves every style",
    ' * in full and one that has not is told so rather than handed a',
    ' * half-resolved style.',
    ' *',
    ' * Source of truth: design/tokens/presets/*.json and',
    ' * design/tokens/components.json.',
    ' * Regenerate with `node scripts/build-preset-catalog.cjs`.',
    ' * `scripts/build-preset-catalog.test.cjs` fails when this file is stale.',
    ' */',
    '',
    `const PRESET_REMAPS = Object.freeze(${jsValue({ componentDefaults, presets: remaps })});`,
    '',
    "require('./theme.cjs').registerPresetRemaps(PRESET_REMAPS);",
    '',
    'module.exports = { PRESET_REMAPS };',
    '',
  ].join('\n');

  const copyText = [
    '// GENERATED FILE — do not edit by hand.',
    '//',
    '// THE WORDS STAFF READ while picking a site style: the style names, the',
    '// one-line summaries, who each style suits, and the label and reason for',
    '// every curated choice. Nothing here renders anything — the values that',
    '// render are `packages/shared/src/presetCatalog.cjs`, and the design',
    "// prose is `design/tokens/presets/README.md`. This file rides the admin's",
    '// lazily-loaded chunk, so no public page and no Cloud Function carries it.',
    '//',
    '// Source of truth: design/tokens/presets/*.json.',
    '// Regenerate with `node scripts/build-preset-catalog.cjs`.',
    '// `scripts/build-preset-catalog.test.cjs` fails when this file is stale.',
    '',
    `export const PRESET_COPY = Object.freeze(${jsValue(copy)});`,
    '',
    '/**',
    ' * The words for one style. A style the catalog does not know returns',
    ' * null, so a caller states the id rather than rendering `undefined`.',
    ' *',
    ' * @param {string} id',
    ' * @returns {object|null}',
    ' */',
    'export function presetCopy(id) {',
    '  return Object.prototype.hasOwnProperty.call(PRESET_COPY, id) ? PRESET_COPY[id] : null;',
    '}',
    '',
    '/**',
    ' * The words for one choice in one option group.',
    ' *',
    ' * @param {string} id a style id',
    ' * @param {string} group an option group id',
    ' * @param {string} choiceId',
    ' * @returns {{ label: string, why: string }|null}',
    ' */',
    'export function choiceCopy(id, group, choiceId) {',
    '  return presetCopy(id)?.options?.[group]?.choices?.[choiceId] ?? null;',
    '}',
    '',
  ].join('\n');

  return { runtime, remaps: remapsText, copy: copyText, doc: buildPresetDoc(sources) };
}

if (require.main === module) {
  const built = buildPresetCatalog();
  const check = process.argv.includes('--check');
  const outputs = [
    [TARGET, built.runtime],
    [REMAPS_TARGET, built.remaps],
    [COPY_TARGET, built.copy],
    [DOC_TARGET, built.doc],
  ];
  let stale = 0;
  for (const [file, text] of outputs) {
    const relative = path.relative(ROOT, file);
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (check) {
      if (current !== text) {
        stale += 1;
        process.stderr.write(
          `${relative} is stale. Run: node scripts/build-preset-catalog.cjs\n`,
        );
      }
    } else if (current !== text) {
      fs.writeFileSync(file, text);
      process.stdout.write(`wrote ${relative}\n`);
    } else {
      process.stdout.write(`${relative} is up to date\n`);
    }
  }
  if (stale > 0) process.exitCode = 1;
}

module.exports = {
  buildPresetCatalog,
  PRESET_ORDER,
  TARGET,
  REMAPS_TARGET,
  COPY_TARGET,
  DOC_TARGET,
  TOKENS_DIR,
  PRESETS_DIR,
};
