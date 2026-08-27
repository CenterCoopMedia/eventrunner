// The `density` layout variant, against the stylesheet (design brief §6.1).
//
// Density is not markup: it is three blocks of custom-property remaps and
// two places that write the attribute. A render test cannot see any of that
// — jsdom applies no CSS — so the rules are asserted here, the same way the
// Zine stamp's six tests are.
//
// What has to hold:
//
//   1. The three steps remap the SAME tokens. A step that moves a token the
//      others leave alone would make one density a different design.
//   2. Every value is a token. A raw value in here is a minted step outside
//      the spacing scale (§3.7).
//   3. Every token they move is declared as a tier-3 contract, so a preset
//      can retune it and nothing invents a property name (§3.4).
//   4. Both writers agree on the attribute name: the shell writes the
//      preset's density on <html>, and a page writes its own on its
//      <article>.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const indexCss = fs.readFileSync(path.resolve(here, '..', 'index.css'), 'utf8');
const themeCss = fs.readFileSync(path.resolve(here, '..', 'generated', 'theme.css'), 'utf8');

const STEPS = ['tight', 'comfortable', 'loose'];

/** @param {string} step @returns {Record<string, string>} */
function densityBlock(step) {
  const body = indexCss.match(new RegExp(`\\[data-density='${step}'\\] \\{([^}]*)\\}`));
  expect(body, `the ${step} block exists`).not.toBeNull();
  return Object.fromEntries(
    [...body[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  );
}

const BLOCKS = Object.fromEntries(STEPS.map((step) => [step, densityBlock(step)]));

describe('the density layout variant', () => {
  it('moves the same tokens at every step', () => {
    const names = Object.keys(BLOCKS.comfortable).sort();
    expect(names.length).toBeGreaterThan(2);
    for (const step of STEPS) {
      expect(Object.keys(BLOCKS[step]).sort(), `${step} moves the same tokens`).toEqual(names);
    }
  });

  it('never mints a value: every step is a step of the spacing scale', () => {
    for (const step of STEPS) {
      for (const [name, value] of Object.entries(BLOCKS[step])) {
        expect(value, `${step} ${name}`).toMatch(/^var\(--space-[\w-]+\)$/);
      }
    }
  });

  it('moves only tokens the token layer declares', () => {
    // Tier 3 is where a component contract lives (§3.1), and the generated
    // stylesheet is where it lands. A remap of a name nothing declares is a
    // property invented in CSS.
    for (const name of Object.keys(BLOCKS.comfortable)) {
      expect(themeCss, `${name} is a declared contract`).toContain(`${name}:`);
    }
  });

  it('reads differently at each step, so the variant does something', () => {
    for (const name of Object.keys(BLOCKS.comfortable)) {
      const values = STEPS.map((step) => BLOCKS[step][name]);
      expect(new Set(values).size, `${name} changes with the density`).toBe(STEPS.length);
    }
  });

  it('is written by the shell for the preset and by the page for itself', () => {
    const shell = fs.readFileSync(
      path.resolve(here, '..', 'contexts', 'EventConfigContext.jsx'),
      'utf8',
    );
    const page = fs.readFileSync(path.resolve(here, 'SystemPage.jsx'), 'utf8');
    expect(shell).toContain('documentElement.dataset.density');
    expect(shell).toContain('resolveShape(themeDoc).density');
    // The page writes the density it STATES. Reading the resolved layout
    // here would make every page override the preset with `comfortable`.
    expect(page).toContain("'data-density': stated.density");
  });
});
