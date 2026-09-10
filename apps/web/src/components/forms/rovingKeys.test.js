// Where an arrow key moves inside a roving set.
import { describe, expect, it } from 'vitest';
import { nextRovingIndex } from './rovingKeys.js';

describe('nextRovingIndex', () => {
  it('moves one step in each direction, on both axes', () => {
    expect(nextRovingIndex('ArrowRight', 0, 3)).toBe(1);
    expect(nextRovingIndex('ArrowDown', 0, 3)).toBe(1);
    expect(nextRovingIndex('ArrowLeft', 2, 3)).toBe(1);
    expect(nextRovingIndex('ArrowUp', 2, 3)).toBe(1);
  });

  it('closes the ring at both ends', () => {
    expect(nextRovingIndex('ArrowRight', 2, 3)).toBe(0);
    expect(nextRovingIndex('ArrowLeft', 0, 3)).toBe(2);
  });

  it('reaches the ends with Home and End', () => {
    expect(nextRovingIndex('Home', 2, 3)).toBe(0);
    expect(nextRovingIndex('End', 0, 3)).toBe(2);
  });

  it('leaves every other key alone', () => {
    // A set that swallowed Tab, Enter, or a printed character would take
    // keys the page still needs.
    for (const key of ['Tab', 'Enter', ' ', 'a', 'Escape', 'PageDown']) {
      expect(nextRovingIndex(key, 0, 3), key).toBeNull();
    }
  });

  it('answers nothing for an empty set', () => {
    expect(nextRovingIndex('ArrowRight', 0, 0)).toBeNull();
    expect(nextRovingIndex('Home', 0, 0)).toBeNull();
  });
});
