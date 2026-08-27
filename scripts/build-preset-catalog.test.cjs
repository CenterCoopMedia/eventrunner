'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const {
  buildPresetCatalog,
  PRESET_ORDER,
  TARGET,
  COPY_TARGET,
  DOC_TARGET,
} = require('./build-preset-catalog.cjs');
const { PRESETS, ADMIN_TOKEN_SET, THEME_MOTIF_SET_IDS } = require('shared/theme');

test('all three committed outputs match the design tokens they mirror', () => {
  // The source of truth is design/tokens/. One read of it writes three
  // files, split by who reads them: the rendering values that reach Cloud
  // Functions, the words the theme editor puts on screen, and the design
  // prose a human reads. A stale mirror would let the browser and the
  // publish path resolve a style differently, or let the editor describe a
  // choice the catalog no longer offers.
  const built = buildPresetCatalog();
  const stale = (file) => `${file} is stale — run node scripts/build-preset-catalog.cjs`;
  assert.equal(fs.readFileSync(TARGET, 'utf8'), built.runtime, stale(TARGET));
  assert.equal(fs.readFileSync(COPY_TARGET, 'utf8'), built.copy, stale(COPY_TARGET));
  assert.equal(fs.readFileSync(DOC_TARGET, 'utf8'), built.doc, stale(DOC_TARGET));
});

test('the runtime catalog carries rendering values and no prose', () => {
  // Owner review 2026-08-27. `packages/shared` is packed into
  // functions/vendor and uploaded on every deploy, where a style's name and
  // the reason behind a curated choice cannot be read by anything. The
  // runtime catalog carries what renders; the words live beside the editor
  // that shows them, and the design notes live in the documentation
  // catalog.
  const prose = ['label', 'summary', 'bestFor', 'why', 'prompt'];
  const found = [];
  const walk = (value, trail) => {
    if (Array.isArray(value)) return value.forEach((inner) => walk(inner, trail));
    if (!value || typeof value !== 'object') return;
    for (const [key, inner] of Object.entries(value)) {
      if (prose.includes(key)) found.push(`${trail}.${key}`);
      walk(inner, `${trail}.${key}`);
    }
  };
  walk(PRESETS, 'PRESETS');
  assert.deepEqual(found, []);

  // What it does carry is everything the resolver asks it for.
  for (const [id, preset] of Object.entries(PRESETS)) {
    assert.deepEqual(
      Object.keys(preset).filter((key) => key !== 'componentFonts' && key !== 'tokens').sort(),
      ['fonts', 'id', 'motifSet', 'options', 'palette', 'shape'],
      `${id} carries the rendering values and nothing else`,
    );
  }

  // And the copy output carries a word for every id the runtime offers.
  const copy = fs.readFileSync(COPY_TARGET, 'utf8');
  for (const [id, preset] of Object.entries(PRESETS)) {
    assert.match(copy, new RegExp(`(^|\\W)'?${id}'?:`, 'm'), `${id} has copy`);
    for (const group of Object.keys(preset.options)) {
      assert.match(copy, new RegExp(`${group}:`), `${id}.${group} has copy`);
    }
  }
});

test('the documentation catalog names every style and marks the recommended choice', () => {
  const doc = fs.readFileSync(DOC_TARGET, 'utf8');
  assert.match(doc, /GENERATED FILE/);
  for (const id of PRESET_ORDER) {
    assert.ok(doc.includes(`\`data-theme="${id}"\``), `${id} is documented`);
  }
  // One "(recommended)" marker per option group across the whole catalog.
  const groups = Object.values(PRESETS).reduce(
    (total, preset) => total + Object.keys(preset.options).length,
    0,
  );
  assert.equal(doc.match(/\*\(recommended\)\*/g).length, groups);
});

test('the mirror carries every preset, and carries no note key', () => {
  assert.deepEqual(Object.keys(PRESETS), [...PRESET_ORDER]);
  const noteKeys = [];
  const walk = (value) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== 'object') return;
    for (const [key, inner] of Object.entries(value)) {
      if (key.startsWith('$')) noteKeys.push(key);
      walk(inner);
    }
  };
  walk(PRESETS);
  walk(ADMIN_TOKEN_SET);
  assert.deepEqual(noteKeys, [], 'notes are for the JSON reader; the mirror carries data only');
});

test('every preset states the whole contract the brief §4 requires', () => {
  for (const [id, preset] of Object.entries(PRESETS)) {
    assert.equal(preset.id, id);

    // Two authored palettes, the same roles in both. "Dark mode is its own
    // palette. It is never light mode reversed" (brief §3.3).
    assert.deepEqual(
      Object.keys(preset.palette.light).sort(),
      Object.keys(preset.palette.dark).sort(),
      `${id} defines every role in both modes`,
    );
    for (const [role, light] of Object.entries(preset.palette.light)) {
      assert.notDeepEqual(
        light,
        preset.palette.dark[role],
        `${id} ${role}: the dark value is authored, never the light one reused`,
      );
    }
    // Grounds are tonal: no ground is pure white and no ground is pure
    // black, and the darkest ink is never pure black.
    for (const mode of ['light', 'dark']) {
      for (const role of ['surface', 'surfaceAlt', 'ink', 'inkMuted']) {
        const value = preset.palette[mode][role];
        assert.notDeepEqual(value, [255, 255, 255], `${id} ${mode} ${role} is not pure white`);
        assert.notDeepEqual(value, [0, 0, 0], `${id} ${mode} ${role} is not pure black`);
      }
    }

    // All four font roles (brief §3.2), a shape, and a motif default.
    assert.deepEqual(Object.keys(preset.fonts).sort(), ['body', 'data', 'heading', 'mono']);
    assert.ok(preset.shape.radius && preset.shape.texture && preset.shape.density, `${id} shape`);
    assert.ok(THEME_MOTIF_SET_IDS.includes(preset.motifSet), `${id} names a real motif set`);

    // "Every preset ships two or three heading faces, three nameplate
    // treatments, and two or three component style variants" (brief §4).
    assert.equal(preset.options.headingFace.choices.length >= 2, true, `${id} heading options`);
    assert.equal(preset.options.nameplate.choices.length, 3, `${id} nameplate treatments`);
    assert.equal(preset.options.component.choices.length >= 2, true, `${id} component variants`);

    for (const [group, spec] of Object.entries(preset.options)) {
      const ids = spec.choices.map((choice) => choice.id);
      assert.equal(new Set(ids).size, ids.length, `${id} ${group}: choice ids are unique`);
      assert.ok(ids.includes(spec.default), `${id} ${group}: the default is one of the choices`);
      for (const choice of spec.choices) {
        // A choice remaps tokens, or fonts, or both — never nothing.
        assert.ok(
          choice.tokens || choice.fonts,
          `${id} ${group}/${choice.id} remaps something`,
        );
      }
    }
  }
});

test('the two illustrated styles ship their own set on; the other four ship none', () => {
  // Brief §3.8 binds both: "Field Guide ships with `botanical` on by
  // default. Atlas ships with `cartographic` on by default." The linework is
  // what makes those two styles observational and cartographic rather than
  // merely serif and merely sans, and the site renders a motif in three
  // slots only, so the §2.3 density cap holds without turning the set off.
  assert.equal(PRESETS['field-guide'].motifSet, 'botanical');
  assert.equal(PRESETS.atlas.motifSet, 'cartographic');
  for (const id of ['broadsheet', 'newsroom', 'zine', 'civic']) {
    assert.equal(PRESETS[id].motifSet, 'none', `${id} ships motifs off`);
  }
});

test('a texture is opted into by name; only Zine opts in', () => {
  // Nothing paints a texture it did not ask for: the CSS gate requires
  // [data-texture='paper'] explicitly (apps/web/src/index.css), so a style
  // that names nothing renders flat and a first paint cannot leak a dot
  // pattern. Zine names `paper` on purpose — the copier grain is what "made
  // at a copier" looks like, and brief §4.3 allows it there and only there.
  assert.equal(PRESETS.zine.shape.texture, 'paper');
  for (const id of Object.keys(PRESETS)) {
    if (id === 'zine') continue;
    assert.equal(PRESETS[id].shape.texture, 'flat', `${id} ships flat`);
  }
});

test('Zine reads long-form prose in a text face, and keeps the mono for values', () => {
  // Owner review 2026-08-27. A mono body is a poor face for a rich-text
  // page or a session description. The typewriter stays where a reader
  // compares or copies a value.
  assert.equal(PRESETS.zine.fonts.body, 'sans-humanist');
  assert.equal(PRESETS.zine.fonts.data, 'fragment-mono');
  assert.equal(PRESETS.zine.fonts.mono, 'fragment-mono');
});

test('the stamp is Zine only, and Zine ships the flat-block variant beside it', () => {
  // Brief §2.4 exception two: the offset layer ships in the Zine preset
  // only, and no client override may bring it to another preset.
  const stamped = PRESETS.zine.options.component.choices;
  assert.ok(stamped.some((choice) => choice.tokens['--session-card-stamp-offset'] !== '0'));
  assert.ok(stamped.some((choice) => choice.tokens['--session-card-stamp-offset'] === '0'));
  // The choice that draws the layer tints it. Zine spends the accent at full
  // strength twice a page (visual story, Zine), and a stamp prints on every
  // row, so a full-strength layer would spend the rare accent twenty times
  // and read as the coloured card edge §2.4 rejects.
  const drawn = stamped.filter((choice) => choice.tokens['--session-card-stamp-offset'] !== '0');
  for (const choice of drawn) {
    const alpha = Number(choice.tokens['--session-card-stamp-alpha']);
    assert.ok(alpha > 0 && alpha < 1, `${choice.id} tints the stamp rather than printing it at full ink`);
  }
  for (const [id, preset] of Object.entries(PRESETS)) {
    if (id === 'zine') continue;
    const remaps = [
      ...Object.keys(preset.tokens || {}),
      ...Object.values(preset.options).flatMap(
        (group) => group.choices.flatMap((choice) => Object.keys(choice.tokens || {})),
      ),
    ];
    assert.equal(
      remaps.includes('--session-card-stamp-offset'),
      false,
      `${id} never touches the stamp`,
    );
    assert.equal(
      remaps.includes('--session-card-stamp-alpha'),
      false,
      `${id} never touches the stamp`,
    );
  }
});
