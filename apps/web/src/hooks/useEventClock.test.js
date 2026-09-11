// hooks/useEventClock.js — the timer behind the running/finished marks
// (issue #167).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { useEventClock } = await import('./useEventClock.js');

describe('useEventClock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('carries the present and moves it on the tick', () => {
    vi.setSystemTime(new Date('2026-10-15T14:00:00Z'));
    const { result } = renderHook(() => useEventClock());
    expect(result.current.getTime()).toBe(new Date('2026-10-15T14:00:00Z').getTime());

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.getTime()).toBe(new Date('2026-10-15T14:01:00Z').getTime());
  });

  it('stops moving on unmount', () => {
    vi.setSystemTime(new Date('2026-10-15T14:00:00Z'));
    const { result, unmount } = renderHook(() => useEventClock());
    unmount();
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(result.current.getTime()).toBe(new Date('2026-10-15T14:00:00Z').getTime());
  });
});
