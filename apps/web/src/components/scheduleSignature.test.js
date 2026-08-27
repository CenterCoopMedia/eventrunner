// The one expressive moment on the public site, against the stylesheet
// (design brief §2.2; visual stories: Broadsheet moment 2, Atlas moment 3).
//
// "A signature interaction must start from a user action. It must finish in
// under 600ms. It must leave the page in a readable state at every frame."
// Those are properties of CSS — a duration, a property list, a media query
// — so they are asserted here rather than described in a comment. jsdom
// applies no CSS, which is why a render test cannot stand in for this one.
// The same shape as stamp.test.js, one section per rule.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getPreset, THEME_PRESET_IDS } from 'shared/theme';

const here = path.dirname(fileURLToPath(import.meta.url));
const indexCss = fs.readFileSync(path.resolve(here, '..', 'index.css'), 'utf8');
const themeCss = fs.readFileSync(path.resolve(here, '..', 'generated', 'theme.css'), 'utf8');
const grid = fs.readFileSync(path.resolve(here, 'ScheduleGrid.jsx'), 'utf8');

/**
 * The stylesheet with every `prefers-reduced-motion: no-preference` block
 * cut out, brace-aware. What is left is what a reader who asked for less
 * motion actually gets.
 */
function withoutMotionBlocks(source) {
  const marker = '@media (prefers-reduced-motion: no-preference)';
  let out = '';
  let rest = source;
  for (let at = rest.indexOf(marker); at !== -1; at = rest.indexOf(marker)) {
    out += rest.slice(0, at);
    let depth = 0;
    let index = rest.indexOf('{', at);
    for (; index < rest.length; index += 1) {
      if (rest[index] === '{') depth += 1;
      if (rest[index] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    rest = rest.slice(index + 1);
  }
  return out + rest;
}

/** The stylesheet's rules, with its comments taken out. */
const declarations = indexCss.replace(/\/\*[\s\S]*?\*\//g, '');
const staticCss = withoutMotionBlocks(indexCss);
const motionBlocks = indexCss.match(
  /@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n {2}\}/g,
);
const signature = motionBlocks.find((block) => block.includes('.schedule-grid'));

describe('the column that comes forward', () => {
  it('starts from a user action, and from nothing else', () => {
    // The state is written by a click and by focus (ScheduleGrid.jsx).
    expect(grid).toContain('onClick=');
    expect(grid).toContain('onFocus=');
    expect(grid).toContain('aria-pressed=');
    // Never from scroll, never on a loop, never on its own.
    expect(declarations).not.toMatch(/@keyframes|animation-iteration-count: infinite/);
    expect(grid).not.toMatch(
      /onScroll|'scroll'|IntersectionObserver|setInterval|setTimeout|requestAnimationFrame/,
    );
  });

  it('finishes under 600ms, on the signature token', () => {
    expect(signature).toBeTruthy();
    expect(signature).toContain('var(--motion-signature)');
    const declared = themeCss.match(/--er-duration-signature: (\d+)ms;/);
    expect(declared, 'the signature duration is a token').not.toBeNull();
    expect(Number(declared[1])).toBeLessThan(600);
  });

  it('stays under 600ms in every preset, because the rule is not per theme', () => {
    // The generated stylesheet declares one value; a preset may retune any
    // token it likes, and retuning this one past the ceiling would move the
    // whole site's one expressive moment outside §2.2 with nothing to say
    // so. The budget belongs to the brief, not to a theme.
    for (const id of THEME_PRESET_IDS) {
      const override = getPreset(id).tokens?.['--er-duration-signature'];
      if (override === undefined) continue;
      const ms = /^(\d+)ms$/.exec(String(override).trim());
      expect(ms, `${id} states its signature duration in whole ms`).not.toBeNull();
      expect(Number(ms[1]), `${id} finishes under 600ms`).toBeLessThan(600);
    }
  });

  it('animates transform and opacity, and nothing else', () => {
    const transitions = signature.match(/transition:[\s\S]*?;/g) ?? [];
    expect(transitions.length).toBeGreaterThan(0);
    for (const rule of transitions) {
      expect(rule).not.toMatch(/transition: all|transition-property: all/);
      for (const property of rule.matchAll(/(?:^|\s)([a-z-]+) var\(--motion/g)) {
        expect(['transform', 'opacity']).toContain(property[1]);
      }
    }
    expect(signature).toContain('transform: translateY(');
  });

  it('leaves every other column exactly as it was', () => {
    // Nothing is dimmed to make one column stand out, so no text drops
    // below its contrast bar at any frame (§8.1). The only opacity that
    // moves belongs to the forward column's own ground and its trace.
    const opacityRules = indexCss.match(/\.schedule-grid[^{]*\{[^}]*opacity[^}]*\}/g) ?? [];
    for (const rule of opacityRules) {
      expect(rule, 'only the forward column changes opacity').toMatch(
        /data-track-forward|::before|::after/,
      );
    }
    expect(indexCss).not.toMatch(/schedule-grid[^{]*:not\(\[data-track-forward\]\)/);
  });

  it('marks the forward column with a ground the palette already tests', () => {
    // --schedule-forward-rgb defaults to the alt surface, which the
    // dark-mode completeness test measures text against in both modes.
    expect(themeCss).toContain('--schedule-forward-rgb: var(--color-surface-alt-rgb);');
  });

  it('is truly static under prefers-reduced-motion, and still comes forward', () => {
    // The tint sits outside the query: the column still comes forward. The
    // lift sits inside it: nothing moves. That is a static state, not a
    // shortened animation.
    expect(staticCss).toContain('.schedule-grid [data-track-forward]::before');
    expect(staticCss).not.toMatch(/\.schedule-grid[^{]*\{[^}]*transition/);
    expect(staticCss).not.toMatch(/\.schedule-grid[^{]*\{[^}]*transform: translateY/);
  });

  it('draws Atlas’s traced line, and paints nothing anywhere else', () => {
    // A zero-width bar paints nothing, so the device turns itself off with
    // no theme test and no second rule.
    expect(themeCss).toContain('--schedule-trace-width: 0;');
    for (const id of THEME_PRESET_IDS) {
      const preset = getPreset(id);
      const width = preset.tokens?.['--schedule-trace-width'];
      if (id === 'atlas') {
        expect(width, 'Atlas traces the line').toBeTruthy();
        expect(width).not.toBe('0');
      } else {
        expect(width ?? '0', `${id} draws no trace`).toBe('0');
      }
    }
  });
});

describe('the calling-points disclosure', () => {
  it('is functional motion: transform only, inside the 120–200ms band', () => {
    const block = motionBlocks.find((rule) => rule.includes('.calling-points__marker'));
    expect(block).toBeTruthy();
    expect(block).toContain('transition: transform var(--motion-base) var(--motion-ease);');
    expect(themeCss).toContain('--er-duration-base: 160ms;');
  });

  it('leaves the marker still for a reader who asked for less motion', () => {
    expect(staticCss).toContain('.calling-points__marker');
    expect(staticCss).not.toMatch(/\.calling-points__marker \{[^}]*transition/);
  });
});
