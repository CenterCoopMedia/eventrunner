import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAutosave } from './useAutosave.js';
import { readKeptAnswer } from './keptAnswers.js';

const scope = { userId: 'ana', orgId: 'o1', appId: 'a1' };
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

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
    expect(result.current.failure).toEqual({ status: 0, code: 'network' });
    await act(async () => { ok = await result.current.flush(); });
    expect(ok).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toEqual({ step: 'organization', answers: { website: 'x.org' } });
    expect(result.current.status).toBe('saved');
    expect(result.current.failure).toBeNull();
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

  it.each(['visibilitychange', 'pagehide'])('keeps a keystroke before the %s save starts, inside the debounce window', async (event) => {
    vi.useFakeTimers();
    const value = { step: 'event', answers: { name: 'Kept event' } };
    const save = vi.fn(async () => {
      expect(readKeptAnswer(scope, 'event')).toEqual(value);
      return { saved: true };
    });
    const { result } = renderHook(() => useAutosave({ save, scope }));
    act(() => result.current.queue(value));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(save).not.toHaveBeenCalled();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => {
      (event === 'pagehide' ? window : document).dispatchEvent(new Event(event));
    });
    expect(save).toHaveBeenCalledExactlyOnceWith(value, { keepalive: true });
    expect(readKeptAnswer(scope, 'event')).toBeNull();
  });

  it.each([true, false])('keeps the newest value and unload warning when an earlier save completes with saved=%s', async (saved) => {
    let finish;
    const save = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockImplementationOnce(() => new Promise(() => {}));
    const { result } = renderHook(() => useAutosave({ save, scope }));
    act(() => result.current.queue({ step: 'event', answers: { name: 'Old' } }));
    let first;
    await act(async () => { first = result.current.flush(); });
    const newest = { step: 'event', answers: { name: 'Newest' } };
    act(() => result.current.queue(newest));
    act(() => window.dispatchEvent(new Event('pagehide')));
    expect(readKeptAnswer(scope, 'event')).toEqual(newest);
    await act(async () => { finish({ saved }); await first; });
    expect(readKeptAnswer(scope, 'event')).toEqual(newest);
    expect(save.mock.calls[1]).toEqual([newest, { keepalive: true }]);
    expect(result.current.status).toBe('saving');
    const warning = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(warning);
    expect(warning.defaultPrevented).toBe(true);
  });

  it('keeps an in-flight value even when nothing is pending in the debounce ref', async () => {
    let finish;
    const value = { step: 'event', answers: { name: 'In flight' } };
    const save = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useAutosave({ save, scope }));
    act(() => result.current.queue(value));
    let first;
    await act(async () => { first = result.current.flush(); });
    act(() => window.dispatchEvent(new Event('pagehide')));
    expect(readKeptAnswer(scope, 'event')).toEqual(value);
    await act(async () => { finish({ saved: true }); await first; });
    expect(readKeptAnswer(scope, 'event')).toBeNull();
  });

  it.each([false, true])('clears a failed answer after saving its retry or correction (corrected=%s), scoped to the reader, request and step', async (corrected) => {
    const save = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValue({ saved: true });
    const value = { step: 'event', answers: { name: 'Retry me' } };
    const { result } = renderHook(() => useAutosave({ save, scope }));
    act(() => result.current.queue(value));
    await act(async () => { await result.current.flush(); });
    expect(readKeptAnswer(scope, 'event')).toEqual(value);
    expect(readKeptAnswer({ ...scope, userId: 'other' }, 'event')).toBeNull();
    expect(readKeptAnswer({ ...scope, appId: 'a2' }, 'event')).toBeNull();
    expect(readKeptAnswer(scope, 'email')).toBeNull();
    if (corrected) act(() => result.current.queue({ step: 'event', answers: { name: 'Corrected answer' } }));
    await act(async () => { await result.current.flush(); });
    expect(readKeptAnswer(scope, 'event')).toBeNull();
  });

  it('only attaches the unload warning while an answer is unsaved', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const { result } = renderHook(() => useAutosave({ save: vi.fn(async () => ({ saved: true })), scope }));
    expect(add.mock.calls.filter(([event]) => event === 'beforeunload')).toHaveLength(0);
    act(() => result.current.queue({ step: 'event', answers: { name: 'Draft' } }));
    const warning = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(warning);
    expect(warning.defaultPrevented).toBe(true);
    await act(async () => { await result.current.flush(); });
    expect(remove.mock.calls.some(([event]) => event === 'beforeunload')).toBe(true);
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
  });

  it('still saves when tab storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Blocked'); });
    const save = vi.fn(async () => ({ saved: true }));
    const { result } = renderHook(() => useAutosave({ save, scope }));
    act(() => result.current.queue({ step: 'event', answers: { name: 'Draft' } }));
    await act(async () => { window.dispatchEvent(new Event('pagehide')); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('saved');
  });
});
