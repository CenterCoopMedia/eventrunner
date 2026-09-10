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
import { CONTROL_SPECIMENS } from './index.js';
import { STATE_IDS } from './states.js';

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
});
