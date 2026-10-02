import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAnnouncements } from './useAnnouncements.js';

let report;
vi.mock('../lib/announcementsSource.js', () => ({
  subscribeAnnouncements: vi.fn((onNext) => { report = onNext; return () => {}; }),
}));

describe('useAnnouncements', () => {
  afterEach(() => vi.useRealTimers());

  it('shows and removes a row at its exact active-window boundaries without another snapshot', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T13:00:00.000Z'));
    const { result } = renderHook(() => useAnnouncements());
    act(() => report([{
      id: 'a1',
      message: 'Doors moved.',
      level: 'info',
      startsAt: '2026-10-02T13:01:00.000Z',
      endsAt: '2026-10-02T13:02:00.000Z',
    }]));
    expect(result.current).toEqual([]);

    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current.map((row) => row.id)).toEqual(['a1']);

    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current).toEqual([]);
  });
});
