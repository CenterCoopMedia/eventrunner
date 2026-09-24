// The editor tour's stored mark (issue #198): per account, per browser, and
// safe when the browser refuses its store.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markTourDone, readTourDone, tourStorageKey } from './tourState.js';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('tourState', () => {
  it('keys the mark by account under a versioned name', () => {
    expect(tourStorageKey('uid-1')).toBe('eventrunner.adminTour.v1:uid-1');
  });

  it('reads nothing as not done, and a mark as done for that account only', () => {
    expect(readTourDone('uid-1')).toBe(false);
    markTourDone('uid-1');
    expect(window.localStorage.getItem('eventrunner.adminTour.v1:uid-1')).toBe('done');
    expect(readTourDone('uid-1')).toBe(true);
    expect(readTourDone('uid-2')).toBe(false);
  });

  it('compares the stored value exactly', () => {
    window.localStorage.setItem(tourStorageKey('uid-1'), 'Done');
    expect(readTourDone('uid-1')).toBe(false);
  });

  it('reads a throwing store as not done, and holds an end it could not write for the tab', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readTourDone('uid-blocked')).toBe(false);
    expect(() => markTourDone('uid-blocked')).not.toThrow();
    expect(readTourDone('uid-blocked')).toBe(true);
    // Another account in the same tab still meets the tour.
    expect(readTourDone('uid-other')).toBe(false);
  });
});
