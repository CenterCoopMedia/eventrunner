import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DARK_QUERY,
  SUPPRESS_STYLE_ID,
  applyMode,
  prefersDark,
  startModeSync,
} from './modeRuntime.js';

/**
 * A `matchMedia` stand-in that can flip and notify, the way a real browser
 * does when the reader changes their operating system theme.
 */
function fakeMediaView(initialMatches) {
  const listeners = new Set();
  const query = {
    matches: initialMatches,
    media: DARK_QUERY,
    addEventListener: (_type, fn) => listeners.add(fn),
    removeEventListener: (_type, fn) => listeners.delete(fn),
  };
  return {
    matchMedia: () => query,
    requestAnimationFrame: (fn) => { fn(); return 0; },
    set: (matches) => {
      query.matches = matches;
      for (const fn of listeners) fn({ matches });
    },
    listenerCount: () => listeners.size,
  };
}

beforeEach(() => {
  delete document.documentElement.dataset.mode;
  document.documentElement.style.colorScheme = '';
  // Every one, not just the first: a swap whose animation frames had not
  // run by the end of the previous test leaves its element behind, and
  // getElementById would only clear one of them.
  for (const el of document.querySelectorAll(`#${SUPPRESS_STYLE_ID}`)) el.remove();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('applyMode', () => {
  it('writes data-mode and color-scheme onto the document element', () => {
    applyMode('dark');
    expect(document.documentElement.dataset.mode).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    applyMode('light');
    expect(document.documentElement.dataset.mode).toBe('light');
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('disables transitions across the swap and re-enables them after', () => {
    // Hold the animation frames so the assertion can look at the page in
    // the state a reader would see mid-swap: attribute changed, transitions
    // off (interface guidelines, Animation).
    const frames = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((fn) => frames.push(fn));

    applyMode('dark');
    expect(document.documentElement.dataset.mode).toBe('dark');
    expect(document.getElementById(SUPPRESS_STYLE_ID)?.textContent).toContain(
      'transition: none !important',
    );

    while (frames.length > 0) frames.shift()();
    expect(document.querySelectorAll(`#${SUPPRESS_STYLE_ID}`).length).toBe(0);
  });

  it('does nothing when the document already carries that mode', () => {
    applyMode('dark');
    for (const el of document.querySelectorAll(`#${SUPPRESS_STYLE_ID}`)) el.remove();
    applyMode('dark');
    expect(document.getElementById(SUPPRESS_STYLE_ID)).toBeNull();
  });
});

describe('prefersDark', () => {
  it('reads the media query, and answers no where matchMedia is missing', () => {
    expect(prefersDark(fakeMediaView(true))).toBe(true);
    expect(prefersDark(fakeMediaView(false))).toBe(false);
    expect(prefersDark({})).toBe(false);
    expect(prefersDark(undefined)).toBe(false);
  });
});

describe('startModeSync', () => {
  it('applies a fixed policy and subscribes to nothing', () => {
    const view = fakeMediaView(true);
    const stop = startModeSync('light', { view });
    expect(document.documentElement.dataset.mode).toBe('light');
    expect(view.listenerCount()).toBe(0);
    stop();
  });

  it('follows prefers-color-scheme under the system policy', () => {
    const view = fakeMediaView(true);
    const stop = startModeSync('system', { view });
    expect(document.documentElement.dataset.mode).toBe('dark');
    view.set(false);
    expect(document.documentElement.dataset.mode).toBe('light');
    stop();
    expect(view.listenerCount()).toBe(0);
  });

  it('renders light for a document that predates the mode policy', () => {
    // Existing deployments have no `mode` field, and light is what they
    // already render.
    const stop = startModeSync(undefined, { view: fakeMediaView(true) });
    expect(document.documentElement.dataset.mode).toBe('light');
    stop();
  });

  it('renders light for a policy it does not recognize', () => {
    const stop = startModeSync('sepia', { view: fakeMediaView(true) });
    expect(document.documentElement.dataset.mode).toBe('light');
    stop();
  });

  it('supports the older addListener spelling', () => {
    const listeners = new Set();
    const query = {
      matches: false,
      addListener: (fn) => listeners.add(fn),
      removeListener: (fn) => listeners.delete(fn),
    };
    const view = { matchMedia: () => query, requestAnimationFrame: (fn) => { fn(); return 0; } };
    const stop = startModeSync('system', { view });
    expect(listeners.size).toBe(1);
    for (const fn of listeners) fn({ matches: true });
    expect(document.documentElement.dataset.mode).toBe('dark');
    stop();
    expect(listeners.size).toBe(0);
  });
});
