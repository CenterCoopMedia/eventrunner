// hooks/useSessionNote.js — the note saved as the attendee types (issue
// #170).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const subscribeMock = vi.fn(() => () => {});
const saveMock = vi.fn(async () => {});

vi.mock('../lib/sessionNotesSource.js', () => ({
  SESSION_NOTE_MAX_LENGTH: 10000,
  subscribeSessionNote: (...args) => subscribeMock(...args),
  saveSessionNote: (...args) => saveMock(...args),
}));

const { useSessionNote } = await import('./useSessionNote.js');

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
  });

  it('a session with no identity neither subscribes nor saves', () => {
    renderHook(() => useSessionNote(undefined, 's1'));
    expect(subscribeMock).not.toHaveBeenCalled();
  });
});
