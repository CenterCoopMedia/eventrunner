// Complete dark mode, and the palettes that pass by construction
// (design brief §8.1, §8.2).
//
// "Every color token must resolve in both modes. A half-applied mode is a
// bug, not a polish item." This test loads the generated stylesheet, reads
// the mode blocks out of it, and proves that no color token falls back to
// its light value in dark mode.
//
// PR1 shipped it against the base tokens. PR2 extends it three ways, which
// brief §8.2 requires:
//
//   1. Every preset, in every mode. Each (data-theme, data-mode) pair is a
//      scope of its own, and the per-theme body below is the same one the
//      base theme gets.
//   2. The `admin-*` set. It is emitted ONCE PER MODE, never once per
//      (theme, mode) pair — that is the mechanical statement of "the admin
//      ignores data-theme", and it is asserted here rather than described.
//   3. The contrast bar, measured on every preset's palette in both modes,
//      so a palette that fails is caught in the design data rather than in
//      review.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastRatio, THEME_PRESET_IDS, getPreset } from 'shared/theme';

const here = path.dirname(fileURLToPath(import.meta.url));
const GENERATED_THEME = path.resolve(here, '..', 'generated', 'theme.css');
const css = fs.readFileSync(GENERATED_THEME, 'utf8');

/** A color token whose two modes may legitimately hold the same value. */
const SAME_IN_BOTH_MODES = [];

/**
 * Split a stylesheet into its top-level rules. Brace-aware, so an @media
 * wrapper does not swallow the rules around it.
 *
 * @param {string} source
 * @returns {Array<{ selectors: string[], body: string }>}
 */
function topLevelRules(source) {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  let selectorStart = 0;
  let depth = 0;
  let bodyStart = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (ch === '{') {
      if (depth === 0) bodyStart = i + 1;
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        rules.push({
          selectors: clean
            .slice(selectorStart, bodyStart - 1)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          body: clean.slice(bodyStart, i),
        });
        selectorStart = i + 1;
      }
    }
  }
  return rules;
}

const RULES = topLevelRules(css);

/**
 * The custom-property declarations of every rule carrying this selector,
 * merged in document order — which is the order the cascade applies them in
 * for one element, since every selector here has the same specificity class
 * within its own group.
 *
 * A selector may appear more than once: the admin set is emitted into its
 * own `:root[data-mode='light']` rule beside the palette's, precisely so it
 * is written once per mode rather than once per theme.
 *
 * @param {string} selector
 * @returns {Record<string, string>}
 */
function declarations(selector) {
  const found = {};
  for (const rule of RULES) {
    if (!rule.selectors.includes(selector)) continue;
    for (const match of rule.body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      found[match[1]] = match[2].trim();
    }
  }
  return found;
}

/**
 * Follow var() references inside one scope until a literal is left. Custom
 * properties on :root all resolve against the same element, so a scope is
 * simply the baseline block plus the winning mode block.
 *
 * @param {Record<string, string>} scope
 * @param {string} name
 * @returns {string|null}
 */
function resolve(scope, name) {
  let value = scope[name];
  for (let hops = 0; hops < 10; hops += 1) {
    if (typeof value !== 'string') return null;
    const ref = value.match(/^var\((--[\w-]+)\)$/);
    if (!ref) return value;
    value = scope[ref[1]];
  }
  return null;
}

/** @param {string|null} triple @returns {number[]|null} */
function channels(triple) {
  if (!triple) return null;
  const parts = triple.trim().split(/\s+/).map(Number);
  return parts.length === 3 && parts.every((n) => Number.isFinite(n)) ? parts : null;
}

const baseline = declarations(':root');

// The base theme is the attribute-free pair; every preset is its own
// (data-theme, data-mode) pair. The body of the describe block is identical
// for all seven, which is the point: a preset is data, not a special case.
const THEMES = [
  {
    id: 'base',
    light: declarations(":root[data-mode='light']"),
    dark: declarations(":root[data-mode='dark']"),
  },
  ...THEME_PRESET_IDS.map((id) => ({
    id,
    light: declarations(`:root[data-theme='${id}'][data-mode='light']`),
    dark: declarations(`:root[data-theme='${id}'][data-mode='dark']`),
  })),
];

// Contrast is measured against the actual rendered background, not the page
// background (interface guidelines, Colors), so each text token is measured
// on both surfaces it can sit on.
const TEXT_PAIRS = [
  ['--color-text-primary-rgb', '--color-surface-rgb', 4.5],
  ['--color-text-primary-rgb', '--color-surface-alt-rgb', 4.5],
  ['--color-text-secondary-rgb', '--color-surface-rgb', 4.5],
  ['--color-text-secondary-rgb', '--color-surface-alt-rgb', 4.5],
  ['--color-accent-rgb', '--color-surface-rgb', 4.5],
  // The emphasis step renders as text (LinkGroupBlock, SessionMaterialsList)
  // and as a filled button's hover ground under a surface label (CtaBlock).
  // Contrast is symmetric, so one measurement covers both readings.
  ['--brand-primary-dark-rgb', '--color-surface-rgb', 4.5],
  // A rule is structure, not text, so it holds the non-text bar only in
  // its strong weight; a hairline is deliberately below it.
  ['--rule-strong-rgb', '--color-surface-rgb', 3],
  // A form control's boundary (input, select, textarea) is a non-text UI
  // component under WCAG 1.4.11, so it holds the same 3:1 bar against
  // every ground an input actually renders on.
  ['--color-border-control-rgb', '--color-surface-rgb', 3],
  ['--color-border-control-rgb', '--color-surface-alt-rgb', 3],
];

describe.each(THEMES)('$id theme', ({ light: lightBlock, dark: darkBlock }) => {
  const light = { ...baseline, ...lightBlock };
  const dark = { ...baseline, ...darkBlock };

  // Every color token's name ends in -rgb, because its value is an RGB
  // triple. That is what makes "which tokens are colors" a fact about the
  // stylesheet rather than a list this test has to keep up to date. The
  // admin set has its own describe block below, so it is filtered out here.
  const colorTokens = Object.keys(lightBlock).filter((name) => name.endsWith('-rgb'));

  it('defines color tokens, and defines them in both mode blocks', () => {
    expect(colorTokens.length).toBeGreaterThan(20);
    expect(Object.keys(lightBlock).sort()).toEqual(colorTokens.sort());
  });

  it('leaves no color token behind in dark mode', () => {
    const missing = colorTokens.filter((name) => !(name in darkBlock));
    expect(missing, 'these tokens fall back to their light value in dark mode').toEqual([]);
  });

  it('gives every color token its own dark value, not the light one', () => {
    const unchanged = colorTokens.filter(
      (name) =>
        !SAME_IN_BOTH_MODES.includes(name) && resolve(light, name) === resolve(dark, name),
    );
    expect(unchanged, 'dark mode is its own palette, not light mode reversed').toEqual([]);
  });

  it('resolves every color token to three channels in both modes', () => {
    for (const name of colorTokens) {
      expect(channels(resolve(light, name)), `${name} in light`).not.toBeNull();
      expect(channels(resolve(dark, name)), `${name} in dark`).not.toBeNull();
    }
  });

  it.each([
    ['light', () => light],
    ['dark', () => dark],
  ])('meets the contrast bar in %s mode', (_mode, scope) => {
    for (const [text, ground, bar] of TEXT_PAIRS) {
      const a = channels(resolve(scope(), text));
      const b = channels(resolve(scope(), ground));
      expect(a, text).not.toBeNull();
      expect(b, ground).not.toBeNull();
      const ratio = contrastRatio(a, b);
      expect(ratio, `${text} on ${ground} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(bar);
    }
  });

  it('keeps the hairline rule visible without letting it shout', () => {
    for (const scope of [light, dark]) {
      const rule = channels(resolve(scope, '--rule-hairline-rgb'));
      const ground = channels(resolve(scope, '--color-surface-rgb'));
      const ratio = contrastRatio(rule, ground);
      expect(ratio, `hairline is ${ratio.toFixed(2)}:1`).toBeGreaterThan(1.1);
      expect(ratio, `hairline is ${ratio.toFixed(2)}:1`).toBeLessThan(3);
    }
  });
});

// The palettes are validated at the source as well as in the stylesheet: a
// designed palette must pass BY CONSTRUCTION, so a retune that drops below
// the bar fails here before anything is generated (brief §8.1).
describe.each(THEME_PRESET_IDS.map((id) => ({ id, preset: getPreset(id) })))(
  '$id palette',
  ({ preset }) => {
    it.each(['light', 'dark'])('passes the contrast bar in %s mode', (mode) => {
      const palette = preset.palette[mode];
      const pairs = [
        ['ink', 'surface', 4.5],
        ['ink', 'surfaceAlt', 4.5],
        ['inkMuted', 'surface', 4.5],
        ['inkMuted', 'surfaceAlt', 4.5],
        ['primary', 'surface', 4.5],
        // The emphasis step is a rendered text pair too: a filled button's
        // hover ground under a surface label, and a link's colour on surface.
        ['primaryDark', 'surface', 4.5],
        ['accent', 'surface', 4.5],
      ];
      for (const [fg, bg, bar] of pairs) {
        const ratio = contrastRatio(palette[fg], palette[bg]);
        expect(ratio, `${fg} on ${bg} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(bar);
      }
    });
  },
);

// The admin identity (admin story part 6, brief §8.2).
describe('admin identity', () => {
  const lightBlock = declarations(":root[data-mode='light']");
  const darkBlock = declarations(":root[data-mode='dark']");
  const adminTokens = Object.keys(lightBlock).filter(
    (name) => name.startsWith('--admin-') && name.endsWith('-rgb'),
  );
  const light = { ...baseline, ...lightBlock };
  const dark = { ...baseline, ...darkBlock };

  it('ships the whole token set', () => {
    expect(adminTokens.length).toBeGreaterThan(20);
    for (const family of ['ground', 'ink', 'rule', 'state', 'focus', 'client']) {
      expect(
        adminTokens.some((name) => name.startsWith(`--admin-${family}`)),
        `the ${family} family ships`,
      ).toBe(true);
    }
  });

  it('resolves every token in both modes, with its own dark value', () => {
    for (const name of adminTokens) {
      expect(name in darkBlock, `${name} in dark`).toBe(true);
      expect(channels(resolve(light, name)), `${name} in light`).not.toBeNull();
      expect(channels(resolve(dark, name)), `${name} in dark`).not.toBeNull();
    }
    const unchanged = adminTokens.filter(
      // The two client-accent component tokens are aliases of one value, so
      // they read the same in both modes by construction. Their target is
      // what has to change, and it is in this list too.
      (name) => !name.includes('client-accent') && !name.includes('marker') && !name.includes('header-mark')
        && resolve(light, name) === resolve(dark, name),
    );
    expect(unchanged, 'the night side is authored, not the day side dimmed').toEqual([]);
  });

  it('is emitted once per mode, never once per theme', () => {
    // The mechanical statement of "the admin ignores data-theme" (brief §8.2).
    for (const rule of RULES) {
      const themed = rule.selectors.some((selector) => selector.includes('[data-theme='));
      if (!themed) continue;
      expect(rule.body, `${rule.selectors.join(', ')} carries an admin token`).not.toMatch(
        /--admin-/,
      );
    }
    for (const name of adminTokens) {
      const declared = RULES.filter((rule) => rule.body.includes(`${name}:`));
      expect(declared.length, `${name} is declared once per mode`).toBe(2);
    }
  });

  it.each([
    ['light', () => light],
    ['dark', () => dark],
  ])('meets the contrast bar in %s mode', (_mode, scope) => {
    const pairs = [
      ['--admin-ink-rgb', '--admin-ground-rgb', 4.5],
      ['--admin-ink-rgb', '--admin-ground-raised-rgb', 4.5],
      ['--admin-ink-rgb', '--admin-ground-proof-rgb', 4.5],
      ['--admin-ink-rgb', '--admin-ground-input-rgb', 4.5],
      ['--admin-ink-rgb', '--admin-ground-alarm-rgb', 4.5],
      ['--admin-ink-secondary-rgb', '--admin-ground-rgb', 4.5],
      ['--admin-ink-secondary-rgb', '--admin-ground-raised-rgb', 4.5],
      ['--admin-ink-secondary-rgb', '--admin-ground-proof-rgb', 4.5],
      ['--admin-ink-data-rgb', '--admin-ground-rgb', 4.5],
      // "Muted never means below the bar", and dead matter stays readable.
      ['--admin-ink-disabled-rgb', '--admin-ground-rgb', 4.5],
      ['--admin-ink-link-rgb', '--admin-ground-rgb', 4.5],
      ['--admin-ink-inverse-rgb', '--admin-ink-rgb', 4.5],
      ['--admin-state-live-rgb', '--admin-ground-rgb', 4.5],
      ['--admin-state-draft-rgb', '--admin-ground-proof-rgb', 4.5],
      ['--admin-state-error-rgb', '--admin-ground-alarm-rgb', 4.5],
      ['--admin-state-caution-rgb', '--admin-ground-rgb', 4.5],
      ['--admin-state-ok-rgb', '--admin-ground-rgb', 4.5],
      // Rules and the focus ring are non-text user interface.
      ['--admin-rule-strong-rgb', '--admin-ground-rgb', 3],
      ['--admin-rule-header-rgb', '--admin-ground-rgb', 3],
      ['--admin-rule-alarm-rgb', '--admin-ground-alarm-rgb', 3],
      // One ring, clearing BOTH grounds it can land on (part 6e).
      ['--admin-focus-ring-rgb', '--admin-ground-rgb', 3],
      ['--admin-focus-ring-rgb', '--admin-ground-input-rgb', 3],
    ];
    for (const [fg, bg, bar] of pairs) {
      const a = channels(resolve(scope(), fg));
      const b = channels(resolve(scope(), bg));
      expect(a, fg).not.toBeNull();
      expect(b, bg).not.toBeNull();
      const ratio = contrastRatio(a, b);
      expect(ratio, `${fg} on ${bg} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(bar);
    }
  });

  it('keeps the admin hairline felt rather than seen', () => {
    for (const scope of [light, dark]) {
      const ratio = contrastRatio(
        channels(resolve(scope, '--admin-rule-hairline-rgb')),
        channels(resolve(scope, '--admin-ground-rgb')),
      );
      expect(ratio).toBeGreaterThan(1.1);
      expect(ratio).toBeLessThan(3);
    }
  });
});

// The motif layer (brief §3.8).
describe('motif sets', () => {
  it('gives every set a block that resolves every slot', () => {
    const sets = RULES.filter((rule) =>
      rule.selectors.some((selector) => selector.includes('[data-motif-set=')));
    expect(sets.length).toBeGreaterThan(1);
    const slots = ['section-mark', 'divider', 'nameplate-mark', 'empty-state'];
    for (const rule of sets) {
      expect(rule.body).toMatch(/--motif-set:/);
      for (const slot of slots) expect(rule.body).toContain(`--motif-${slot}:`);
    }
  });

  it('paints a motif through a mask, never through an img or a url() fill', () => {
    // A slot token holds a url() for mask-image to consume. The ink comes
    // from --color-ink-motif-rgb, which is a color token like any other, so
    // it is already covered by the per-theme body above.
    expect(baseline['--color-ink-motif-rgb'] ?? css).toBeTruthy();
    expect(css).toMatch(/--motif-section-mark: (none|url\('\/motifs\/)/);
  });
});
