'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildTokenCss,
  loadTokens,
  resolveColorTokens,
  resolveFonts,
  modePolicy,
  TOKENS_DIR,
  TOKEN_FILES,
} = require('./tokens.cjs');
const { defaultTheme } = require('./theme.cjs');
const { DARK_GROUND_RGB, THEME_FONT_ROLES } = require('shared/theme');

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
  // The seed writes brandPrimary; the Branding tab writes primary.
  const seeded = resolveColorTokens(THEME, loadTokens());
  const fromAdmin = resolveColorTokens(
    { ...THEME, colors: { primary: THEME.colors.brandPrimary } },
    loadTokens(),
  );
  assert.equal(
    fromAdmin.values.light['--brand-primary-rgb'],
    seeded.values.light['--brand-primary-rgb'],
  );
});

test('a color the document does not carry emits no token at all', () => {
  const { names } = resolveColorTokens({ ...THEME, colors: {} }, loadTokens());
  assert.deepEqual(names, []);
});

test('a document from before the data role still resolves every font role', () => {
  const legacy = { fonts: { heading: 'serif-editorial', body: 'sans-humanist', accent: 'script-casual' } };
  const { stacks, families } = resolveFonts(legacy);
  // Only the roles the document names resolve to a stack here.
  assert.deepEqual(Object.keys(stacks).sort(), ['body', 'heading']);
  // The retired accent set is not requested by any live role, so its file
  // is not pulled into the build.
  assert.deepEqual(families.map((f) => f.family).sort(), ['Source Sans 3', 'Source Serif 4']);

  // The alias list covers the rest, so the stylesheet still defines all four.
  const css = buildTokenCss({ ...THEME, ...legacy });
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
  assert.match(css, /--font-accent: var\(--font-heading\);/);
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
