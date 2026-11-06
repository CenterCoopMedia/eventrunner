// The state grammar, asserted on the class strings themselves.
//
// Every public control composes one shared state string, and the point of
// the grammar is that a reader meets the SAME eight states on every control
// (expansion record §2.1). A per-component test cannot prove that; a test
// over the shared strings can, and it is the one place a drifted copy shows
// up — which is the failure this module exists to stop.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import {
  controlStateClass,
  textControlStateClass,
  primaryActionClass,
  quietActionClass,
  secondaryActionClass,
  primaryButtonClass,
  secondaryButtonClass,
} from './controlClasses.js';
import { chipActionClass, rowActionClass } from './session/sessionActionClass.js';

const stylesheet = path.join(path.dirname(fileURLToPath(import.meta.url)), 'publicControls.css');
const css = postcss.parse(readFileSync(stylesheet, 'utf8'), { from: stylesheet });

function declarationsFor(selector) {
  const declarations = {};
  css.walkRules((rule) => {
    if (!rule.selectors.includes(selector) || rule.parent.type !== 'root') return;
    rule.walkDecls(({ prop, value }) => { declarations[prop] = value; });
  });
  return declarations;
}

/** The boxed shapes: a ground of their own, so a tint has somewhere to go. */
const BOXED = [
  ['primary action', primaryActionClass],
  ['secondary action', secondaryActionClass],
  ['quiet action', quietActionClass],
  ['primary button', primaryButtonClass],
  ['secondary button', secondaryButtonClass],
  ['chip action', chipActionClass],
];

/** The text register: no ground, and therefore no tint. */
const TEXT = [['row action', rowActionClass]];

const SHAPES = [...BOXED, ...TEXT];

describe.each(BOXED)('%s', (_name, className) => {
  it('carries the boxed state grammar, tint and all', () => {
    expect(className).toContain(controlStateClass);
  });

  it('states that it is unavailable on its own ground', () => {
    expect(className).toContain('public-action');
  });
});

describe.each(TEXT)('%s', (_name, className) => {
  it('carries the text state grammar', () => {
    expect(className).toContain(textControlStateClass);
  });

  it('takes no tint and no ground', () => {
    // A tint behind a row control is the box the row register removes.
    expect(className).not.toContain('control-tint');
    expect(className).not.toContain('aria-disabled:bg-');
  });
});

describe.each(SHAPES)('%s', (_name, className) => {

  it('leaves press feedback to the guarded shared stylesheet', () => {
    expect(className).not.toMatch(/(?:^|\s)active:scale-/);
    expect(className).toMatch(/(?:^|\s)public-(?:action|text-control)(?:\s|$)/);
  });

  it('states that it is unavailable instead of leaving the tab order', () => {
    expect(className).not.toContain('disabled:opacity-');
    // A removed control announces nothing, and a changed pointer says
    // nothing a screen reader can hear.
    expect(className).not.toContain('cursor-not-allowed');
  });

  it('marks a selection with weight as well as tint', () => {
    expect(className).toContain('aria-pressed:font-bold');
  });

  it('does not add a broad transition that bypasses shared motion preferences', () => {
    expect(className).not.toContain('transition-colors');
    expect(className).not.toContain('transition-all');
    expect(className).not.toMatch(/(^|[\s:])transition-opacity/);
    // A raw millisecond value would put a control outside the token set.
    expect(className).not.toMatch(/duration-\[/);
  });

  it('holds the touch target and stays a rectangle', () => {
    expect(className).toContain('touch-target');
    expect(className).not.toContain('rounded-full');
  });
});

describe('the shared state string', () => {
  it('paints its tint through the one token-driven rule', () => {
    // The tint is `.control-tint` in index.css, which mixes the control's
    // own ink into its own ground at --state-*-share. A control that set its
    // own hover colour would leave that grammar.
    expect(controlStateClass).toContain('control-tint');
    expect(textControlStateClass).not.toContain('control-tint');
  });

  it('gives the two registers the same press and the same selected weight', () => {
    expect(controlStateClass).toContain('public-action');
    expect(textControlStateClass).toContain('public-text-control');
    expect(controlStateClass).toContain('aria-pressed:font-bold');
    expect(textControlStateClass).toContain('aria-pressed:font-bold');
  });

  it('leaves the focus ring to the one rule that draws it', () => {
    // index.css draws :focus-visible for every element. A control that drew
    // its own would be the start of eight different rings.
    expect(controlStateClass).not.toContain('focus-visible:');
    expect(controlStateClass).not.toContain('focus:outline-none');
  });
});

describe('shared public control feedback', () => {
  it('guards every press transform with motion preference and action availability', () => {
    const transforms = [];
    css.walkDecls('transform', (declaration) => transforms.push(declaration));
    expect(transforms.length).toBeGreaterThan(0);
    for (const declaration of transforms) {
      const rule = declaration.parent;
      expect(rule.parent.name).toBe('media');
      expect(rule.parent.params).toBe('(prefers-reduced-motion: no-preference)');
      for (const selector of rule.selectors) {
        expect(selector).toContain(':active');
        expect(selector).toContain(':not(:disabled)');
        expect(selector).toContain(":not([aria-disabled='true'])");
        expect(selector).toContain(":not([aria-busy='true'])");
      }
    }
  });

  it('limits transitions to short control paint and transform feedback', () => {
    const transitions = [];
    css.walkDecls('transition', (declaration) => transitions.push(declaration));
    expect(transitions.length).toBeGreaterThan(0);
    for (const declaration of transitions) {
      expect(declaration.parent.parent.params).toBe('(prefers-reduced-motion: no-preference)');
      const properties = declaration.value.split(',').map((entry) => entry.trim().split(/\s+/)[0]);
      expect(properties).toEqual(['background-color', 'border-color', 'color', 'transform']);
      expect(declaration.value).not.toMatch(/\ball\b/);
      expect(declaration.value.match(/var\(--motion-fast\)/g)).toHaveLength(4);
    }
  });

  it('excludes pending actions from unavailable paint for both native and aria disabled states', () => {
    for (const unavailable of [':disabled', "[aria-disabled='true']"]) {
      const boxed = declarationsFor(`.public-action${unavailable}:not([aria-busy='true'])`);
      expect(boxed).toMatchObject({
        'background-color': 'rgb(var(--color-surface-alt-rgb))',
        color: 'rgb(var(--color-text-secondary-rgb))',
      });
      const text = declarationsFor(`.public-text-control${unavailable}:not([aria-busy='true'])`);
      expect(text.color).toBe('rgb(var(--color-text-secondary-rgb))');
      expect(text['background-color']).toBeUndefined();
    }
    expect(declarationsFor(".public-action.control-tint[aria-busy='true']")['--control-tint-share']).toBe('0');
  });

  it('uses a control boundary for the secondary and quiet actions', () => {
    for (const action of [secondaryActionClass, secondaryButtonClass, quietActionClass]) {
      expect(action).toContain('border-control');
      expect(action).not.toContain('border-rule-hairline');
    }
  });

  it('allows long labels to wrap while keeping icons intact', () => {
    for (const selector of ['.public-action', '.public-text-control']) {
      expect(declarationsFor(selector)).toMatchObject({
        'max-inline-size': '100%',
        'white-space': 'normal',
        'overflow-wrap': 'anywhere',
      });
      expect(declarationsFor(`${selector} > svg`)['flex-shrink']).toBe('0');
    }
  });

  it('reserves asynchronous action labels without exposing both names', () => {
    expect(declarationsFor('.public-action-label').display).toBe('inline-grid');
    expect(declarationsFor('.public-action-label > span')['grid-area']).toBe('1 / 1');
    expect(declarationsFor(".public-action-label > [aria-hidden='true']").visibility).toBe('hidden');
  });
});
