// Complete dark mode (design brief §8.2).
//
// "Every color token must resolve in both modes. A half-applied mode is a
// bug, not a polish item." This test loads the generated stylesheet, reads
// the two mode blocks out of it, and proves that no color token falls back
// to its light value in dark mode.
//
// PR1 has one theme: the base theme, in its two modes. PR2 adds the six
// presets, and each preset stylesheet joins the THEMES list below — the
// per-theme body does not change.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from 'shared/theme';

const here = path.dirname(fileURLToPath(import.meta.url));
const GENERATED_THEME = path.resolve(here, '..', 'generated', 'theme.css');

const THEMES = [{ id: 'base', file: GENERATED_THEME }];

/** A color token whose two modes may legitimately hold the same value. */
const SAME_IN_BOTH_MODES = [];

/**
 * Split a stylesheet into its top-level rules. Brace-aware, so an @media
 * wrapper does not swallow the rules around it.
 *
 * @param {string} css
 * @returns {Array<{ selector: string, body: string }>}
 */
function topLevelRules(css) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  let selectorStart = 0;
  let depth = 0;
  let bodyStart = 0;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') {
      if (depth === 0) bodyStart = i + 1;
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        rules.push({
          selector: source.slice(selectorStart, bodyStart - 1).trim(),
          body: source.slice(bodyStart, i),
        });
        selectorStart = i + 1;
      }
    }
  }
  return rules;
}

/**
 * The custom-property declarations of the first rule with this selector.
 *
 * @param {string} css
 * @param {string} selector
 * @returns {Record<string, string>}
 */
function declarations(css, selector) {
  const rule = topLevelRules(css).find((r) => r.selector === selector);
  if (!rule) return {};
  const found = {};
  for (const match of rule.body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    found[match[1]] = match[2].trim();
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

describe.each(THEMES)('$id theme', ({ file }) => {
  const css = fs.readFileSync(file, 'utf8');
  const baseline = declarations(css, ':root');
  const lightBlock = declarations(css, ":root[data-mode='light']");
  const darkBlock = declarations(css, ":root[data-mode='dark']");
  const light = { ...baseline, ...lightBlock };
  const dark = { ...baseline, ...darkBlock };

  // Every color token's name ends in -rgb, because its value is an RGB
  // triple. That is what makes "which tokens are colors" a fact about the
  // stylesheet rather than a list this test has to keep up to date.
  const colorTokens = Object.keys(light).filter((name) => name.endsWith('-rgb'));

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

  // Contrast is measured against the actual rendered background, not the
  // page background (interface guidelines, Colors), so each text token is
  // measured on both surfaces it can sit on.
  const TEXT_PAIRS = [
    ['--color-text-primary-rgb', '--color-surface-rgb', 4.5],
    ['--color-text-primary-rgb', '--color-surface-alt-rgb', 4.5],
    ['--color-text-secondary-rgb', '--color-surface-rgb', 4.5],
    ['--color-text-secondary-rgb', '--color-surface-alt-rgb', 4.5],
    ['--color-accent-rgb', '--color-surface-rgb', 4.5],
    // A rule is structure, not text, so it holds the non-text bar only in
    // its strong weight; a hairline is deliberately below it.
    ['--rule-strong-rgb', '--color-surface-rgb', 3],
    // A form control's boundary (input, select, textarea) is a non-text UI
    // component under WCAG 1.4.11, so it holds the same 3:1 bar against
    // every ground an input actually renders on.
    ['--color-border-control-rgb', '--color-surface-rgb', 3],
    ['--color-border-control-rgb', '--color-surface-alt-rgb', 3],
  ];

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
