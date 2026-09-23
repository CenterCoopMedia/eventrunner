// hooks/useBookmarkCounts.js — one shared subscription (issue #165).
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const subscribeMock = vi.fn(() => () => {});
vi.mock('../lib/bookmarkCountsSource.js', () => ({
  subscribeBookmarkCounts: (...args) => subscribeMock(...args),
}));

const { useBookmarkCounts } = await import('./useBookmarkCounts.js');

describe('useBookmarkCounts', () => {
  it('starts empty, then carries the map the source hands over', async () => {
    subscribeMock.mockReset();
    subscribeMock.mockImplementation(() => () => {});
    const { result } = renderHook(() => useBookmarkCounts());
    expect(result.current.countsById).toEqual(new Map());

    subscribeMock.mock.calls[0][0](new Map([['s1', 4]]));
    await waitFor(() => expect(result.current.countsById.get('s1')).toBe(4));
  });

  it('subscribes once and unsubscribes on unmount', () => {
    subscribeMock.mockReset();
    const unsubscribe = vi.fn();
    subscribeMock.mockImplementation(() => unsubscribe);
    const { unmount } = renderHook(() => useBookmarkCounts());
    expect(subscribeMock).toHaveBeenCalledTimes(1);
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  // Issue #182: the admin's Most saved panel tells "none saved" apart from
  // "not heard yet" and from "could not hear".
  it('is not ready until the first map, and then stays ready', async () => {
    subscribeMock.mockReset();
    subscribeMock.mockImplementation(() => () => {});
    const { result } = renderHook(() => useBookmarkCounts());
    expect(result.current.ready).toBe(false);
    expect(result.current.error).toBeNull();

    act(() => subscribeMock.mock.calls[0][0](new Map()));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.countsById).toEqual(new Map());
  });

  it('sets the error from the source, keeps the last counts, and clears it on the next map', async () => {
    subscribeMock.mockReset();
    subscribeMock.mockImplementation(() => () => {});
    const { result } = renderHook(() => useBookmarkCounts());
    const [onNext, onError] = subscribeMock.mock.calls[0];

    act(() => onNext(new Map([['s1', 4]])));
    const failure = new Error('permission-denied');
    act(() => onError(failure));
    await waitFor(() => expect(result.current.error).toBe(failure));
    expect(result.current.ready).toBe(true);
    expect(result.current.countsById.get('s1')).toBe(4);

    act(() => onNext(new Map([['s1', 5]])));
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.countsById.get('s1')).toBe(5);
  });

  it('reports an error before the first map without claiming to be ready', async () => {
    subscribeMock.mockReset();
    subscribeMock.mockImplementation(() => () => {});
    const { result } = renderHook(() => useBookmarkCounts());
    act(() => subscribeMock.mock.calls[0][1](new Error('unavailable')));
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.ready).toBe(false);
  });
});
