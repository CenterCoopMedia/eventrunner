// The stage and the measure, against the stylesheet (2026-09-10 vocabulary
// expansion).
//
// The two widths are not markup: they are two tokens and a handful of rules
// that read them. jsdom applies no CSS and measures no box, so the rules are
// asserted here the way the density remaps are (layoutVariants.test.js).
//
// What has to hold:
//
//   1. The frame reads --stage-max and the measure reads --measure-text.
//      Both are tier-3 names the page contract declares, so a style retunes
//      either one in its own preset file.
//   2. Nothing states a fixed width. Every width is a MAXIMUM inline size
//      and every grid track is a minmax(0, …), so a long word narrows a
//      column instead of widening the page.
//   3. THE GUTTER HOLDS THE WIDEST DEVICE DRAWN OUTSIDE THE STAGE. The
//      Atlas coordinate mark sits --space-sm + --space-xs outside the title
//      block, so a gutter narrower than that pushed the mark past the
//      viewport and every style scrolled sideways by 4px at 390px. This is
//      the regression test for that overflow: it fails the moment the
//      gutter shrinks or the mark moves further out.
//   4. The ruled row is not a set of cards. No ground, no border box, no
//      shadow and no radius on a cell — only a hairline in the gutter.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..', '..', '..');
const indexCss = fs.readFileSync(path.resolve(here, '..', 'index.css'), 'utf8');
const themeCss = fs.readFileSync(path.resolve(here, '..', 'generated', 'theme.css'), 'utf8');
const primitives = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'design', 'tokens', 'primitives.json'), 'utf8'),
);

/**
 * One rule's body, by selector. Comments are stripped first, so a token
 * named in a note cannot stand in for a rule that reads it.
 *
 * @param {string} selector
 * @returns {string}
 */
function rule(selector) {
  const css = indexCss.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const found = css.match(
    new RegExp(`(^|[{}\\s])${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`),
  );
  expect(found, `${selector} has a rule`).not.toBeNull();
  return found[2];
}

/**
 * The whole `@media (min-width: 64rem)` block that carries a selector,
 * braces matched rather than guessed, so a nested rule cannot end it early.
 *
 * @param {string} selector
 * @returns {string}
 */
function wideBlock(selector) {
  const css = indexCss.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const opener = '@media (min-width: 64rem) {';
  let from = 0;
  for (;;) {
    const start = css.indexOf(opener, from);
    expect(start, `a wide query carries ${selector}`).toBeGreaterThan(-1);
    let depth = 0;
    let end = start + opener.length - 1;
    for (let i = start + opener.length - 1; i < css.length; i += 1) {
      if (css[i] === '{') depth += 1;
      if (css[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const body = css.slice(start, end + 1);
    if (body.includes(`${selector} `) || body.includes(`${selector}{`)) return body;
    from = end + 1;
  }
}

/** A rem value as a number. @param {string} value @returns {number} */
function rem(value) {
  const found = /^([\d.]+)rem$/.exec(value.trim());
  expect(found, `${value} is a rem step`).not.toBeNull();
  return Number(found[1]);
}

describe('the stage and the measure', () => {
  it('reads both widths from the page contract, never from a literal', () => {
    const stage = rule('.stage');
    expect(stage).toMatch(/max-inline-size:\s*var\(--stage-max\)/);
    expect(stage).toMatch(/margin-inline:\s*auto/);
    expect(rule('.measure')).toMatch(/max-inline-size:\s*var\(--measure-text\)/);
  });

  it('states no fixed width: every width is a maximum and every track is a minmax', () => {
    for (const selector of ['.stage', '.measure']) {
      // A percentage fills the room it is given; a pixel or a rem states a
      // width the room has to make.
      expect(rule(selector), selector).not.toMatch(/inline-size:\s*[\d.]+(px|rem)/);
    }
    // The stage's own grids. The schedule grid states its time column from
    // its own contract and is not a stage track.
    const bodies = [
      rule('.footer-links'),
      wideBlock('.stage-split'),
      wideBlock('.stage-row'),
    ].join('\n');
    const tracks = [
      ...bodies.matchAll(/grid-(?:template|auto)-columns:\s*([^;]+);/g),
    ].map((m) => m[1]);
    expect(tracks.length).toBeGreaterThan(2);
    for (const track of tracks) {
      expect(track, track).toMatch(/minmax\(/);
    }
  });

  it('gives the stage a gutter wide enough for the mark drawn outside it', () => {
    // The mark's outset, read from the rule that places it.
    const start = rule('.nameplate__coordinate--start');
    const outset = /inset-inline-start:\s*calc\(-1 \* \(var\(--space-(\w+)\) \+ var\(--space-(\w+)\)\)\)/
      .exec(start);
    expect(outset, 'the coordinate mark states its outset from two spacing steps').not.toBeNull();
    const scale = primitives.scalar.space;
    const needed = rem(scale[outset[1]]) + rem(scale[outset[2]]);
    const gutter = /padding-inline:\s*var\(--space-(\w+)\)/.exec(rule('.stage'));
    expect(gutter, 'the stage states its gutter as a spacing step').not.toBeNull();
    expect(rem(scale[gutter[1]])).toBeGreaterThanOrEqual(needed);
  });

  it('opens the margin column only at lg and above', () => {
    const split = rule('.stage-split');
    expect(split).toMatch(/display:\s*grid/);
    expect(split).not.toMatch(/grid-template-columns/);
    expect(wideBlock('.stage-split')).toMatch(/minmax\(0, var\(--measure-text\)\)/);
  });

  it('rules the row and never boxes a cell', () => {
    const wide = wideBlock('.stage-row');
    expect(wide).toMatch(/grid-auto-flow:\s*column/);
    expect(wide).toMatch(/border-inline-start:\s*var\(--rule-hairline-width\)/);
    for (const banned of [/background/, /box-shadow/, /border-radius/]) {
      expect(wide, `the row draws no ${banned}`).not.toMatch(banned);
      expect(rule('.stage-row'), `the row draws no ${banned}`).not.toMatch(banned);
    }
  });

  it('declares both widths in tier 2 and defaults the contract to them', () => {
    expect(themeCss).toMatch(/--stage-frame:\s*var\(--er-stage-frame\);/);
    expect(themeCss).toMatch(/--stage-measure:\s*var\(--er-stage-measure\);/);
    expect(themeCss).toMatch(/--stage-max:\s*var\(--stage-frame\);/);
    expect(themeCss).toMatch(/--measure-text:\s*var\(--stage-measure\);/);
    // The frame is the wider of the two, or the measure is not a measure.
    expect(rem(primitives.scalar.stage.frame)).toBeGreaterThan(
      rem(primitives.scalar.stage.measure),
    );
  });
});
