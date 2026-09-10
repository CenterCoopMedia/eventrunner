// The state grammar, asserted on the class strings themselves.
//
// Every public control composes one shared state string, and the point of
// the grammar is that a reader meets the SAME eight states on every control
// (expansion record §2.1). A per-component test cannot prove that; a test
// over the shared strings can, and it is the one place a drifted copy shows
// up — which is the failure this module exists to stop.
import { describe, expect, it } from 'vitest';
import {
  controlStateClass,
  primaryActionClass,
  quietActionClass,
  secondaryActionClass,
  primaryButtonClass,
  secondaryButtonClass,
} from './controlClasses.js';
import { chipActionClass, rowActionClass } from './session/sessionActionClass.js';

const SHAPES = [
  ['primary action', primaryActionClass],
  ['secondary action', secondaryActionClass],
  ['quiet action', quietActionClass],
  ['primary button', primaryButtonClass],
  ['secondary button', secondaryButtonClass],
  ['row action', rowActionClass],
  ['chip action', chipActionClass],
];

describe.each(SHAPES)('%s', (_name, className) => {
  it('carries the shared state grammar', () => {
    expect(className).toContain(controlStateClass);
  });

  it('presses on transform alone, and only where motion is welcome', () => {
    expect(className).toContain('active:scale-[0.98]');
    for (const utility of ['transition-transform', 'duration-slow', 'ease-motion']) {
      expect(className, `${utility} sits inside motion-safe`).toContain(`motion-safe:${utility}`);
    }
  });

  it('states that it is unavailable instead of leaving the tab order', () => {
    expect(className).toContain('aria-disabled:text-text-secondary');
    // A removed control announces nothing, and a changed pointer says
    // nothing a screen reader can hear.
    expect(className).not.toContain('cursor-not-allowed');
  });

  it('marks a selection with weight as well as tint', () => {
    expect(className).toContain('aria-pressed:font-bold');
  });

  it('never fades a colour and never animates anything but transform', () => {
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
    // The tint is `.control-tint` in index.css, which mixes ink into the
    // control's own ground at --state-*-share. A control that set its own
    // hover colour would leave that grammar.
    expect(controlStateClass).toContain('control-tint');
  });

  it('leaves the focus ring to the one rule that draws it', () => {
    // index.css draws :focus-visible for every element. A control that drew
    // its own would be the start of eight different rings.
    expect(controlStateClass).not.toContain('focus-visible:');
    expect(controlStateClass).not.toContain('focus:outline-none');
  });
});
