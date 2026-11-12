import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import useLoadingStage from './useLoadingStage.js';

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
afterEach(() => {
  cleanup();
  document.getElementById('app-boot')?.remove();
  vi.useRealTimers();
});

describe('useLoadingStage', () => {
  it('continues the HTML navigation clock through the first render and StrictMode replay', () => {
    const boot = document.createElement('div');
    boot.id = 'app-boot';
    document.body.append(boot);
    act(() => vi.advanceTimersByTime(1500));
    const { result, unmount } = renderHook(() => useLoadingStage(), { wrapper: StrictMode });
    expect(result.current.stage).toBe('active');
    boot.remove();
    act(() => vi.advanceTimersByTime(8499));
    expect(result.current.stage).toBe('active');
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.stage).toBe('slow');
    unmount();
    const next = renderHook(() => useLoadingStage());
    expect(next.result.current.stage).toBe('initial');
    act(() => vi.advanceTimersByTime(1000));
    expect(next.result.current.stage).toBe('active');
  });

  it('renders an already-slow initial request immediately and retries with a fresh clock', () => {
    const boot = document.createElement('div');
    boot.id = 'app-boot';
    document.body.append(boot);
    act(() => vi.advanceTimersByTime(11000));
    const rendered = [];
    const { result } = renderHook(() => {
      const loading = useLoadingStage();
      rendered.push(loading.stage);
      return loading;
    });
    expect(rendered[0]).toBe('slow');
    expect(vi.getTimerCount()).toBe(1);
    act(() => result.current.restart());
    expect(result.current.stage).toBe('initial');
    expect(vi.getTimerCount()).toBe(3);
    act(() => vi.advanceTimersByTime(10000));
    expect(result.current.stage).toBe('slow');
    act(() => vi.advanceTimersByTime(50000));
    expect(result.current.stage).toBe('prolonged');
  });

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
