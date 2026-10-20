import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BRANDING_SPLIT_KEY,
  DOCKET_GROUPS_KEY,
  RAIL_COLLAPSED_KEY,
  forgetLayoutMemory,
  readDocketGroups,
  readRailCollapsed,
  readSplit,
  writeDocketGroups,
  writeRailCollapsed,
  writeSplit,
} from './layoutPreference.js';

const LIMITS = { min: 30, max: 70, defaultValue: 50 };

beforeEach(() => {
  window.localStorage.clear();
  forgetLayoutMemory();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the remembered admin layout', () => {
  it('starts with the rail shown, every group on its default, and the default split', () => {
    expect(readRailCollapsed()).toBe(false);
    expect(readDocketGroups()).toEqual({});
    expect(readSplit(BRANDING_SPLIT_KEY, LIMITS)).toBe(50);
  });

  it('keeps each choice in browser storage under a versioned key', () => {
    writeRailCollapsed(true);
    writeDocketGroups({ content: true, settings: false });
    writeSplit(BRANDING_SPLIT_KEY, 40);
    expect(window.localStorage.getItem(RAIL_COLLAPSED_KEY)).toBe('true');
    expect(JSON.parse(window.localStorage.getItem(DOCKET_GROUPS_KEY))).toEqual({
      content: true,
      settings: false,
    });

    // A new tab reads the same answers back from storage alone.
    forgetLayoutMemory();
    expect(readRailCollapsed()).toBe(true);
    expect(readDocketGroups()).toEqual({ content: true, settings: false });
    expect(readSplit(BRANDING_SPLIT_KEY, LIMITS)).toBe(40);
  });

  it('ignores a stored value it cannot use', () => {
    window.localStorage.setItem(RAIL_COLLAPSED_KEY, '"yes"');
    window.localStorage.setItem(DOCKET_GROUPS_KEY, '{"content":"open","people":true}');
    window.localStorage.setItem(BRANDING_SPLIT_KEY, 'not json');
    expect(readRailCollapsed()).toBe(false);
    expect(readDocketGroups()).toEqual({ people: true });
    expect(readSplit(BRANDING_SPLIT_KEY, LIMITS)).toBe(50);

    window.localStorage.setItem(DOCKET_GROUPS_KEY, '["content"]');
    expect(readDocketGroups()).toEqual({});
  });

  it('gives the default for a split outside the limits', () => {
    window.localStorage.setItem(BRANDING_SPLIT_KEY, '95');
    expect(readSplit(BRANDING_SPLIT_KEY, LIMITS)).toBe(50);
    window.localStorage.setItem(BRANDING_SPLIT_KEY, '12');
    expect(readSplit(BRANDING_SPLIT_KEY, LIMITS)).toBe(50);
  });

  it('holds each choice for the life of the tab when the browser refuses its store', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readRailCollapsed()).toBe(false);
    expect(() => writeRailCollapsed(true)).not.toThrow();
    expect(() => writeDocketGroups({ content: false })).not.toThrow();
    expect(() => writeSplit(BRANDING_SPLIT_KEY, 60)).not.toThrow();
    expect(readRailCollapsed()).toBe(true);
    expect(readDocketGroups()).toEqual({ content: false });
    expect(readSplit(BRANDING_SPLIT_KEY, LIMITS)).toBe(60);
  });

  it('works where browser storage does not exist at all', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('no storage');
      },
    });
    try {
      expect(readRailCollapsed()).toBe(false);
      writeRailCollapsed(true);
      expect(readRailCollapsed()).toBe(true);
    } finally {
      Object.defineProperty(window, 'localStorage', original);
    }
  });
});
