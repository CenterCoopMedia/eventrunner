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
    profile = { id: 'u', speakerId: 'spk-1', registrationStatus: 'pending' };
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

  it('never shows a speaker row to the next account on a direct account switch (Codex P1)', () => {
    auth = { user: { uid: 'speaker-uid' }, isAdmin: false };
    profile = { id: 'speaker-uid', speakerId: 'spk-1', registrationStatus: 'pending' };
    const { result, rerender } = renderHook(() => useLiveUpdates());
    const speakerOnNext = capturedOnNext;
    act(() => speakerOnNext([{ id: 'u1', audience: 'speakers', message: 'Green room' }]));
    expect(result.current.updates).toHaveLength(1);

    // Another account signs in. The profile context still holds the
    // speaker's document until its own listener reports.
    auth = { user: { uid: 'attendee-uid' }, isAdmin: false };
    rerender();
    expect(result.current.updates).toEqual([]);
    expect(result.current.loading).toBe(true);
    // The stale profile grants nothing: the new listener asks for everyone.
    expect(subscribeLiveUpdatesMock).toHaveBeenLastCalledWith(['everyone'], expect.any(Function));
    // A late snapshot from the speaker's listener is not shown either.
    act(() => speakerOnNext([{ id: 'u1', audience: 'speakers', message: 'Green room' }]));
    expect(result.current.updates).toEqual([]);

    // Once the new account's own profile arrives, it gets its own list.
    profile = { id: 'attendee-uid', speakerId: null, registrationStatus: 'approved' };
    rerender();
    expect(subscribeLiveUpdatesMock).toHaveBeenLastCalledWith(['everyone', 'attendees'], expect.any(Function));
    act(() => capturedOnNext([{ id: 'u2', audience: 'attendees', message: 'Badge desk' }]));
    expect(result.current.updates.map((u) => u.id)).toEqual(['u2']);
  });

  it('listens again and drops the rows when the account changes, even with the same audiences', () => {
    // The same list for two accounts is still two keys:
    // rows read under one account are never shown under the other.
    auth = { user: { uid: 'a' }, isAdmin: false };
    profile = { id: 'a', registrationStatus: 'pending' };
    const { result, rerender } = renderHook(() => useLiveUpdates());
    act(() => capturedOnNext([{ id: 'u1', message: 'Hello' }]));
    auth = { user: { uid: 'b' }, isAdmin: false };
    profile = { id: 'b', registrationStatus: 'pending' };
    rerender();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(result.current.updates).toEqual([]);
  });
});
