import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAutosave } from './useAutosave.js';

describe('useAutosave', () => {
  it('keeps a value whose save failed, says so, and sends it again on the next flush', async () => {
    const save = vi.fn()
      .mockRejectedValueOnce(new Error('No connection.'))
      .mockResolvedValueOnce({ saved: true });
    const { result } = renderHook(() => useAutosave({ save }));
    act(() => result.current.queue({ step: 'organization', answers: { website: 'x.org' } }));
    let ok;
    await act(async () => { ok = await result.current.flush(); });
    expect(ok).toBe(false);
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('No connection.');
    await act(async () => { ok = await result.current.flush(); });
    expect(ok).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toEqual({ step: 'organization', answers: { website: 'x.org' } });
    expect(result.current.status).toBe('saved');
  });

  it('sends a newer value instead of the failed one', async () => {
    const save = vi.fn()
      .mockRejectedValueOnce(new Error('No connection.'))
      .mockResolvedValue({ saved: true });
    const { result } = renderHook(() => useAutosave({ save }));
    act(() => result.current.queue({ n: 1 }));
    await act(async () => { await result.current.flush(); });
    act(() => result.current.queue({ n: 2 }));
    let ok;
    await act(async () => { ok = await result.current.flush(); });
    expect(ok).toBe(true);
    expect(save.mock.calls.map(([v]) => v)).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('does not say saved while a newer value is still waiting', async () => {
    let finish;
    const save = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useAutosave({ save }));
    act(() => result.current.queue({ n: 1 }));
    let first;
    await act(async () => { first = result.current.flush(); });
    expect(result.current.status).toBe('saving');
    // The client types again while the first save is on its way.
    act(() => result.current.queue({ n: 2 }));
    await act(async () => { finish({ saved: true }); await first; });
    expect(result.current.status).toBe('waiting');
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('a flush with nothing waiting reports success', async () => {
    const { result } = renderHook(() => useAutosave({ save: vi.fn() }));
    let ok;
    await act(async () => { ok = await result.current.flush(); });
    expect(ok).toBe(true);
  });
});
