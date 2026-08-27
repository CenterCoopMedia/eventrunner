'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildTokenCss,
  loadTokens,
  resolveAdminTokens,
  resolveColorTokens,
  resolveFonts,
  modePolicy,
  TOKENS_DIR,
  TOKEN_FILES,
} = require('./tokens.cjs');
const { defaultTheme, FONT_SETS } = require('./theme.cjs');
const {
  DARK_GROUND_RGB,
  THEME_FONT_ROLES,
  THEME_FONT_SET_IDS,
  THEME_MOTIF_SET_IDS,
  THEME_PRESET_IDS,
  getPreset,
} = require('shared/theme');

const THEME = defaultTheme();

test('the token files load, and a missing one fails the build by name', () => {
  const tokens = loadTokens();
  assert.deepEqual(Object.keys(tokens).sort(), Object.keys(TOKEN_FILES).sort());
  assert.ok(tokens.semantic.color['--brand-primary-rgb']);

  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'tokens-'));
  assert.throws(() => loadTokens(empty), /primitives\.json could not be read/);

  const broken = fs.mkdtempSync(path.join(os.tmpdir(), 'tokens-'));
  for (const file of Object.values(TOKEN_FILES)) {
    fs.writeFileSync(path.join(broken, file), file === 'semantic.json' ? '{oops' : '{}');
  }
  assert.throws(() => loadTokens(broken), /semantic\.json is not valid JSON/);
});

test('the dark ground in primitives.json matches the code that derives dark mode', () => {
  // Two places carry these numbers: the token JSON (the design source of
  // truth) and packages/shared/src/theme.cjs (the derivation the browser
  // runtime also runs). This test is the reason they cannot drift.
  const { primitives } = loadTokens();
  assert.deepEqual(primitives.color.ground['900'], [...DARK_GROUND_RGB.surface]);
  assert.deepEqual(primitives.color.ground['800'], [...DARK_GROUND_RGB.surfaceAlt]);
  assert.deepEqual(primitives.color.bone['100'], [...DARK_GROUND_RGB.ink]);
  assert.deepEqual(primitives.color.bone['300'], [...DARK_GROUND_RGB.inkMuted]);
});

test('the design token JSON files carry no color literal', () => {
  for (const file of Object.values(TOKEN_FILES)) {
    const raw = fs.readFileSync(path.join(TOKENS_DIR, file), 'utf8');
    assert.doesNotMatch(raw, /#[0-9a-fA-F]{3,8}\b/, `${file} carries a hex color`);
  }
});

test('every color token resolves in both modes, and none is left behind in dark', () => {
  const { names, values } = resolveColorTokens(THEME, loadTokens());
  assert.ok(names.length > 20, 'the palette is not nearly empty');
  for (const name of names) {
    assert.match(name, /-rgb$/, `${name} is a color token, so its name ends in -rgb`);
    assert.ok(values.light[name], `${name} has a light value`);
    assert.ok(values.dark[name], `${name} has a dark value`);
  }
});

test('the seed palette spelling and the admin spelling both resolve', () => {
  // The seed writes brandPrimary; the Branding tab writes primary. Both
  // reach the same token on a document that has no preset — the shape every
  // deployment made before presets existed still has.
  const legacy = { colors: { brandPrimary: THEME.colors.primary } };
  const fromAdmin = { colors: { primary: THEME.colors.primary } };
  assert.equal(
    resolveColorTokens(legacy, loadTokens()).values.light['--brand-primary-rgb'],
    resolveColorTokens(fromAdmin, loadTokens()).values.light['--brand-primary-rgb'],
  );
});

test('a document with no preset and no colors emits no color token at all', () => {
  const { names } = resolveColorTokens({ colors: {} }, loadTokens());
  assert.deepEqual(names, []);
});

test('naming a preset is enough: the palette needs no stored colors', () => {
  // Brief §5.2. A client who runs a preset with no overrides stores no
  // colors, and the stylesheet must still be complete.
  const { names, values } = resolveColorTokens({ preset: 'zine' }, loadTokens());
  assert.ok(names.length > 20);
  const zine = getPreset('zine');
  assert.equal(values.light['--brand-surface-rgb'], zine.palette.light.surface.join(' '));
  assert.equal(values.dark['--brand-surface-rgb'], zine.palette.dark.surface.join(' '));
});

test('for a preset document, stored colors are an output and never an input', () => {
  // Otherwise a stale colors map from the previous preset would pin the new
  // one, and switching presets would do nothing (brief §5.2).
  const stale = { preset: 'atlas', colors: { surface: `#${'ff00ff'}` } };
  const { values } = resolveColorTokens(stale, loadTokens());
  assert.equal(values.light['--brand-surface-rgb'], getPreset('atlas').palette.light.surface.join(' '));
});

test('a document from before the data role still resolves every font role', () => {
  const legacy = { fonts: { heading: 'serif-editorial', body: 'sans-humanist' } };
  const { stacks, faces } = resolveFonts(legacy);
  // Only the roles the document names resolve to a stack here.
  assert.deepEqual(Object.keys(stacks).sort(), ['body', 'heading']);
  assert.deepEqual(
    [...new Set(faces.map((f) => f.family))].sort(),
    ['Source Sans 3', 'Source Serif 4'],
  );

  // The alias list covers the rest, so the stylesheet still defines all four.
  const css = buildTokenCss(legacy);
  for (const role of THEME_FONT_ROLES) {
    assert.match(css, new RegExp(`--font-${role}:`), `--font-${role} is defined`);
  }
  assert.match(css, /--font-data: var\(--font-body\);/);
  assert.match(css, /--font-mono: var\(--font-data\);/);
});

test('the mode policy defaults to light and refuses an unknown value', () => {
  assert.equal(modePolicy({ mode: 'dark' }), 'dark');
  assert.equal(modePolicy({ mode: 'system' }), 'system');
  assert.equal(modePolicy({}), 'light');
  assert.equal(modePolicy({ mode: 'sepia' }), 'light');
});

test('the stylesheet carries a baseline, both mode blocks, and no hex', () => {
  const css = buildTokenCss(THEME);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
  // The attribute-free baseline is what first paint renders before the
  // runtime writes data-mode.
  assert.match(css, /\n:root \{\n {2}--brand-primary-rgb/);
  assert.match(css, /:root\[data-mode='light'\] \{/);
  assert.match(css, /:root\[data-mode='dark'\] \{/);
  assert.match(css, /--rule-hairline-width: var\(--er-width-hairline\);/);
  assert.match(css, /--text-nameplate: clamp\(/);
  assert.match(css, /--space-3xl: var\(--er-space-3xl\);/);
  assert.match(css, /--motif-set: none;/);
  assert.doesNotMatch(css, /--font-accent/, 'PR2 removed the retired role (brief §7)');
});

test("a light deployment gets no first-paint override; dark and system do", () => {
  assert.doesNotMatch(buildTokenCss({ ...THEME, mode: 'light' }), /:root:not\(\[data-mode\]\)/);

  const dark = buildTokenCss({ ...THEME, mode: 'dark' });
  assert.match(dark, /:root:not\(\[data-mode\]\) \{/);
  assert.doesNotMatch(dark, /prefers-color-scheme/);

  const system = buildTokenCss({ ...THEME, mode: 'system' });
  assert.match(system, /@media \(prefers-color-scheme: dark\) \{/);
  assert.match(system, /:root:not\(\[data-mode\]\) \{/);
});

test('the admin set gets the first-paint block too, on the same policy', () => {
  // The admin renders on the same page and paints the same first frame. Its
  // only attribute-free baseline is the LIGHT one, so without this block a
  // dark or system deployment flashed the light room before React wrote
  // data-mode — the public palette had the fix and the admin did not.
  const { names, values } = resolveAdminTokens(THEME, loadTokens());
  const marker = names[0];
  const firstPaint = (css) =>
    [...css.matchAll(/:root:not\(\[data-mode\]\) \{([^}]*)\}/g)].map((m) => m[1]);

  // Light: no first-paint block at all, admin or palette.
  assert.deepEqual(firstPaint(buildTokenCss({ ...THEME, mode: 'light' })), []);

  for (const mode of ['dark', 'system']) {
    const blocks = firstPaint(buildTokenCss({ ...THEME, mode }));
    const adminBlock = blocks.find((block) => block.includes(`${marker}:`));
    assert.ok(adminBlock, `the ${mode} policy gives the admin set a first-paint block`);
    for (const name of names) {
      assert.match(
        adminBlock,
        new RegExp(`${name}: ${values.dark[name].replace(/[()]/g, '\\$&')};`),
        `${name} paints its DARK value before data-mode lands`,
      );
    }
    // The palette keeps its own block: two sets, two blocks, one policy.
    assert.equal(blocks.length, 2, `${mode} emits one first-paint block per token set`);
  }

  // Under 'system' both blocks sit inside the media query, so a reader whose
  // setting is light never sees either of them.
  const system = buildTokenCss({ ...THEME, mode: 'system' });
  const queries = [...system.matchAll(/@media \(prefers-color-scheme: dark\) \{([\s\S]*?)\n\}/g)];
  assert.equal(queries.length, 2);
  assert.ok(queries.some((q) => q[1].includes(`${marker}:`)), 'the admin block is inside the query');
});


// ------------------------------------------------------- presets (brief §4)

test('every preset gets a block per mode, and none introduces a property name', () => {
  const css = buildTokenCss(THEME);
  const baseline = new Set(
    [...css.matchAll(/(--[\w-]+):/g)].map((m) => m[1]),
  );
  for (const id of THEME_PRESET_IDS) {
    for (const mode of ['light', 'dark']) {
      const block = new RegExp(
        `\\[data-theme='${id}'\\]\\[data-mode='${mode}'\\] \\{([^}]*)\\}`,
      );
      const found = css.match(block);
      assert.ok(found, `${id} has a ${mode} block`);
      const names = [...found[1].matchAll(/(--[\w-]+):/g)].map((m) => m[1]);
      assert.ok(names.length > 20, `${id} ${mode} is not nearly empty`);
      for (const name of names) {
        assert.ok(baseline.has(name), `${name} is already declared: a theme remaps, never adds`);
      }
    }
  }
});

test('every palette block matches a scoped element as well as :root', () => {
  // The admin's live-preview frame renders the client's real pages inside a
  // hairline chase on the admin ground (brief §5.2). It carries data-theme,
  // data-mode, and data-motif-set itself, so each palette block has to match
  // an element that is not the root — otherwise the frame would inherit the
  // room's values and the preview would be a lie. The admin blocks stay
  // root-only, which is what keeps "emitted once per mode" narrow.
  const css = buildTokenCss(THEME);
  for (const attributes of [
    "[data-mode='light']",
    "[data-mode='dark']",
    "[data-theme='zine'][data-mode='dark']",
    "[data-motif-set='botanical']",
  ]) {
    const escaped = attributes.replace(/[[\]]/g, '\\$&');
    assert.match(css, new RegExp(`:root${escaped},\n${escaped} \\{`), `${attributes} is scoped`);
  }
  const adminBlock = css.match(/Admin identity — dark[^{]*\{/);
  assert.ok(adminBlock, 'the admin dark block exists');
  assert.match(adminBlock[0], /:root\[data-mode='dark'\] \{/);
});

test("the active preset's block carries this deployment's overrides", () => {
  // A [data-theme][data-mode] block outranks the attribute-free baselines,
  // so the active pair has to carry the same resolved palette they do.
  const override = `#${'123456'}`;
  const css = buildTokenCss({ preset: 'civic', tokens: { light: { surface: override } } });
  const active = css.match(/\[data-theme='civic'\]\[data-mode='light'\] \{([^}]*)\}/);
  assert.match(active[1], /--brand-surface-rgb: 18 52 86;/);
  // A preset that is not active keeps its own designed palette.
  const other = css.match(/\[data-theme='atlas'\]\[data-mode='light'\] \{([^}]*)\}/);
  assert.match(
    other[1],
    new RegExp(`--brand-surface-rgb: ${getPreset('atlas').palette.light.surface.join(' ')};`),
  );
});

test('every option a preset offers remaps a token the contracts already declare', () => {
  // Brief §3.4: an option remaps existing tier 2 and tier 3 tokens. It never
  // adds a property name, never adds a class, never adds a component type.
  const declared = new Set(
    [...buildTokenCss(THEME).matchAll(/(--[\w-]+):/g)].map((m) => m[1]),
  );
  for (const id of THEME_PRESET_IDS) {
    const preset = getPreset(id);
    const remaps = [
      ...Object.keys(preset.tokens || {}),
      ...Object.values(preset.options || {}).flatMap(
        (group) => group.choices.flatMap((choice) => Object.keys(choice.tokens || {})),
      ),
    ];
    for (const name of remaps) {
      assert.ok(declared.has(name), `${id} remaps ${name}, which no contract declares`);
    }
  }
});

test('every face a preset or an option names is a bundled set with a real file', () => {
  for (const id of THEME_PRESET_IDS) {
    const preset = getPreset(id);
    const named = [
      ...Object.values(preset.fonts || {}),
      ...Object.values(preset.componentFonts || {}),
      ...Object.values(preset.options || {}).flatMap(
        (group) => group.choices.flatMap((choice) => Object.values(choice.fonts || {})),
      ),
    ];
    for (const setId of named) {
      assert.ok(THEME_FONT_SET_IDS.includes(setId), `${id} names the font set ${setId}`);
      const set = FONT_SETS[setId];
      assert.ok(set && set.faces.length > 0, `${setId} has at least one face`);
      for (const face of set.faces) {
        const file = path.join(
          __dirname, '..', '..', 'apps', 'web', 'public', 'fonts', `${face.file}.woff2`,
        );
        assert.ok(fs.existsSync(file), `${face.file}.woff2 is bundled`);
        assert.ok(
          fs.statSync(file).size < 60 * 1024,
          `${face.file}.woff2 subsets to a Latin woff2 under 60KB (brief §9, test 2)`,
        );
      }
    }
  }
});

test('every face a live switch can reach is declared, whatever the build-time preset', () => {
  // config/theme arrives over onSnapshot, so the type map is LIVE: publishing
  // a preset, picking a heading-face option, naming a role outright in
  // config/theme.fonts, or opening the admin's theme preview all route
  // through buildRuntimeThemeCss, which writes a --font-* stack. A stack
  // naming a family this stylesheet never declared renders the FALLBACK. So
  // the declarations cover every bundled set, not just the one the build
  // happened to start on.
  const css = buildTokenCss({ preset: 'zine' });
  const declared = new Set([...css.matchAll(/font-family: '([^']+)'/g)].map((m) => m[1]));
  for (const setId of THEME_FONT_SET_IDS) {
    const set = FONT_SETS[setId];
    assert.ok(set, `${setId} is a bundled set`);
    assert.ok(declared.has(set.family), `${set.family} is declared, so a live switch to it renders`);
  }
  // Including the families a document could never have named at build time.
  assert.match(css, /src: url\('\/fonts\/overpass-latin\.woff2'\)/);
  assert.match(css, /src: url\('\/fonts\/merriweather-700-latin\.woff2'\)/);

  // Brief §4 — "a deployed site loads only the faces its active preset and
  // its picked options use" — is a statement about DOWNLOADS, and this test
  // cannot measure a download. What keeps it true is that @font-face is lazy
  // by specification: the browser fetches the file only when a rendered
  // element resolves to the family. So the two facts the generator can be
  // held to are the ones asserted here — every reachable family is declared,
  // and each declaration points at a bundled file and nothing else.
  const files = [...css.matchAll(/src: url\('\/fonts\/([^']+)\.woff2'\)/g)].map((m) => m[1]);
  assert.equal(new Set(files).size, files.length, 'no file is declared twice');
  for (const file of files) {
    const bundled = path.join(
      __dirname, '..', '..', 'apps', 'web', 'public', 'fonts', `${file}.woff2`,
    );
    assert.ok(fs.existsSync(bundled), `${file}.woff2 is bundled, so no request 404s`);
  }
  assert.doesNotMatch(css, /src: url\('https?:/, 'no font CDN at runtime (spec §7.4)');
});

test('a picked heading option changes the face the heading role resolves to', () => {
  const css = buildTokenCss({ preset: 'zine', optionPicks: { headingFace: 'avara' } });
  assert.match(css, /--font-heading: 'Avara'/);
  assert.match(css, /src: url\('\/fonts\/avara-latin\.woff2'\)/);
  // Karrik stays DECLARED — the operator can pick it back without a rebuild —
  // but nothing resolves to it, so nothing renders it and nothing fetches it.
  assert.match(css, /src: url\('\/fonts\/karrik-latin\.woff2'\)/);
  assert.doesNotMatch(css, /--font-heading: 'Karrik'/);
});

// ------------------------------------------------- the admin set (brief §8.2)

test('the admin set is emitted once per mode and never inside a theme block', () => {
  // THEME is the light default, so the two occurrences are exactly the two
  // modes. A dark or system deployment repeats the dark values once more
  // under :root:not([data-mode]) — the first-paint block above — and that
  // repeat is per POLICY, still never per theme.
  const css = buildTokenCss(THEME);
  const { names } = resolveAdminTokens(THEME, loadTokens());
  assert.ok(names.length > 20, 'the admin set is not nearly empty');
  for (const name of names) {
    const occurrences = [...css.matchAll(new RegExp(`${name}:`, 'g'))].length;
    assert.equal(occurrences, 2, `${name} is declared once per mode, not once per theme`);
  }
  // The mechanical statement of "the admin ignores data-theme".
  for (const block of css.matchAll(/:root\[data-theme='[\w-]+'\]\[data-mode='\w+'\] \{([^}]*)\}/g)) {
    assert.doesNotMatch(block[1], /--admin-/, 'no admin token rides a theme block');
  }
});

test('the admin marker takes the resolved brand colour, and falls back to admin ink when it cannot be read', () => {
  // Owner review 2026-08-27: there is no separate admin marker colour to
  // pick. The marker takes the brand colour the site itself paints. The
  // legibility floor from admin story part 6f is unchanged and still does
  // the work — never clamp, never render an invisible marker.
  const readable = buildTokenCss(THEME);
  const ok = readable.match(/:root,\n:root\[data-mode='light'\] \{([^}]*)\}/);
  assert.match(ok[1], /--admin-client-accent-rgb: 26 82 150;/, "the style's own primary");

  // A client brand colour reaches the marker through the same path, derived
  // to clear the site's own contrast bar first.
  const branded = buildTokenCss({ ...THEME, brandColor: `#${'7a1f3d'}` });
  const brandedLight = branded.match(/:root,\n:root\[data-mode='light'\] \{([^}]*)\}/);
  assert.match(brandedLight[1], /--admin-client-accent-rgb: 122 31 61;/);

  // The floor still fires where the resolved brand colour cannot sit on an
  // admin ground: a pre-preset deployment on a dark ground resolves a
  // near-white primary, and the LIGHT admin ground is light.
  const unreadable = buildTokenCss({
    colors: {
      primary: `#${'ebe8e3'}`,
      surface: `#${'111111'}`,
      ink: `#${'ffffff'}`,
    },
  });
  const light = unreadable.match(/:root,\n:root\[data-mode='light'\] \{([^}]*)\}/);
  assert.match(light[1], /--admin-client-accent-rgb: 28 27 25;/, 'falls back to admin ink');
});

// ------------------------------------------------ the motif layer (brief §3.8)

test('every motif set gets a slot-resolution block, and its assets exist', () => {
  const css = buildTokenCss(THEME);
  const { motifs } = loadTokens();
  assert.deepEqual(Object.keys(motifs.sets).sort(), [...THEME_MOTIF_SET_IDS].sort());
  for (const [setId, set] of Object.entries(motifs.sets)) {
    const block = css.match(new RegExp(`\\[data-motif-set='${setId}'\\] \\{([^}]*)\\}`));
    assert.ok(block, `${setId} has a slot-resolution block`);
    assert.match(block[1], new RegExp(`--motif-set: ${setId};`));
    for (const slot of motifs.slots) {
      assert.match(block[1], new RegExp(`--motif-${slot}:`), `${setId} resolves ${slot}`);
      const asset = set.slots[slot];
      if (!asset) continue;
      const file = path.join(
        __dirname, '..', '..', 'apps', 'web', 'public', 'motifs', set.assetDir, asset,
      );
      assert.ok(fs.existsSync(file), `${setId}/${asset} is shipped`);
      const svg = fs.readFileSync(file, 'utf8');
      // A motif inherits theme ink and carries no color of its own (§2.3).
      assert.doesNotMatch(svg, /#[0-9a-fA-F]{3,8}\b/, `${setId}/${asset} carries no color literal`);
      assert.doesNotMatch(svg, /rgb\(/, `${setId}/${asset} carries no color literal`);
    }
  }
});

test('a preset that ships a motif set on gets it as the baseline too', () => {
  const css = buildTokenCss({ preset: 'field-guide' });
  assert.match(css, /--motif-set: botanical;/);
  assert.match(css, /--motif-nameplate-mark: url\('\/motifs\/botanical\/nameplate-mark\.svg'\);/);
  // A client may switch a set or turn motifs off (brief §3.8).
  assert.match(buildTokenCss({ preset: 'field-guide', motifSet: 'none' }), /--motif-set: none;/);
});
