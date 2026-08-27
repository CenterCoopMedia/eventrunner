'use strict';

/**
 * The token generator (design brief 2026-08-27, §3.5 and §3.6).
 *
 * Reads the JSON under `design/tokens/` — the one source of truth for the
 * design system — and writes the CSS custom properties that
 * `apps/web/src/generated/theme.css` carries. `scripts/lib/emit.cjs` calls
 * `buildTokenCss()`; nothing else in the repo mints a token.
 *
 * The chain this sits in (brief §3.6):
 *
 *   design/tokens/*.json
 *      → scripts/lib/tokens.cjs        (this file)
 *      → config/theme                  (Firestore: palette, fonts, mode)
 *      → generated/theme.css           (build-time custom properties)
 *      → <style id="event-theme-runtime">   (runtime override)
 *      → data-theme + data-mode on <html>
 *      → tailwind.config.js maps utilities to var(--…)
 *
 * Two rules bind every value this file writes:
 *
 *   1. Colors stay space-separated RGB triples, so Tailwind's
 *      `rgb(var(--…-rgb) / <alpha-value>)` utilities keep their opacity
 *      modifiers working (spec §7.2).
 *   2. No hex literal appears in this source. `scripts/**` is not on the
 *      spec §7.6 allowlist, so every channel arrives as a number — from
 *      the token JSON (data, not linted source) or from `config/theme`.
 */

const fs = require('node:fs');
const path = require('node:path');

const {
  THEME_FONT_ROLES,
  THEME_MODES,
  THEME_MODE_POLICIES,
  DEFAULT_MODE_POLICY,
  deriveDarkColors,
  deriveRuleColors,
  canonicalColorKey,
  isRgb,
} = require('shared/theme');
const { FONT_SETS, RADIUS_SCALES, hexToRgb } = require('./theme.cjs');

const TOKENS_DIR = path.resolve(__dirname, '..', '..', 'design', 'tokens');

/** The four token files, in tier order. */
const TOKEN_FILES = Object.freeze({
  primitives: 'primitives.json',
  semantic: 'semantic.json',
  components: 'components.json',
  motifs: 'motifs.json',
});

/** Tier 1 property prefix (brief §3.1: `--er-<family>-<step>`). */
const PRIMITIVE_PREFIX = '--er';

/**
 * Which config/theme.fonts role each emitted font role falls back to when
 * the document does not name a set for it. `data` and `mono` are new in
 * PR1, so every deployment that predates them lands on the body face
 * rather than on nothing.
 */
const FONT_ROLE_FALLBACKS = Object.freeze({
  heading: [],
  body: [],
  data: ['body', 'heading'],
  mono: ['data', 'body', 'heading'],
});

/**
 * Read the token JSON. A file that is missing or unparseable fails the
 * build by name (brief §3.5) rather than producing a stylesheet with a
 * silently empty tier.
 *
 * @param {string} [dir] token directory, for tests
 * @returns {{ primitives: object, semantic: object, components: object, motifs: object }}
 */
function loadTokens(dir = TOKENS_DIR) {
  const loaded = {};
  for (const [key, file] of Object.entries(TOKEN_FILES)) {
    const target = path.join(dir, file);
    let raw;
    try {
      raw = fs.readFileSync(target, 'utf8');
    } catch (err) {
      throw new Error(`design token file ${file} could not be read: ${err.message}`);
    }
    try {
      loaded[key] = JSON.parse(raw);
    } catch (err) {
      throw new Error(`design token file ${file} is not valid JSON: ${err.message}`);
    }
  }
  return loaded;
}

/** A `$`-prefixed key is a note for a human reader, never a token. */
function tokenEntries(obj) {
  return Object.entries(obj || {}).filter(([key]) => !key.startsWith('$'));
}

/** @param {readonly number[]} rgb @returns {string} `r g b` */
function triple(rgb) {
  return rgb.join(' ');
}

/**
 * The light palette from `config/theme.colors`, as RGB triples, keyed by
 * canonical role. A color the document does not carry, or carries
 * malformed, is left out — the token that reads it is then not emitted at
 * all, exactly as before this change.
 *
 * Both stored spellings resolve here: the seed path writes `brandPrimary`,
 * the admin Branding tab writes `primary`, and `canonicalColorKey` folds
 * them together.
 *
 * @param {object} theme
 * @returns {Record<string, number[]>}
 */
function lightPalette(theme) {
  const palette = {};
  for (const [key, hex] of Object.entries(theme?.colors || {})) {
    const rgb = hexToRgb(hex);
    if (rgb) palette[canonicalColorKey(key)] = rgb;
  }
  return palette;
}

/**
 * Resolve every color token, for both modes.
 *
 * @param {object} theme config/theme
 * @param {object} tokens loadTokens() result
 * @returns {{ names: string[], values: Record<string, Record<string, string>> }}
 *   `values[mode][token]` is the CSS value to write.
 */
function resolveColorTokens(theme, tokens) {
  const palettes = { light: lightPalette(theme) };
  palettes.dark = deriveDarkColors(palettes.light);

  const rules = {};
  for (const mode of THEME_MODES) {
    const { ink, surface } = palettes[mode];
    rules[mode] = isRgb(ink) && isRgb(surface) ? deriveRuleColors({ ink, surface }) : {};
  }

  const names = [];
  const values = { light: {}, dark: {} };
  const emitted = new Set();

  const record = (name, perMode) => {
    names.push(name);
    emitted.add(name);
    for (const mode of THEME_MODES) values[mode][name] = perMode[mode];
  };

  for (const [name, spec] of tokenEntries(tokens.semantic.color)) {
    if (spec.themeKey) {
      if (!isRgb(palettes.light[spec.themeKey])) continue;
      record(name, {
        light: triple(palettes.light[spec.themeKey]),
        dark: triple(palettes.dark[spec.themeKey]),
      });
    } else if (spec.rule) {
      if (!isRgb(rules.light[spec.rule]) || !isRgb(rules.dark[spec.rule])) continue;
      record(name, { light: triple(rules.light[spec.rule]), dark: triple(rules.dark[spec.rule]) });
    } else if (spec.alias) {
      if (!emitted.has(spec.alias)) continue;
      record(name, { light: `var(${spec.alias})`, dark: `var(${spec.alias})` });
    } else if (spec.primitive) {
      const rgb = primitiveColor(tokens.primitives, spec.primitive);
      if (!rgb) continue;
      record(name, { light: triple(rgb), dark: triple(rgb) });
    }
  }

  // Tier 3 colors are contracts over tier 2, so they ride in the mode
  // blocks too. A component that reads one gets the mode's value without
  // knowing the mode exists (brief §3.1).
  for (const [, contract] of tokenEntries(tokens.components)) {
    for (const [name, target] of tokenEntries(contract)) {
      if (!name.endsWith('-rgb')) continue;
      if (!emitted.has(target)) continue;
      record(name, { light: `var(${target})`, dark: `var(${target})` });
    }
  }

  return { names, values };
}

/**
 * @param {object} primitives primitives.json
 * @param {string} ref `family.step`
 * @returns {number[]|null}
 */
function primitiveColor(primitives, ref) {
  const [family, step] = String(ref).split('.');
  const rgb = primitives?.color?.[family]?.[step];
  return isRgb(rgb) ? rgb : null;
}

/**
 * The font stack for each role, after the fallback chain.
 *
 * @param {object} theme
 * @returns {{ stacks: Record<string, string>, families: Array<{family: string, fileBase: string}> }}
 */
function resolveFonts(theme) {
  const configured = theme?.fonts || {};
  const stacks = {};
  const families = [];
  const seen = new Set();
  for (const role of THEME_FONT_ROLES) {
    const chain = [role, ...(FONT_ROLE_FALLBACKS[role] || [])];
    for (const candidate of chain) {
      const set = FONT_SETS[configured[candidate]];
      if (!set) continue;
      stacks[role] = set.stack;
      if (set.fileBase && !seen.has(set.family)) {
        seen.add(set.family);
        families.push({ family: set.family, fileBase: set.fileBase });
      }
      break;
    }
  }
  return { stacks, families };
}

/** The mode policy this document asks for (brief §3.3). */
function modePolicy(theme) {
  return THEME_MODE_POLICIES.includes(theme?.mode) ? theme.mode : DEFAULT_MODE_POLICY;
}

/**
 * The `:root` block: every token that does not change with the mode.
 *
 * @param {object} theme
 * @param {object} tokens
 * @returns {string[]} CSS lines
 */
function rootBlock(theme, tokens) {
  const lines = [];
  const push = (name, value) => lines.push(`  ${name}: ${value};`);
  const group = (comment) => {
    if (lines.length > 0) lines.push('');
    lines.push(`  /* ${comment} */`);
  };

  group('Tier 1 — primitives (brief §3.1). Raw values. Tier 2 reads these.');
  for (const [family, steps] of tokenEntries(tokens.primitives.color)) {
    for (const [step, rgb] of tokenEntries(steps)) {
      if (isRgb(rgb)) push(`${PRIMITIVE_PREFIX}-${family}-${step}`, triple(rgb));
    }
  }
  for (const [family, steps] of tokenEntries(tokens.primitives.scalar)) {
    for (const [step, value] of tokenEntries(steps)) {
      push(`${PRIMITIVE_PREFIX}-${family}-${step}`, value);
    }
  }

  group('Tier 2 — fluid type scale (brief §3.7). Eight steps, size + line height + tracking.');
  for (const [step, spec] of tokenEntries(tokens.semantic.text)) {
    push(`--text-${step}`, spec.size);
    push(`--text-${step}-leading`, spec.leading);
    push(`--text-${step}-tracking`, spec.tracking);
  }

  group('Tier 2 — spacing scale (brief §3.7).');
  for (const [step, value] of tokenEntries(tokens.semantic.space)) push(`--space-${step}`, value);

  group('Tier 2 — rule widths (brief §3.7). The matching colors are mode-scoped below.');
  for (const [weight, spec] of tokenEntries(tokens.semantic.rule)) {
    push(`--rule-${weight}-width`, spec.width);
  }

  const { stacks } = resolveFonts(theme);
  group(
    'Tier 2 — font roles (brief §3.2). config/theme.fonts names a bundled set id ' +
    '(spec §7.4); the generator wrote the matching stacks.',
  );
  for (const role of THEME_FONT_ROLES) {
    if (stacks[role]) push(`--font-${role}`, stacks[role]);
  }
  for (const [name, value] of tokenEntries(tokens.semantic.font)) {
    const role = name.replace(/^--font-/, '');
    if (stacks[role]) continue;
    push(name, value);
  }

  const radius = RADIUS_SCALES[theme?.radius] || RADIUS_SCALES.soft;
  group(
    `Tier 2 — radius scale: config/theme.radius = '${theme?.radius}'. ` +
    "('sharp' → 0 / 2px, 'soft' → 8px / 16px, 'round' → 16px / 28px.)",
  );
  push('--radius-base', radius.base);
  push('--radius-large', radius.large);

  group(
    "Tier 2 — texture treatment: config/theme.texture = 'paper' | 'flat'. " +
    'Components read this through the bg-paper utility layer in index.css.',
  );
  push('--texture', theme?.texture);

  group('Tier 2 — motion (brief §2.2). Functional 120–200ms; one signature under 600ms.');
  for (const [step, value] of tokenEntries(tokens.semantic.motion)) push(`--motion-${step}`, value);

  group('Tier 2 — named weights, so a component never writes a raw number.');
  for (const [step, value] of tokenEntries(tokens.semantic.weight)) push(`--weight-${step}`, value);

  group('Motif layer (brief §3.8). PR1 ships the `none` set only.');
  const setId = tokens.motifs.default;
  const set = tokens.motifs.sets?.[setId];
  push('--motif-set', setId);
  for (const slot of tokens.motifs.slots || []) {
    const asset = set?.slots?.[slot];
    push(
      `--motif-${slot}`,
      asset && set.assetDir ? `url('/motifs/${set.assetDir}/${asset}')` : 'none',
    );
  }

  for (const [component, contract] of tokenEntries(tokens.components)) {
    const nonColor = tokenEntries(contract).filter(([name]) => !name.endsWith('-rgb'));
    if (nonColor.length === 0) continue;
    group(`Tier 3 — ${component} contract (brief §3.1).`);
    for (const [name, value] of nonColor) push(name, value);
  }

  return lines;
}

/**
 * One mode's color block.
 *
 * @param {string} selector
 * @param {string[]} names token order
 * @param {Record<string, string>} values
 * @param {string} comment
 * @returns {string[]} CSS lines
 */
function colorBlock(selector, names, values, comment) {
  const lines = [`/* ${comment} */`, `${selector} {`];
  for (const name of names) lines.push(`  ${name}: ${values[name]};`);
  lines.push('}');
  return lines;
}

/**
 * Every custom property `config/theme` resolves to, as CSS text.
 *
 * The color blocks follow brief §3.3 with one addition: an attribute-free
 * `:root` baseline carrying the light values. Without it a page would
 * paint unstyled until JavaScript wrote `data-mode`. The baseline is the
 * light palette; `:root[data-mode='light']` repeats it so the two blocks
 * stay symmetrical and the dark-mode completeness test (brief §8.2) can
 * compare them; `:root[data-mode='dark']` carries the dark palette.
 *
 * A deployment whose mode policy is not `light` also gets a first-paint
 * block scoped to `:root:not([data-mode])`, so the ground is right before
 * the runtime writes the attribute. Once the attribute lands the block
 * stops matching.
 *
 * @param {object} theme config/theme
 * @param {{ tokensDir?: string }} [options]
 * @returns {string}
 */
function buildTokenCss(theme, { tokensDir } = {}) {
  const tokens = loadTokens(tokensDir);
  const { names, values } = resolveColorTokens(theme, tokens);
  const policy = modePolicy(theme);

  const lines = [];
  lines.push(':root {');
  lines.push(...rootBlock(theme, tokens));
  lines.push('}');

  if (names.length > 0) {
    lines.push('');
    lines.push(
      ...colorBlock(
        ':root',
        names,
        values.light,
        'Light palette, attribute-free baseline — what first paint renders before ' +
        'the runtime writes data-mode.',
      ),
    );
    lines.push('');
    lines.push(
      ...colorBlock(
        ":root[data-mode='light']",
        names,
        values.light,
        'Light palette (brief §3.3). Every color token is defined in both mode blocks.',
      ),
    );
    lines.push('');
    lines.push(
      ...colorBlock(
        ":root[data-mode='dark']",
        names,
        values.dark,
        'Dark palette (brief §3.3). Its own palette, never light mode reversed: a ' +
        'designed neutral ground with the brand colors lifted until they clear the ' +
        'contrast bar on it.',
      ),
    );

    if (policy === 'dark') {
      lines.push('');
      lines.push(
        ...colorBlock(
          ':root:not([data-mode])',
          names,
          values.dark,
          "config/theme.mode is 'dark', so first paint is dark too.",
        ),
      );
    } else if (policy === 'system') {
      lines.push('');
      lines.push("/* config/theme.mode is 'system': first paint follows the reader's setting. */");
      lines.push('@media (prefers-color-scheme: dark) {');
      lines.push(
        ...colorBlock(':root:not([data-mode])', names, values.dark, 'Dark until data-mode lands.')
          .map((line) => `  ${line}`),
      );
      lines.push('}');
    }
  }

  const { families } = resolveFonts(theme);
  if (families.length > 0) {
    lines.push('');
    lines.push('/* Self-hosted font faces (spec §7.4): woff2 only, no font CDN at runtime.');
    lines.push('   Files live in apps/web/public/fonts/. */');
    for (const { family, fileBase } of families) {
      lines.push('@font-face {');
      lines.push(`  font-family: '${family}';`);
      lines.push('  font-style: normal;');
      lines.push('  font-weight: 400 700;');
      lines.push('  font-display: swap;');
      lines.push(`  src: url('/fonts/${fileBase}.woff2') format('woff2');`);
      lines.push('}');
    }
  }

  return lines.join('\n');
}

module.exports = {
  buildTokenCss,
  loadTokens,
  resolveColorTokens,
  resolveFonts,
  modePolicy,
  TOKENS_DIR,
  TOKEN_FILES,
  FONT_ROLE_FALLBACKS,
  internals: { lightPalette, tokenEntries, primitiveColor },
};
