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
  DEFAULT_PRESET_ID,
  recommendedConfiguration,
  findThemeContrastFailures,
  getPreset,
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

test('both spellings of a palette key normalize to the same role', () => {
  assert.equal(canonicalColorKey('brandPrimary'), 'primary');
  assert.equal(canonicalColorKey('semanticKeynote'), 'keynote');
  assert.equal(canonicalColorKey('primary'), 'primary');
  assert.equal(canonicalColorKey('constructor'), 'constructor');
  for (const role of Object.values(THEME_COLOR_KEY_ALIASES)) {
    assert.ok(THEME_COLOR_KEYS.includes(role), `${role} is a known role`);
  }
});
