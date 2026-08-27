'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { buildPresetCatalog, PRESET_ORDER, TARGET } = require('./build-preset-catalog.cjs');
const { PRESETS, ADMIN_TOKEN_SET, THEME_MOTIF_SET_IDS } = require('shared/theme');

test('the committed catalog matches the design tokens it mirrors', () => {
  // The source of truth is design/tokens/. This file is the mirror that
  // reaches Cloud Functions, where only functions/ is uploaded and
  // packages/shared arrives as a packed tarball. A stale mirror would let
  // the browser and the publish path resolve a preset differently.
  assert.equal(
    fs.readFileSync(TARGET, 'utf8'),
    buildPresetCatalog(),
    'packages/shared/src/presetCatalog.cjs is stale — run node scripts/build-preset-catalog.cjs',
  );
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
    assert.ok(preset.label, `${id} has a label`);
    assert.ok(preset.summary, `${id} states its personality in one line`);

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
        // "The visual-story specs define the options and state, one sentence
        // each, why an option still belongs" (brief §4).
        assert.ok(choice.label, `${id} ${group}/${choice.id} has a label`);
        assert.ok(choice.why && choice.why.length > 20, `${id} ${group}/${choice.id} says why`);
      }
    }
  }
});

test('only Atlas ships a motif set on; the other five ship none', () => {
  // Brief §4 defaults, as the owner review left them (2026-08-27). Field
  // Guide shipped `botanical` on; drawings on every page of a client's real
  // programme read as decoration rather than observation, so the set became
  // something a client turns on. Atlas keeps `cartographic`, because its
  // marks are wayfinding and its schedule is the sheet they belong to.
  assert.equal(PRESETS['field-guide'].motifSet, 'none');
  assert.equal(PRESETS.atlas.motifSet, 'cartographic');
  for (const id of ['broadsheet', 'newsroom', 'zine', 'civic']) {
    assert.equal(PRESETS[id].motifSet, 'none', `${id} ships motifs off`);
  }
});

test('every style ships a flat surface; paper texture is something a client turns on', () => {
  // Owner review 2026-08-27: flat surfaces are the shared default
  // everywhere. Zine's copier grain and Field Guide's paper tone are both
  // still available; neither is what a fresh site renders.
  for (const id of Object.keys(PRESETS)) {
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
  }
});
