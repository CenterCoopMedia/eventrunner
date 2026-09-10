// The registry is complete, and every control accounts for every state.
//
// Two things go stale in a specimen book, and both go stale silently. A
// control ships and nobody adds it to the book, so nobody reviews it in six
// styles. Or a control is in the book but half its states are missing, and
// a missing state looks exactly like a state somebody decided against.
//
// So: every entry has to account for all ten states of the record §2.1 —
// draw it, or name it with a reason. That a shared control module reaches
// the book at all is checked where the whole book is rendered, in
// Specimen.test.jsx, because a control may be drawn by a section rather
// than by this registry.
import { describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { CONTROL_SPECIMENS } from './index.js';
import { REGISTER_REASONS, STATE_IDS } from './states.js';

/**
 * What one control's own markup carries, across every state it draws.
 *
 * `render` is called rather than JSX so this file stays plain `.js`; each
 * specimen's `render` returns the element itself.
 */
function markupOf(control) {
  let tinted = false;
  const fields = [];
  for (const state of control.states) {
    const { container } = render(control.render(state));
    if (container.querySelector('.control-tint')) tinted = true;
    for (const field of container.querySelectorAll('input, select, textarea')) {
      fields.push(field.classList.contains('control-tint'));
    }
    cleanup();
  }
  return { tinted, fields };
}

/** The reason a control gives for a state it does not draw. */
function reasonFor(control, state) {
  return control.absent.find((entry) => entry.state === state)?.reason ?? null;
}

describe('the control registry', () => {
  it('gives every control a unique id and a name', () => {
    const ids = CONTROL_SPECIMENS.map((control) => control.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const control of CONTROL_SPECIMENS) {
      expect(control.name, control.id).toBeTruthy();
      expect(control.file, control.id).toBeTruthy();
    }
  });

  it('accounts for all ten states on every control, once each', () => {
    for (const control of CONTROL_SPECIMENS) {
      const named = [...control.states, ...control.absent.map((entry) => entry.state)];
      expect(new Set(named).size, `${control.id} names a state twice`).toBe(named.length);
      expect([...named].sort(), `${control.id} leaves a state unaccounted for`).toEqual(
        [...STATE_IDS].sort(),
      );
    }
  });

  it('draws at least one state on every control', () => {
    for (const control of CONTROL_SPECIMENS) {
      expect(control.states.length, `${control.id} draws nothing`).toBeGreaterThan(0);
    }
  });

  it('gives a reason for every state it does not draw', () => {
    for (const control of CONTROL_SPECIMENS) {
      for (const entry of control.absent) {
        expect(
          typeof entry.reason === 'string' && entry.reason.trim().length > 20,
          `${control.id} does not say why it has no ${entry.state} state`,
        ).toBe(true);
      }
    }
  });

  it('renders every state it says it draws', () => {
    for (const control of CONTROL_SPECIMENS) {
      for (const state of control.states) {
        expect(control.render(state), `${control.id} renders nothing for ${state}`).toBeTruthy();
      }
    }
  });

  // A REASON HAS TO BE TRUE. The five field controls used to say that their
  // hover and their press were "one rule every boxed control composes",
  // and none of them composes it: `inputClass` and `.control-choice` carry
  // no `control-tint` and no press class. So the reason is checked against
  // the markup the control actually renders, not just against a string.
  it('gives the boxed reason only to a control that composes the shared tint', () => {
    for (const control of CONTROL_SPECIMENS) {
      const hover = reasonFor(control, 'hover');
      // A control that draws its own hover explains nothing, and a field
      // is checked by the test below.
      if (hover === null || hover === REGISTER_REASONS.field.hover) continue;
      expect(
        markupOf(control).tinted,
        `${control.id} says it composes the shared tint and does not`,
      ).toBe(true);
    }
  });

  it('gives the field reason only to a control whose own field takes no tint', () => {
    for (const control of CONTROL_SPECIMENS) {
      if (reasonFor(control, 'hover') !== REGISTER_REASONS.field.hover) continue;
      const { fields } = markupOf(control);
      expect(fields.length, `${control.id} calls itself a field and draws none`).toBeGreaterThan(0);
      // The field itself takes no tint. An action beside it — the search
      // field's clear control, the filter group's — is a boxed control and
      // does take it, which is what the reason says.
      expect(fields.some(Boolean), `${control.id} tints one of its own fields`).toBe(false);
      expect(reasonFor(control, 'pressed')).toBe(REGISTER_REASONS.field.pressed);
    }
  });

  it('says the same true thing about focus wherever focus is not drawn', () => {
    // Focus is a single :focus-visible rule on every element, not a rule
    // each control composes, so every control that does not draw it says
    // that one sentence.
    for (const control of CONTROL_SPECIMENS) {
      const focus = reasonFor(control, 'focus');
      if (focus === null) continue;
      expect(focus, `${control.id} explains focus its own way`).toBe(REGISTER_REASONS.focus);
    }
  });
});
