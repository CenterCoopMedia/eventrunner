// useLiveUpdates — no Firebase, no network (spec §8.1); mocks
// lib/liveUpdatesSource.js directly and drives its callback.
import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLiveUpdates } from './useLiveUpdates.js';

let capturedOnNext;
const subscribeLiveUpdatesMock = vi.fn((onNext) => {
  capturedOnNext = onNext;
  return () => {};
});
vi.mock('../lib/liveUpdatesSource.js', () => ({
  subscribeLiveUpdates: (...args) => subscribeLiveUpdatesMock(...args),
}));

describe('useLiveUpdates', () => {
  it('starts loading and clears on the first snapshot', () => {
    const { result } = renderHook(() => useLiveUpdates());
    expect(result.current.loading).toBe(true);
    expect(result.current.updates).toEqual([]);
    act(() => capturedOnNext([{ id: 'u1', message: 'Hello' }]));
    expect(result.current.loading).toBe(false);
    expect(result.current.updates).toEqual([{ id: 'u1', message: 'Hello' }]);
  });

  it('replaces updates wholesale on every snapshot, including an empty one', () => {
    const { result } = renderHook(() => useLiveUpdates());
    act(() => capturedOnNext([{ id: 'u1', message: 'Hello' }]));
    act(() => capturedOnNext([]));
    expect(result.current.updates).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
});
