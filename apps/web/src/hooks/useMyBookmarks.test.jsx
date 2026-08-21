// useMyBookmarks — a listener error must not leave `loading` stuck true
// forever (issue #16 follow-up). No Firebase, no network (spec §8.1);
// mocks lib/bookmarksSource.js directly and drives its callbacks.
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import AuthContext from '../contexts/AuthContext.jsx';
import { useMyBookmarks } from './useMyBookmarks.js';

let capturedOnNext;
let capturedOnError;
const subscribeMyBookmarksMock = vi.fn((_uid, onNext, onError) => {
  capturedOnNext = onNext;
  capturedOnError = onError;
  return () => {};
});
vi.mock('../lib/bookmarksSource.js', () => ({
  subscribeMyBookmarks: (...args) => subscribeMyBookmarksMock(...args),
}));

function wrapper({ children }) {
  return (
    <AuthContext.Provider value={{ user: { uid: 'u1' } }}>{children}</AuthContext.Provider>
  );
}

describe('useMyBookmarks', () => {
  it('starts loading for a signed-in user and clears on the first snapshot', () => {
    const { result } = renderHook(() => useMyBookmarks(), { wrapper });
    expect(result.current.loading).toBe(true);
    act(() => capturedOnNext(new Set(['s1'])));
    expect(result.current.loading).toBe(false);
    expect(result.current.bookmarkedIds).toEqual(new Set(['s1']));
  });

  it('clears `loading` on a listener error too, without inventing bookmark data', () => {
    const { result } = renderHook(() => useMyBookmarks(), { wrapper });
    expect(result.current.loading).toBe(true);
    act(() => capturedOnError(new Error('permission denied')));
    expect(result.current.loading).toBe(false);
    // Fail soft: bookmarkedIds is untouched (still the initial empty set),
    // not fabricated from the error.
    expect(result.current.bookmarkedIds).toEqual(new Set());
  });

  it('does not resurrect loading once a later error arrives after a successful snapshot', () => {
    const { result } = renderHook(() => useMyBookmarks(), { wrapper });
    act(() => capturedOnNext(new Set(['s1'])));
    expect(result.current.loading).toBe(false);
    act(() => capturedOnError(new Error('stream error')));
    expect(result.current.loading).toBe(false);
    expect(result.current.bookmarkedIds).toEqual(new Set(['s1']));
  });
});
