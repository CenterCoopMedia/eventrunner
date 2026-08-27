'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  THEME_MODE_POLICIES,
  DEFAULT_MODE_POLICY,
  THEME_FONT_ROLES,
  THEME_COLOR_KEYS,
  THEME_COLOR_KEY_ALIASES,
  canonicalColorKey,
  DARK_GROUND_RGB,
  DARK_MIN_CONTRAST,
  DARK_MIN_CONTRAST_UI,
  THEME_CONTRAST_PAIRS,
  THEME_PRESET_IDS,
  THEME_DOC_KEYS,
  ADMIN_TOKEN_SET,
  DEFAULT_PRESET_ID,
  recommendedConfiguration,
  deriveBrandSteps,
  resolveAdminAccent,
  resolveThemePalettes,
  findThemeContrastFailures,
  getPreset,
  resolveComponentFonts,
  resolveFontRoles,
  resolveMotifSet,
  resolvePresetTokens,
  resolveShape,
  rgbToHex,
  contrastRatio,
  relativeLuminance,
  mixRgb,
  liftToContrast,
  deriveDarkColors,
  deriveRuleColors,
  resolveMode,
} = require('./theme.cjs');

/** WCAG 1.4.11: the non-text bar a form-control boundary must clear. */
const CONTROL_BORDER_MIN_CONTRAST = 3;

/** The demo event's light palette, as RGB triples (no hex literals here). */
const LIGHT = {
  primary: [21, 94, 117],
  primaryDark: [12, 66, 82],
  primaryLight: [79, 147, 166],
  accent: [154, 52, 18],
  surface: [247, 247, 245],
  surfaceAlt: [236, 236, 234],
  ink: [22, 33, 44],
  inkMuted: [71, 82, 94],
  success: [22, 101, 52],
  warning: [180, 83, 9],
  danger: [185, 28, 28],
  highlight: [161, 98, 7],
  keynote: [109, 40, 217],
};

test('relative luminance runs from black to white', () => {
  assert.equal(relativeLuminance([0, 0, 0]), 0);
  assert.equal(Math.round(relativeLuminance([255, 255, 255]) * 1000) / 1000, 1);
});

test('contrast is symmetric and tops out at 21:1', () => {
  const white = [255, 255, 255];
  const black = [0, 0, 0];
  assert.equal(Math.round(contrastRatio(white, black)), 21);
  assert.equal(contrastRatio(white, black), contrastRatio(black, white));
  assert.equal(contrastRatio(white, white), 1);
});

test('mixRgb blends between the two ends', () => {
  assert.deepEqual(mixRgb([0, 0, 0], [100, 200, 40], 0), [0, 0, 0]);
  assert.deepEqual(mixRgb([0, 0, 0], [100, 200, 40], 1), [100, 200, 40]);
  assert.deepEqual(mixRgb([0, 0, 0], [100, 200, 40], 0.5), [50, 100, 20]);
});

test('liftToContrast leaves a color alone once it already clears the bar', () => {
  const ground = [...DARK_GROUND_RGB.surface];
  const alreadyBright = [255, 255, 255];
  assert.deepEqual(liftToContrast(alreadyBright, ground), alreadyBright);
});

test('the designed dark ground clears the contrast bar in every text pair', () => {
  const { surface, surfaceAlt, ink, inkMuted } = DARK_GROUND_RGB;
  for (const [textName, text] of [['ink', ink], ['inkMuted', inkMuted]]) {
    for (const [groundName, ground] of [['surface', surface], ['surfaceAlt', surfaceAlt]]) {
      const ratio = contrastRatio(text, ground);
      assert.ok(
        ratio >= DARK_MIN_CONTRAST,
        `${textName} on ${groundName} is ${ratio.toFixed(2)}:1`,
      );
    }
  }
});

test('every derived dark color clears the contrast bar on the dark ground', () => {
  const dark = deriveDarkColors(LIGHT);
  assert.deepEqual(Object.keys(dark).sort(), [...THEME_COLOR_KEYS].sort());
  for (const key of THEME_COLOR_KEYS) {
    if (key === 'surface' || key === 'surfaceAlt') continue;
    // primaryLight is the soft fill step — non-text user interface, so it
    // holds the 3:1 bar rather than the 4.5:1 text bar.
    const bar = key === 'primaryLight' ? DARK_MIN_CONTRAST_UI : DARK_MIN_CONTRAST;
    const ratio = contrastRatio(dark[key], DARK_GROUND_RGB.surface);
    assert.ok(ratio >= bar, `${key} on the dark ground is ${ratio.toFixed(2)}:1`);
  }
});

test('the three brand steps stay in order in dark mode, mirrored', () => {
  const dark = deriveDarkColors(LIGHT);
  // On a dark ground more emphasis is brighter, so the ladder mirrors:
  // the soft step is dimmest and the emphasis step is brightest.
  const soft = relativeLuminance(dark.primaryLight);
  const base = relativeLuminance(dark.primary);
  const emphasis = relativeLuminance(dark.primaryDark);
  assert.ok(soft < base, 'the soft step sits below the brand color');
  assert.ok(base < emphasis, 'the emphasis step sits above the brand color');
});

test('the dark ground and ink are designed, not taken from the light palette', () => {
  const dark = deriveDarkColors(LIGHT);
  for (const key of ['surface', 'surfaceAlt', 'ink', 'inkMuted']) {
    assert.deepEqual(dark[key], [...DARK_GROUND_RGB[key]]);
    assert.notDeepEqual(dark[key], LIGHT[key]);
  }
});

test('a derived dark color keeps its own hue rather than turning grey', () => {
  const dark = deriveDarkColors(LIGHT);
  // The blue-teal brand color stays blue-dominant; the rust accent stays
  // red-dominant. A lift that flattened hue would break both.
  assert.ok(dark.primary[2] > dark.primary[0], 'primary stays blue-dominant');
  assert.ok(dark.accent[0] > dark.accent[2], 'accent stays red-dominant');
});

test('a malformed light palette entry is skipped, not guessed at', () => {
  const dark = deriveDarkColors({ ...LIGHT, primary: 'teal', keynote: undefined });
  assert.equal(dark.primary, undefined);
  assert.equal(dark.keynote, undefined);
  assert.ok(dark.accent);
});

test('rule colors are ink mixed into the surface, hairline lightest', () => {
  const light = deriveRuleColors({ ink: LIGHT.ink, surface: LIGHT.surface });
  assert.deepEqual(Object.keys(light).sort(), ['control', 'hairline', 'nameplate', 'strong']);
  assert.deepEqual(light.nameplate, [...LIGHT.ink]);
  const onSurface = (rgb) => contrastRatio(rgb, LIGHT.surface);
  assert.ok(onSurface(light.hairline) < onSurface(light.control));
  assert.ok(onSurface(light.control) < onSurface(light.strong));
  assert.ok(onSurface(light.strong) < onSurface(light.nameplate));
});

test('the control border clears the 3:1 non-text bar against surface and surfaceAlt, in both modes', () => {
  // WCAG 1.4.11: a form control's boundary needs 3:1 against the ground it
  // actually renders on. Every input in the repo sits on either `surface`
  // or `surfaceAlt` (design brief §3.3's two grounds), so both are checked,
  // and both modes get their own designed ground — dark mode is its own
  // palette, never light mode reversed.
  const light = deriveRuleColors({ ink: LIGHT.ink, surface: LIGHT.surface });
  const lightAlt = deriveRuleColors({ ink: LIGHT.ink, surface: LIGHT.surfaceAlt });
  const dark = deriveRuleColors({ ink: DARK_GROUND_RGB.ink, surface: DARK_GROUND_RGB.surface });
  const darkAlt = deriveRuleColors({
    ink: DARK_GROUND_RGB.ink,
    surface: DARK_GROUND_RGB.surfaceAlt,
  });

  const cases = [
    ['light on surface', light.control, LIGHT.surface],
    ['light on surfaceAlt', lightAlt.control, LIGHT.surfaceAlt],
    ['dark on surface', dark.control, DARK_GROUND_RGB.surface],
    ['dark on surfaceAlt', darkAlt.control, DARK_GROUND_RGB.surfaceAlt],
  ];
  for (const [label, border, ground] of cases) {
    const ratio = contrastRatio(border, ground);
    assert.ok(
      ratio >= CONTROL_BORDER_MIN_CONTRAST,
      `${label}: control border is ${ratio.toFixed(2)}:1, needs >= ${CONTROL_BORDER_MIN_CONTRAST}:1`,
    );
  }
});

test('rule colors invert with the mode, so a rule reads on either ground', () => {
  const dark = deriveRuleColors({
    ink: DARK_GROUND_RGB.ink,
    surface: DARK_GROUND_RGB.surface,
  });
  // On a dark ground the hairline is LIGHTER than the surface it sits on.
  assert.ok(
    relativeLuminance(dark.hairline) > relativeLuminance(DARK_GROUND_RGB.surface),
    'dark hairline lifts off the ground',
  );
});

// ------------------------------------- the publish-time contract (brief §5.2)

test('the contrast contract measures primaryDark on surface, in both directions', () => {
  // CtaBlock paints primaryDark as the hover BACKGROUND under a surface
  // label; LinkGroupBlock and SessionMaterialsList render it as TEXT on
  // surface. Contrast is symmetric, so the one pair covers both — and it is
  // the text bar, because one of the two really is text.
  const pair = THEME_CONTRAST_PAIRS.find(
    (p) => p.foreground === 'primaryDark' && p.background === 'surface',
  );
  assert.ok(pair, 'primaryDark on surface is part of the contract');
  assert.equal(pair.min, 4.5);
});

test('a primaryDark that cannot be read on the surface fails the publish gate', () => {
  // A pre-preset document: its stored colors ARE the light palette, so the
  // failure lands in light mode. The dark mode is derived and lifted, so it
  // clears the bar on its own — which is the point of measuring both.
  const failing = {
    colors: {
      ...Object.fromEntries(
        Object.entries(LIGHT).map(([role, rgb]) => [role, rgbToHex(rgb)]),
      ),
      // Two steps off the surface: fine as a tint, unreadable as a link.
      primaryDark: rgbToHex(mixRgb(LIGHT.surface, LIGHT.primary, 0.2)),
    },
  };
  const failures = findThemeContrastFailures(failing);
  const named = failures.filter((f) => f.foreground === 'primaryDark');
  assert.equal(named.length, 1, 'the pair fails once, in the mode that fails');
  assert.equal(named[0].mode, 'light');
  assert.equal(named[0].background, 'surface');
  assert.match(named[0].message, /primaryDark on surface in light mode is \d+\.\d\d:1/);
  assert.ok(named[0].ratio < 4.5);

  // The same document with its real emphasis step publishes clean.
  const passing = {
    colors: Object.fromEntries(
      Object.entries(LIGHT).map(([role, rgb]) => [role, rgbToHex(rgb)]),
    ),
  };
  assert.deepEqual(findThemeContrastFailures(passing), []);
});

test('every preset passes the whole contract, primaryDark included', () => {
  // A designed palette must pass BY CONSTRUCTION (brief §8.1), so extending
  // the contract has to be checked against the six palettes before it can
  // ship. None of them needed retuning: the emphasis step is darker than the
  // brand color it steps off, and the brand color already clears 4.5:1.
  for (const id of THEME_PRESET_IDS) {
    assert.deepEqual(findThemeContrastFailures({ preset: id }), [], `${id} publishes clean`);
    const preset = getPreset(id);
    for (const mode of ['light', 'dark']) {
      const palette = preset.palette[mode];
      const ratio = contrastRatio(palette.primaryDark, palette.surface);
      assert.ok(
        ratio >= 4.5,
        `${id} ${mode}: primaryDark on surface is ${ratio.toFixed(2)}:1`,
      );
      // And it really is the emphasis step, not a second name for primary.
      assert.notDeepEqual(palette.primaryDark, palette.primary);
    }
  }
});

test('resolveMode reads the policy, and an unknown policy falls back to the default', () => {
  assert.equal(resolveMode('light', true), 'light');
  assert.equal(resolveMode('dark', false), 'dark');
  assert.equal(resolveMode('system', true), 'dark');
  assert.equal(resolveMode('system', false), 'light');
  assert.equal(resolveMode(undefined, true), DEFAULT_MODE_POLICY);
  assert.equal(resolveMode('sepia', true), DEFAULT_MODE_POLICY);
  assert.ok(THEME_MODE_POLICIES.includes(DEFAULT_MODE_POLICY));
});

test('the font roles are heading, body, data, and mono — accent is not one of them', () => {
  assert.deepEqual([...THEME_FONT_ROLES], ['heading', 'body', 'data', 'mono']);
  assert.ok(!THEME_FONT_ROLES.includes('accent'));
});

test('all six styles are first-class, in picker order, led by the default', () => {
  // Owner calibration, 2026-08-27. The stability tier is withdrawn: no style
  // carries a tier, nothing is labelled experimental, and the catalog is one
  // flat ordered list. Order is a recommendation, and Institutional leads it
  // because a fresh deployment starts there.
  assert.deepEqual(
    [...THEME_PRESET_IDS],
    ['civic', 'newsroom', 'broadsheet', 'atlas', 'field-guide', 'zine'],
  );
  assert.equal(THEME_PRESET_IDS[0], DEFAULT_PRESET_ID);
  assert.equal(DEFAULT_PRESET_ID, 'civic');
  for (const id of THEME_PRESET_IDS) {
    assert.ok(!('tier' in getPreset(id)), `${id} states no tier`);
  }
});

test('every style ships one recommended configuration that clears contrast in both modes', () => {
  // "Each has one excellent recommended configuration that works
  // immediately" (owner calibration). The recommended configuration is what
  // picking the style hands the operator, so it has to be publishable as it
  // stands — a failing pair is a publish error, not a warning.
  for (const id of THEME_PRESET_IDS) {
    const configuration = recommendedConfiguration(id);
    assert.equal(configuration.preset, id);
    const groups = Object.keys(getPreset(id).options || {});
    assert.deepEqual(Object.keys(configuration.optionPicks).sort(), groups.sort());
    for (const group of groups) {
      const offered = getPreset(id).options[group].choices.map((choice) => choice.id);
      assert.ok(
        offered.includes(configuration.optionPicks[group]),
        `${id}.${group} recommends a choice it offers`,
      );
    }
    assert.deepEqual(
      findThemeContrastFailures(configuration),
      [],
      `${id} publishes clean as recommended`,
    );
  }
  assert.equal(recommendedConfiguration('not-a-style'), null);
});

test('each style keeps its own conviction in its recommended configuration', () => {
  // "Do not homogenize the themes" (owner calibration, 2026-08-27). Refining
  // a default is allowed; sanding a style down to a neutral one is not. Each
  // assertion below is the one thing that makes that style recognisable
  // BEFORE anyone opens Advanced, so a future retune that removes it fails
  // here and has to argue for itself.
  const configuration = (id) => ({
    ...recommendedConfiguration(id),
    // The picker writes no texture of its own: the style's own shape is what
    // renders, which is exactly what resolveShape answers for this document.
  });

  // Zine is handmade: a copier ground, hand-cut display lettering, a
  // handwritten callout, and strong rules where the others use hairlines.
  assert.equal(resolveShape(configuration('zine')).texture, 'paper');
  assert.equal(resolveShape(configuration('zine')).density, 'loose');
  assert.equal(resolveFontRoles(configuration('zine')).heading, 'karrik');
  assert.equal(resolveComponentFonts(configuration('zine'))['--callout-font'], 'script-casual');
  assert.equal(
    resolvePresetTokens(configuration('zine'))['--session-card-rule-width'],
    'var(--rule-strong-width)',
  );

  // Field Guide is observational: plate linework on by default, and the
  // opening page framed as a frontispiece.
  assert.equal(resolveMotifSet(configuration('field-guide')), 'botanical');
  assert.equal(recommendedConfiguration('field-guide').optionPicks.nameplate, 'framed-title-page');
  assert.equal(
    resolvePresetTokens(configuration('field-guide'))['--specimen-label-key-display'],
    'inline',
  );

  // Atlas is cartographic: survey linework on by default, the coordinate
  // grid drawn under the timetable, and the departure board as the
  // recommended way to read it.
  assert.equal(resolveMotifSet(configuration('atlas')), 'cartographic');
  assert.equal(recommendedConfiguration('atlas').optionPicks.component, 'departure-board');
  assert.notEqual(resolvePresetTokens(configuration('atlas'))['--map-grid-size'], '0');
  assert.equal(resolvePresetTokens(configuration('atlas'))['--transfer-line-display'], 'block');

  // Broadsheet is authoritative: the Caslon masthead across the full
  // measure, set tight.
  assert.equal(resolveFontRoles(configuration('broadsheet')).heading, 'caslon-display');
  assert.equal(resolveShape(configuration('broadsheet')).density, 'tight');
  assert.equal(recommendedConfiguration('broadsheet').optionPicks.nameplate, 'full-measure');

  // Newsroom names its sections with a strong rule; Institutional stays
  // plain and roomy, which is its whole argument.
  assert.equal(
    resolvePresetTokens(configuration('newsroom'))['--section-rule-width'],
    'var(--rule-strong-width)',
  );
  assert.equal(resolveShape(configuration('civic')).texture, 'flat');
  assert.equal(resolveShape(configuration('civic')).density, 'comfortable');
  assert.equal(resolveMotifSet(configuration('civic')), 'none');
});

test('both spellings of a palette key normalize to the same role', () => {
  assert.equal(canonicalColorKey('brandPrimary'), 'primary');
  assert.equal(canonicalColorKey('semanticKeynote'), 'keynote');
  assert.equal(canonicalColorKey('primary'), 'primary');
  assert.equal(canonicalColorKey('constructor'), 'constructor');
  for (const role of Object.values(THEME_COLOR_KEY_ALIASES)) {
    assert.ok(THEME_COLOR_KEYS.includes(role), `${role} is a known role`);
  }
});

/* -------------------------------------------------------------------------
 * The brand colour and the steps derived from it (owner review, 2026-08-27).
 * ---------------------------------------------------------------------- */

/**
 * Brand colours chosen to be hostile, not representative. Every one of them
 * is something a client has actually handed an operator: a logo colour that
 * is nearly white, one that is nearly black, a fluorescent, a mid grey with
 * no useful contrast anywhere, and a saturated blue that is fine in light
 * and invisible in dark. Written as channels, because the repo lint bans hex
 * literals in this file.
 */
const HOSTILE_BRAND_RGB = Object.freeze([
  [255, 255, 255],
  [0, 0, 0],
  [255, 240, 0],
  [128, 128, 128],
  [10, 20, 200],
  [255, 0, 128],
  [0, 255, 200],
  [120, 90, 60],
]);

test('a brand colour that already reads is used exactly as the client gave it', () => {
  // Nothing is "corrected" for its own sake. The derivation only moves a
  // value that would otherwise fail, so a client who picked well sees their
  // own colour on the page.
  const ground = getPreset('civic').palette.light.surface;
  const brand = getPreset('civic').palette.light.primary;
  assert.ok(contrastRatio(brand, ground) >= 4.5, 'the fixture is already legible');
  assert.deepEqual(deriveBrandSteps(brand, ground).primary, [...brand]);
});

test('the derived steps are ordered, and each one clears the bar written for it', () => {
  for (const brand of HOSTILE_BRAND_RGB) {
    for (const id of THEME_PRESET_IDS) {
      for (const mode of ['light', 'dark']) {
        const ground = getPreset(id).palette[mode].surface;
        const steps = deriveBrandSteps(brand, ground);

        // The two text-carrying steps hold the 4.5:1 bar; the soft step
        // carries no text and holds the 3:1 non-text bar.
        assert.ok(
          contrastRatio(steps.primary, ground) >= 4.5,
          `${id}/${mode}: primary from ${brand.join(',')}`,
        );
        assert.ok(
          contrastRatio(steps.primaryDark, ground) >= 4.5,
          `${id}/${mode}: primaryDark from ${brand.join(',')}`,
        );
        assert.ok(
          contrastRatio(steps.primaryLight, ground) >= 3,
          `${id}/${mode}: primaryLight from ${brand.join(',')}`,
        );

        // The ladder points the right way on both grounds: emphasis is
        // FURTHER from the ground than primary, and the soft step is nearer.
        // "Darker" on a light ground and "brighter" on a dark one are the
        // same instruction stated as contrast.
        assert.ok(
          contrastRatio(steps.primaryDark, ground) >= contrastRatio(steps.primary, ground),
          `${id}/${mode}: emphasis reads stronger`,
        );
        assert.ok(
          contrastRatio(steps.primaryLight, ground) <= contrastRatio(steps.primary, ground) + 0.01,
          `${id}/${mode}: the soft step reads softer`,
        );
      }
    }
  }
});

test('a brand colour publishes clean on every style, in both modes', () => {
  // THE CONTRAST PROOF. `findThemeContrastFailures` is what `updateTheme`
  // rejects a publish on. A client brand colour must never be able to
  // produce a document that fails it, because the whole point of deriving
  // the supporting steps is that the client stops being asked to get colour
  // science right. Eight hostile brand colours across six styles and two
  // modes is 96 published documents.
  for (const brand of HOSTILE_BRAND_RGB) {
    for (const id of THEME_PRESET_IDS) {
      const theme = { ...recommendedConfiguration(id), brandColor: rgbToHex(brand) };
      assert.deepEqual(
        findThemeContrastFailures(theme),
        [],
        `${id} with brand ${rgbToHex(brand)}`,
      );
    }
  }
});

test('the brand colour moves the brand steps and leaves the style alone', () => {
  // Deriving the accent and the semantics from a client's brand would make
  // the six styles one style in six hues. The ground, the ink, the style's
  // own accent, and the five semantic roles are untouched.
  const base = resolveThemePalettes(recommendedConfiguration('field-guide'));
  const branded = resolveThemePalettes({
    ...recommendedConfiguration('field-guide'),
    brandColor: rgbToHex([10, 20, 200]),
  });
  for (const mode of ['light', 'dark']) {
    for (const role of ['primary', 'primaryDark', 'primaryLight']) {
      assert.notDeepEqual(branded[mode][role], base[mode][role], `${mode}.${role} moved`);
    }
    for (const role of ['surface', 'surfaceAlt', 'ink', 'inkMuted', 'accent',
      'success', 'warning', 'danger', 'highlight', 'keynote']) {
      assert.deepEqual(branded[mode][role], base[mode][role], `${mode}.${role} held`);
    }
  }
});

test('an expert per-token override still wins over the derived value', () => {
  // The derivation is the default, not a cage. The Advanced path keeps the
  // last word — and a failing override is still a publish error, which is
  // what the live contrast check in the editor is there to catch first.
  const chosen = rgbToHex([26, 82, 150]);
  const theme = {
    ...recommendedConfiguration('newsroom'),
    brandColor: rgbToHex([255, 0, 128]),
    tokens: { light: { primary: chosen } },
  };
  const palettes = resolveThemePalettes(theme);
  assert.equal(rgbToHex(palettes.light.primary), chosen);
  // The mode the override does not name keeps the derived value.
  assert.notEqual(rgbToHex(palettes.dark.primary), chosen);
});

test('the admin marker takes the resolved brand colour, with its floor intact', () => {
  // There is no adminAccent field any more: the marker is the site's own
  // brand colour, and the only question left is whether it can be seen on
  // the admin ground.
  assert.ok(!THEME_DOC_KEYS.includes('adminAccent'));
  assert.ok(THEME_DOC_KEYS.includes('brandColor'));

  const theme = { ...recommendedConfiguration('civic'), brandColor: rgbToHex([122, 31, 61]) };
  const marker = resolveAdminAccent(theme, 'light');
  assert.deepEqual(marker.rgb, [122, 31, 61]);
  assert.equal(marker.fellBack, false);

  // A resolved primary that cannot sit on the admin ground steps aside for
  // the admin's own ink rather than rendering as nothing.
  const onDarkGround = resolveAdminAccent(
    { colors: { primary: rgbToHex([235, 232, 227]), surface: rgbToHex([17, 17, 17]), ink: rgbToHex([255, 255, 255]) } },
    'light',
  );
  assert.equal(onDarkGround.fellBack, true);
  assert.deepEqual(onDarkGround.rgb, [...ADMIN_TOKEN_SET.colors['--admin-ink-rgb'].light]);

  // A document that resolves no palette at all leaves the token on its
  // declared default.
  assert.deepEqual(resolveAdminAccent({}, 'light'), { rgb: null, ratio: null, fellBack: false });
});
