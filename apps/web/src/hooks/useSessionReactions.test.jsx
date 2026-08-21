// useSessionReactions — a listener error must not leave `loading` stuck true
// forever (mirrors useMyBookmarks.test.jsx). No Firebase, no network (spec
// §8.1); mocks lib/reactionsSource.js directly and drives its callbacks.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import AuthContext from '../contexts/AuthContext.jsx';
import { useSessionReactions } from './useSessionReactions.js';

let capturedCountsOnNext;
let capturedCountsOnError;
let capturedMineOnNext;
const subscribeSessionReactionsMock = vi.fn((_sessionId, onNext, onError) => {
  capturedCountsOnNext = onNext;
  capturedCountsOnError = onError;
  return () => {};
});
const subscribeMySessionReactionMock = vi.fn((_sessionId, _uid, onNext) => {
  capturedMineOnNext = onNext;
  return () => {};
});
vi.mock('../lib/reactionsSource.js', () => ({
  subscribeSessionReactions: (...args) => subscribeSessionReactionsMock(...args),
  subscribeMySessionReaction: (...args) => subscribeMySessionReactionMock(...args),
}));

function wrapper({ children }) {
  return <AuthContext.Provider value={{ user: { uid: 'u1' } }}>{children}</AuthContext.Provider>;
}

beforeEach(() => {
  subscribeSessionReactionsMock.mockClear();
  subscribeMySessionReactionMock.mockClear();
});

describe('useSessionReactions', () => {
  it('starts loading and clears on the first counts snapshot', () => {
    const { result } = renderHook(() => useSessionReactions('s1'), { wrapper });
    expect(result.current.loading).toBe(true);
    act(() => capturedCountsOnNext({ '👍': 2, '❤️': 0, '🎉': 0, '💡': 0, '👏': 0 }));
    expect(result.current.loading).toBe(false);
    expect(result.current.counts).toEqual({ '👍': 2, '❤️': 0, '🎉': 0, '💡': 0, '👏': 0 });
  });

  it('clears `loading` on a listener error too, without inventing counts', () => {
    const { result } = renderHook(() => useSessionReactions('s1'), { wrapper });
    expect(result.current.loading).toBe(true);
    act(() => capturedCountsOnError(new Error('permission denied')));
    expect(result.current.loading).toBe(false);
    expect(result.current.counts).toEqual({});
  });

  it('reports the caller\'s own reaction from the separate per-user subscription', () => {
    const { result } = renderHook(() => useSessionReactions('s1'), { wrapper });
    act(() => capturedMineOnNext('👍'));
    expect(result.current.myReaction).toBe('👍');
    act(() => capturedMineOnNext(null));
    expect(result.current.myReaction).toBeNull();
  });

  it('re-subscribes to the per-user reaction on a sessionId change', () => {
    const { rerender } = renderHook(({ sessionId }) => useSessionReactions(sessionId), {
      wrapper,
      initialProps: { sessionId: 's1' },
    });
    expect(subscribeMySessionReactionMock).toHaveBeenCalledWith('s1', 'u1', expect.any(Function));
    rerender({ sessionId: 's2' });
    expect(subscribeMySessionReactionMock).toHaveBeenCalledWith('s2', 'u1', expect.any(Function));
  });
});
