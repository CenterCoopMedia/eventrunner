// useAdminRecords (issue #195): the record list's two listeners, live and
// draft, over one collection. Codex review on #284: an error belongs to the
// listener that failed, and only that listener's next answer clears it.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const listeners = new Map();
vi.mock('./adminSource.js', () => ({
  subscribeAdminCollection: (name, onNext, onError) => {
    listeners.set(name, { onNext, onError });
    return () => listeners.delete(name);
  },
}));

import { useAdminRecords } from './useAdminRecords.js';

const LIVE = [{ id: 'home', title: 'Home' }];
const DRAFTS = [{ id: 'home', title: 'Home', status: 'clean' }];

beforeEach(() => {
  listeners.clear();
});

describe('useAdminRecords', () => {
  it('keeps a failed listener’s error while the other listener answers', () => {
    const { result } = renderHook(() => useAdminRecords('cmsPages'));
    const failure = new Error('permission-denied');
    act(() => listeners.get('cmsPages').onError(failure));
    act(() => listeners.get('cmsPages_drafts').onNext(DRAFTS));
    expect(result.current.ready).toBe(false);
    expect(result.current.error).toBe(failure);
    expect(result.current.loading).toBe(false);

    // Only the failed listener's own answer clears it.
    act(() => listeners.get('cmsPages').onNext(LIVE));
    expect(result.current.error).toBe(null);
    expect(result.current.ready).toBe(true);
  });

  it('keeps an error that comes after both have reported, while the healthy one updates', () => {
    const { result } = renderHook(() => useAdminRecords('cmsPages'));
    act(() => {
      listeners.get('cmsPages').onNext(LIVE);
      listeners.get('cmsPages_drafts').onNext(DRAFTS);
    });
    const failure = new Error('stream error');
    act(() => listeners.get('cmsPages_drafts').onError(failure));
    act(() => listeners.get('cmsPages').onNext([...LIVE, { id: 'travel', title: 'Travel' }]));
    expect(result.current.error).toBe(failure);
    act(() => listeners.get('cmsPages_drafts').onNext(DRAFTS));
    expect(result.current.error).toBe(null);
  });
});
