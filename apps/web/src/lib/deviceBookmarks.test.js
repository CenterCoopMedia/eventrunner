import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let store;
beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  store = await import('./deviceBookmarks.js');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('browser session saves', () => {
  it('survives a fresh module load, keeps ids unique and separates event projects', async () => {
    store.setDeviceBookmarked('session-one', true);
    store.setDeviceBookmarked('session-one', true);
    store.setDeviceBookmarked('session-two', true);
    vi.resetModules();
    const reopened = await import('./deviceBookmarks.js');
    expect(reopened.getDeviceBookmarks().ids).toEqual(['session-one', 'session-two']);
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'another-event');
    vi.resetModules();
    const another = await import('./deviceBookmarks.js');
    expect(another.DEVICE_BOOKMARK_KEY).not.toBe(reopened.DEVICE_BOOKMARK_KEY);
    expect(another.getDeviceBookmarks().ids).toEqual([]);
    another.setDeviceBookmarked('other-session', true);
    expect(JSON.parse(localStorage.getItem(reopened.DEVICE_BOOKMARK_KEY))).toEqual(['session-one', 'session-two']);
  });

  it('handles refused reads and writes without throwing or claiming a save', () => {
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(store.getDeviceBookmarks()).toMatchObject({ available: false, ids: [] });
    expect(store.setDeviceBookmarked('session-one', true)).toBe(false);
    read.mockRestore();
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(store.setDeviceBookmarked('session-one', true)).toBe(false);
    expect(store.removeDeviceBookmarks(['session-one'])).toBe(false);
    write.mockRestore();
    expect(localStorage.getItem(store.DEVICE_BOOKMARK_KEY)).toBeNull();
  });

  it('drops malformed ids, observes another tab and retains saves added during an import', () => {
    localStorage.setItem(store.DEVICE_BOOKMARK_KEY, JSON.stringify(['one', 'one', null, {}, '', 'bad/path']));
    expect(store.getDeviceBookmarks().ids).toEqual(['one']);
    const listener = vi.fn();
    const stop = store.subscribeDeviceBookmarks(listener);
    try {
      localStorage.setItem(store.DEVICE_BOOKMARK_KEY, JSON.stringify(['one', 'two']));
      window.dispatchEvent(new StorageEvent('storage', { key: store.DEVICE_BOOKMARK_KEY }));
      expect(store.getDeviceBookmarks().ids).toEqual(['one', 'two']);
      expect(listener).toHaveBeenCalledTimes(1);
      store.removeDeviceBookmarks(['one']);
      expect(store.getDeviceBookmarks().ids).toEqual(['two']);
    } finally { stop(); }
  });
});
