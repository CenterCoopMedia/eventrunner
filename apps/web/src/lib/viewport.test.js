// Which view the schedule renders (design brief §2.1 "Grid schedule").
//
// The list is the accessible baseline, so "no" is the answer wherever the
// question cannot be asked: an engine with no `matchMedia`, a query it
// refuses, a render before the browser is there at all.
import { describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMediaQuery, WIDE_VIEWPORT } from './viewport.js';

/** A matchMedia stand-in that can flip and notify, like a real browser. */
function fakeView(matches) {
  const listeners = new Set();
  const media = {
    matches,
    addEventListener: (_type, fn) => listeners.add(fn),
    removeEventListener: (_type, fn) => listeners.delete(fn),
  };
  return {
    view: { matchMedia: () => media },
    flip(next) {
      media.matches = next;
      for (const fn of listeners) fn({ matches: next });
    },
  };
}

describe('useMediaQuery', () => {
  it('answers before the first paint, so the right view draws first', () => {
    const { view } = fakeView(true);
    const { result } = renderHook(() => useMediaQuery(WIDE_VIEWPORT, view));
    expect(result.current).toBe(true);
  });

  it('follows the browser when the viewport changes', () => {
    const { view, flip } = fakeView(false);
    const { result } = renderHook(() => useMediaQuery(WIDE_VIEWPORT, view));
    expect(result.current).toBe(false);
    act(() => flip(true));
    expect(result.current).toBe(true);
  });

  it('answers no where matchMedia is missing, or refuses the query', () => {
    const { result: missing } = renderHook(() => useMediaQuery(WIDE_VIEWPORT, {}));
    expect(missing.current).toBe(false);

    const throwing = {
      matchMedia: () => {
        throw new Error('unsupported query');
      },
    };
    const { result: refused } = renderHook(() => useMediaQuery(WIDE_VIEWPORT, throwing));
    expect(refused.current).toBe(false);
  });

  it('stops listening when the page moves on', () => {
    const { view } = fakeView(true);
    let removed = 0;
    const media = view.matchMedia();
    const original = media.removeEventListener;
    media.removeEventListener = (...args) => {
      removed += 1;
      return original(...args);
    };
    const { unmount } = renderHook(() => useMediaQuery(WIDE_VIEWPORT, view));
    unmount();
    expect(removed).toBe(1);
  });
});
