// useLiveUpdates — no Firebase, no network (spec §8.1); mocks
// lib/liveUpdatesSource.js directly and drives its callback.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLiveUpdates } from './useLiveUpdates.js';

let capturedOnNext;
const unsubscribe = vi.fn();
const subscribeLiveUpdatesMock = vi.fn((_audiences, onNext) => {
  capturedOnNext = onNext;
  return unsubscribe;
});
vi.mock('../lib/liveUpdatesSource.js', async (importOriginal) => ({
  ...(await importOriginal()),
  subscribeLiveUpdates: (...args) => subscribeLiveUpdatesMock(...args),
}));

let auth = { user: null, isAdmin: false };
let profile = null;
vi.mock('../contexts/AuthContext.jsx', () => ({ useAuth: () => auth }));
vi.mock('../contexts/ProfileContext.jsx', () => ({ useProfile: () => ({ profile }) }));

describe('useLiveUpdates', () => {
  beforeEach(() => {
    auth = { user: null, isAdmin: false };
    profile = null;
    subscribeLiveUpdatesMock.mockClear();
    unsubscribe.mockClear();
  });

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

  it('asks for the audiences the reader may see (issue 200)', () => {
    renderHook(() => useLiveUpdates());
    expect(subscribeLiveUpdatesMock).toHaveBeenLastCalledWith(['everyone'], expect.any(Function));
  });

  it('listens again with a narrower list on sign-out and drops the rows it held', () => {
    auth = { user: { uid: 'u' }, isAdmin: false };
    profile = { speakerId: 'spk-1', registrationStatus: 'pending' };
    const { result, rerender } = renderHook(() => useLiveUpdates());
    expect(subscribeLiveUpdatesMock).toHaveBeenLastCalledWith(
      ['everyone', 'attendees', 'speakers'],
      expect.any(Function),
    );
    act(() => capturedOnNext([{ id: 'u1', audience: 'speakers', message: 'Green room' }]));
    expect(result.current.updates).toHaveLength(1);

    auth = { user: null, isAdmin: false };
    profile = null;
    rerender();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(subscribeLiveUpdatesMock).toHaveBeenLastCalledWith(['everyone'], expect.any(Function));
    expect(result.current.updates).toEqual([]);
    expect(result.current.loading).toBe(true);
  });
});
