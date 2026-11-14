import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearLocalDrafts, openLocalDraft } from '../lib/localDraft.js';
import { useLocalDraft } from './useLocalDraft.js';

const initial = { accountId: 'alice', docPath: 'cmsPages/faq', version: 'v1', baseline: 'saved', value: 'saved', dirty: false, enabled: true };
const read = () => openLocalDraft('alice', 'cmsPages/faq', 'v1').read();
const mount = (props = initial) => renderHook((next) => useLocalDraft(next), { initialProps: props });
beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());

describe('local draft lifecycle', () => {
  it('debounces within one second, flushes lifecycle events and offers an explicit restore after unmount', () => {
    const view = mount();
    view.rerender({ ...initial, value: 'long <b>text</b>\nnext line', dirty: true });
    act(() => vi.advanceTimersByTime(499));
    expect(read()).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(read().value).toBe('long <b>text</b>\nnext line');
    view.rerender({ ...initial, value: 'latest', dirty: true });
    act(() => window.dispatchEvent(new Event('pagehide')));
    expect(read().value).toBe('latest');
    view.rerender({ ...initial, value: 'last keystroke', dirty: true });
    view.unmount(); // Lost session: no explicit sign-out or leave dialog.
    expect(read().value).toBe('last keystroke');
    const reopened = mount();
    expect(reopened.result.current.recovery.value).toBe('last keystroke');
    expect(reopened.result.current.kept).toBe(false);
    let restored;
    act(() => { restored = reopened.result.current.restore(); });
    expect(restored).toBe('last keystroke');
    reopened.rerender({ ...initial, value: restored, dirty: true });
    act(() => reopened.result.current.saved(restored));
    expect(read()).toBeNull();
    reopened.unmount();
    expect(read()).toBeNull();
  });

  it('flushes when the document is hidden and discards without rewriting on unmount', () => {
    const view = mount({ ...initial, value: 'hidden text', dirty: true });
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(read().value).toBe('hidden text');
    act(() => view.result.current.discard());
    view.unmount();
    expect(read()).toBeNull();
    visibility.mockRestore();
  });

  it.each(['local sign-out', 'another tab'])('never rewrites after %s, even before the first debounce', (source) => {
    const view = mount({ ...initial, value: 'private text', dirty: true });
    act(() => {
      if (source === 'local sign-out') clearLocalDrafts('alice');
      else {
        // A real storage event is sent to the other documents after the marker changes.
        const key = 'eventrunner:admin-draft-signout:alice';
        localStorage.setItem(key, 'other-tab-logout');
        window.dispatchEvent(new StorageEvent('storage', { key, newValue: 'other-tab-logout' }));
      }
    });
    view.rerender({ ...initial, value: 'still-mounted editor', dirty: true });
    act(() => vi.advanceTimersByTime(1000));
    view.unmount();
    expect(read()).toBeNull();
  });

  it('keeps the original version warning after restoring an older copy', () => {
    openLocalDraft('alice', 'cmsPages/faq', 'old').write('older text', 'older baseline');
    const view = mount();
    expect(view.result.current.recovery.version).toBe('old');
    let value;
    act(() => { value = view.result.current.restore(); });
    view.rerender({ ...initial, value, dirty: true });
    view.unmount();
    expect(read()).toMatchObject({ value: 'older text', version: 'old', baseline: 'older baseline' });
  });

  it('keeps newer typing when an earlier save completes', () => {
    const view = mount({ ...initial, value: 'submitted', dirty: true });
    view.rerender({ ...initial, value: 'typed during save', dirty: true });
    act(() => view.result.current.saved('submitted'));
    expect(read().value).toBe('typed during save');
    view.unmount();
    expect(read().value).toBe('typed during save');
  });

  it('does not read or write in a read-only demo', () => {
    openLocalDraft('alice', 'cmsPages/faq', 'old').write('existing copy', 'saved');
    const set = vi.spyOn(Storage.prototype, 'setItem');
    const view = mount({ ...initial, enabled: false, value: 'demo text', dirty: true });
    expect(view.result.current.recovery).toBeNull();
    act(() => vi.advanceTimersByTime(1000));
    view.unmount();
    expect(set).not.toHaveBeenCalled();
    expect(read().value).toBe('existing copy');
    set.mockRestore();
  });
});
