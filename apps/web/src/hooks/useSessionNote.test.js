// hooks/useSessionNote.js — the note saved as the attendee types (issue
// #170).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, fireEvent, render, renderHook } from '@testing-library/react';

const subscribeMock = vi.fn(() => () => {});
const saveMock = vi.fn(async () => {});

vi.mock('../lib/sessionNotesSource.js', () => ({
  SESSION_NOTE_MAX_LENGTH: 10000,
  subscribeSessionNote: (...args) => subscribeMock(...args),
  saveSessionNote: (...args) => saveMock(...args),
}));

const { useSessionNote } = await import('./useSessionNote.js');
const { default: SessionNote } = await import('../components/session/SessionNote.jsx');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('useSessionNote', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    subscribeMock.mockReset().mockImplementation((_uid, _sessionId, onNext) => {
      onNext('');
      return () => {};
    });
    saveMock.mockReset().mockImplementation(async () => {});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts empty, then mirrors the document', () => {
    const { result } = renderHook(() => useSessionNote('u1', 's1'));
    expect(result.current.draft).toBe('');

    act(() => {
      subscribeMock.mock.calls[0][2]('From the document');
    });
    expect(result.current.draft).toBe('From the document');
    expect(result.current.saved).toBe('From the document');
  });

  it('saves the draft after the debounce, not per keystroke', async () => {
    const { result } = renderHook(() => useSessionNote('u1', 's1'));

    act(() => {
      result.current.edit('a');
      vi.advanceTimersByTime(400);
      result.current.edit('ab');
      vi.advanceTimersByTime(400);
      result.current.edit('abc');
    });
    expect(saveMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(saveMock).toHaveBeenCalledWith('u1', 's1', 'abc');
    // The draft mirrors the document again once the save commits.
    expect(result.current.state).toBe('saved');
  });

  it('an error keeps the draft so typing is never lost, and says so', async () => {
    saveMock.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useSessionNote('u1', 's1'));

    act(() => {
      result.current.edit('kept');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    expect(result.current.state).toBe('error');
    expect(result.current.draft).toBe('kept');

    act(() => {
      subscribeMock.mock.calls[0][2]('From the listener');
    });
    expect(result.current.state).toBe('error');
    expect(result.current.draft).toBe('kept');
  });

  it('flushes the latest draft on blur without waiting for the debounce', async () => {
    const delayedSave = deferred();
    saveMock.mockImplementationOnce(() => delayedSave.promise);
    const view = render(createElement(SessionNote, { uid: 'u1', sessionId: 's1' }));
    const textarea = view.getByLabelText('Private note');

    fireEvent.change(textarea, { target: { value: 'blurred draft' } });
    await act(async () => {
      fireEvent.blur(textarea);
      await Promise.resolve();
    });
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(saveMock).toHaveBeenCalledWith('u1', 's1', 'blurred draft');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(saveMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      delayedSave.resolve();
      await delayedSave.promise;
    });
  });

  it('flushes a pending draft to its original identity on unmount', async () => {
    const firstSave = deferred();
    const finalSave = deferred();
    saveMock
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => finalSave.promise);
    const { result, unmount } = renderHook(() => useSessionNote('u1', 's1'));

    act(() => {
      result.current.edit('first');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    act(() => {
      result.current.edit('leaving now');
      vi.advanceTimersByTime(400);
    });
    unmount();
    expect(saveMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstSave.resolve();
      await firstSave.promise;
    });
    expect(saveMock).toHaveBeenCalledTimes(2);
    expect(saveMock).toHaveBeenLastCalledWith('u1', 's1', 'leaving now');

    await act(async () => {
      finalSave.resolve();
      await finalSave.promise;
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(saveMock).toHaveBeenCalledTimes(2);
  });

  it('serializes overlapping saves and only completes the latest edit', async () => {
    const firstSave = deferred();
    const secondSave = deferred();
    saveMock
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise);
    const { result } = renderHook(() => useSessionNote('u1', 's1'));

    act(() => {
      result.current.edit('first');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(saveMock).toHaveBeenCalledWith('u1', 's1', 'first');

    act(() => {
      result.current.edit('second');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(result.current.draft).toBe('second');

    await act(async () => {
      firstSave.resolve();
      await firstSave.promise;
    });
    expect(saveMock).toHaveBeenCalledTimes(2);
    expect(saveMock).toHaveBeenLastCalledWith('u1', 's1', 'second');
    expect(result.current.saved).toBe('');
    expect(result.current.draft).toBe('second');
    expect(result.current.state).toBe('saving');

    await act(async () => {
      secondSave.resolve();
      await secondSave.promise;
    });
    expect(result.current.saved).toBe('second');
    expect(result.current.draft).toBe('second');
    expect(result.current.state).toBe('saved');
  });

  it('resets on identity change and ignores the old listener and save', async () => {
    const oldSave = deferred();
    saveMock.mockImplementationOnce(() => oldSave.promise);
    const { result, rerender } = renderHook(
      ({ uid, sessionId }) => useSessionNote(uid, sessionId),
      { initialProps: { uid: 'u1', sessionId: 's1' } },
    );
    const oldOnNext = subscribeMock.mock.calls[0][2];
    const oldOnError = subscribeMock.mock.calls[0][3];

    act(() => {
      result.current.edit('old draft');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    rerender({ uid: 'u2', sessionId: 's2' });
    expect(result.current.saved).toBe('');
    expect(result.current.draft).toBe('');
    expect(result.current.state).toBe('saved');

    act(() => {
      oldOnNext('old listener text');
      oldOnError(new Error('old listener error'));
    });
    await act(async () => {
      oldSave.resolve();
      await oldSave.promise;
    });
    expect(result.current.saved).toBe('');
    expect(result.current.draft).toBe('');
    expect(result.current.state).toBe('saved');
  });

  it('cancels a pending save when the identity changes', async () => {
    const { result, rerender } = renderHook(
      ({ uid, sessionId }) => useSessionNote(uid, sessionId),
      { initialProps: { uid: 'u1', sessionId: 's1' } },
    );

    act(() => {
      result.current.edit('old draft');
      vi.advanceTimersByTime(400);
    });
    rerender({ uid: 'u2', sessionId: 's2' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(saveMock).not.toHaveBeenCalled();
    expect(result.current.draft).toBe('');
  });

  it('clears a listener error when that listener delivers a later snapshot', () => {
    const { result } = renderHook(() => useSessionNote('u1', 's1'));

    act(() => {
      subscribeMock.mock.calls[0][3](new Error('offline'));
    });
    expect(result.current.state).toBe('error');

    act(() => {
      subscribeMock.mock.calls[0][2]('Recovered text');
    });
    expect(result.current.state).toBe('saved');
    expect(result.current.saved).toBe('Recovered text');
    expect(result.current.draft).toBe('Recovered text');
  });

  it('listener errors do not replace a pending edit or save, or discard its draft', async () => {
    const delayedSave = deferred();
    saveMock.mockImplementationOnce(() => delayedSave.promise);
    const { result } = renderHook(() => useSessionNote('u1', 's1'));

    act(() => {
      result.current.edit('kept');
      subscribeMock.mock.calls[0][3](new Error('offline'));
    });
    expect(result.current.state).toBe('editing');
    expect(result.current.draft).toBe('kept');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(result.current.state).toBe('saving');
    act(() => {
      subscribeMock.mock.calls[0][3](new Error('still offline'));
    });
    expect(result.current.state).toBe('saving');
    expect(result.current.draft).toBe('kept');

    await act(async () => {
      delayedSave.resolve();
      await delayedSave.promise;
    });
  });

  it('a session with no identity neither subscribes nor saves', async () => {
    const { result } = renderHook(() => useSessionNote(undefined, 's1'));
    act(() => {
      result.current.edit('never save');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(subscribeMock).not.toHaveBeenCalled();
    expect(saveMock).not.toHaveBeenCalled();
  });
});
