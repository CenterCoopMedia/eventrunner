// useSessionMaterials — a session switch must not keep rendering the
// PREVIOUS session's rows until the new session's first snapshot arrives
// (issue #23 follow-up, same class of bug as the reactions hook fix). No
// Firebase, no network (spec §8.1); mocks lib/materialsSource.js directly.
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSessionMaterials, useSessionMaterialsCount } from './useSessionMaterials.js';

const capturedBySessionId = new Map();
const subscribeSessionMaterialsMock = vi.fn((sessionId, onNext, onError) => {
  capturedBySessionId.set(sessionId, { onNext, onError });
  return () => {};
});
vi.mock('../lib/materialsSource.js', () => ({
  subscribeSessionMaterials: (...args) => subscribeSessionMaterialsMock(...args),
}));

describe('useSessionMaterials', () => {
  it('starts loading and clears once the first snapshot arrives', () => {
    const { result } = renderHook(({ sessionId }) => useSessionMaterials(sessionId), {
      initialProps: { sessionId: 's1' },
    });
    expect(result.current.loading).toBe(true);
    act(() => capturedBySessionId.get('s1').onNext([{ id: 'm1' }]));
    expect(result.current.loading).toBe(false);
    expect(result.current.materials).toEqual([{ id: 'm1' }]);
  });

  it('clears the previous session\'s rows immediately on a sessionId change, before the new snapshot arrives', () => {
    const { result, rerender } = renderHook(({ sessionId }) => useSessionMaterials(sessionId), {
      initialProps: { sessionId: 's1' },
    });
    act(() => capturedBySessionId.get('s1').onNext([{ id: 'm1', sessionId: 's1' }]));
    expect(result.current.materials).toEqual([{ id: 'm1', sessionId: 's1' }]);

    rerender({ sessionId: 's2' });
    // Cleared synchronously by the effect, BEFORE s2's subscription callback
    // has fired at all — this is the stale-data window the fix closes.
    expect(result.current.materials).toEqual([]);
    expect(result.current.loading).toBe(true);

    act(() => capturedBySessionId.get('s2').onNext([{ id: 'm2', sessionId: 's2' }]));
    expect(result.current.materials).toEqual([{ id: 'm2', sessionId: 's2' }]);
  });

  it('fail-soft retention on a listener error only ever applies within the SAME session', () => {
    const { result, rerender } = renderHook(({ sessionId }) => useSessionMaterials(sessionId), {
      initialProps: { sessionId: 's1' },
    });
    act(() => capturedBySessionId.get('s1').onNext([{ id: 'm1', sessionId: 's1' }]));

    rerender({ sessionId: 's2' });
    expect(result.current.materials).toEqual([]);
    // s2's listener fails before ever succeeding — fail-soft keeps the
    // (already-cleared) empty list, never s1's stale rows.
    act(() => capturedBySessionId.get('s2').onError(new Error('permission denied')));
    expect(result.current.loading).toBe(false);
    expect(result.current.materials).toEqual([]);
  });
});

describe('useSessionMaterialsCount', () => {
  it('is null when there are no materials, and the row count once rows arrive', () => {
    const { result } = renderHook(({ session }) => useSessionMaterialsCount(session), {
      initialProps: { session: { id: 's1' } },
    });
    expect(result.current).toBeNull();
    act(() => capturedBySessionId.get('s1').onNext([{ id: 'm1' }, { id: 'm2' }]));
    expect(result.current).toBe(2);
  });
});
