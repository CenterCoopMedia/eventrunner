// hooks/useBookmarkCounts.js — one shared subscription (issue #165).
import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

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
});
