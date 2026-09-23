// The runtime overlay and the preset remaps (catalog split, 2026-09-23).
//
// The remaps are a lazy chunk (lib/presetRemaps.js). Two things must hold
// on the public path: a first paint with no overlay asks for nothing and
// throws nothing, and an overlay that arrives before the chunk waits for it
// rather than writing a half-resolved style. The loader is faked here so the
// test controls when the chunk "arrives"; the resolver behind it is real,
// registered for every test by src/test/setup.js.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

const { subscriptions, loader } = vi.hoisted(() => ({
  subscriptions: new Map(),
  loader: { loaded: false, resolve: null, calls: 0 },
}));

vi.mock('../lib/configSource.js', () => ({
  subscribeConfigDoc: vi.fn((docId, onNext) => {
    subscriptions.set(docId, onNext);
    return () => subscriptions.delete(docId);
  }),
}));

vi.mock('../lib/presetRemaps.js', () => ({
  presetRemapsLoaded: () => loader.loaded,
  loadPresetRemaps: vi.fn(() => {
    loader.calls += 1;
    return new Promise((resolve) => {
      loader.resolve = () => {
        loader.loaded = true;
        resolve();
      };
    });
  }),
}));

import { EventConfigProvider } from './EventConfigContext.jsx';

function runtimeStyle() {
  return document.getElementById('event-theme-runtime');
}

beforeEach(() => {
  subscriptions.clear();
  runtimeStyle()?.remove();
  loader.loaded = false;
  loader.resolve = null;
  loader.calls = 0;
});

describe('EventConfigProvider and the preset remaps', () => {
  it('paints first from the snapshot without asking for the remaps or throwing', () => {
    expect(() =>
      render(
        <EventConfigProvider>
          <p>The page</p>
        </EventConfigProvider>,
      ),
    ).not.toThrow();
    expect(runtimeStyle()).not.toBeNull();
    expect(runtimeStyle().textContent).toBe('');
    expect(loader.calls).toBe(0);
  });

  it('waits for the remaps before it writes a live theme overlay, then writes it whole', async () => {
    render(
      <EventConfigProvider>
        <p>The page</p>
      </EventConfigProvider>,
    );
    act(() => {
      subscriptions.get('theme')({ preset: 'zine' });
    });
    // The overlay is asked for and the chunk is fetched, but nothing is
    // written until it lands: a half-resolved Zine is worse than the
    // build-time look for one more moment.
    expect(loader.calls).toBe(1);
    expect(runtimeStyle().textContent).toBe('');
    await act(async () => {
      loader.resolve();
    });
    expect(runtimeStyle().textContent).toContain('--callout-angle: -2.5deg;');
    expect(runtimeStyle().textContent).toContain('--density:');
    // A second theme write finds the remaps loaded and writes at once.
    act(() => {
      subscriptions.get('theme')({ preset: 'civic' });
    });
    expect(loader.calls).toBe(1);
    expect(runtimeStyle().textContent).not.toContain('--callout-angle: -2.5deg;');
  });
});
