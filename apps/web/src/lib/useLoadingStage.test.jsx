import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import useLoadingStage from './useLoadingStage.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useLoadingStage', () => {
  it('schedules only active work and clears timers as soon as it finishes', () => {
    const { result, rerender, unmount } = renderHook(
      ({ active }) => useLoadingStage({ active }),
      { initialProps: { active: false } },
    );
    expect(result.current.stage).toBe('initial');
    expect(vi.getTimerCount()).toBe(0);
    rerender({ active: true });
    expect(vi.getTimerCount()).toBe(3);
    act(() => vi.advanceTimersByTime(10000));
    expect(result.current.stage).toBe('slow');
    rerender({ active: false });
    expect(result.current.stage).toBe('initial');
    expect(vi.getTimerCount()).toBe(0);
    rerender({ active: true });
    expect(result.current.stage).toBe('initial');
    expect(vi.getTimerCount()).toBe(3);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('restarts elapsed stages without retaining the old attempt’s timers', () => {
    const { result } = renderHook(() => useLoadingStage());
    act(() => vi.advanceTimersByTime(9000));
    expect(result.current.stage).toBe('active');
    act(() => result.current.restart());
    expect(result.current.stage).toBe('initial');
    expect(vi.getTimerCount()).toBe(3);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.stage).toBe('active');
    act(() => vi.advanceTimersByTime(8999));
    expect(result.current.stage).toBe('active');
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.stage).toBe('slow');
  });
});
