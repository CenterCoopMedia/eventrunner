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
    return new Promise((resolve, reject) => {
      loader.resolve = () => {
        loader.loaded = true;
        resolve();
      };
      loader.reject = () => reject(new Error('chunk failed'));
    });
  }),
}));

import { EventConfigProvider } from './EventConfigContext.jsx';
import { theme as snapshotTheme } from '@generated/eventConfig.js';
import { resolveMotifSet } from 'shared/theme';

function runtimeStyle() {
  return document.getElementById('event-theme-runtime');
}

beforeEach(() => {
  subscriptions.clear();
  runtimeStyle()?.remove();
  loader.loaded = false;
  loader.resolve = null;
  loader.reject = null;
  loader.calls = 0;
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.motifSet;
  delete document.documentElement.dataset.texture;
  vi.useRealTimers();
});

/** A preset that is not the snapshot's, so a switch to it is visible. */
const OTHER_PRESET = snapshotTheme.preset === 'civic' ? 'zine' : 'civic';

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

  it('keeps the root attributes at the style last written whole until the remaps land', async () => {
    // data-theme picks the palette block, and the overlay carries the faces
    // and the component tokens. Flipping the attribute before the overlay is
    // written shows the new palette under the build style's faces — for a
    // moment, or for good when the chunk never lands (adversarial review,
    // 2026-09-24). Both move together, once the overlay is written whole.
    render(
      <EventConfigProvider>
        <p>The page</p>
      </EventConfigProvider>,
    );
    const root = document.documentElement;
    expect(root.dataset.theme).toBe(snapshotTheme.preset);
    act(() => {
      subscriptions.get('theme')({ preset: OTHER_PRESET });
    });
    expect(loader.calls).toBe(1);
    expect(root.dataset.theme).toBe(snapshotTheme.preset);
    expect(root.dataset.motifSet).toBe(resolveMotifSet(snapshotTheme));
    expect(runtimeStyle().textContent).toBe('');
    await act(async () => {
      loader.resolve();
    });
    expect(root.dataset.theme).toBe(OTHER_PRESET);
    expect(root.dataset.motifSet).toBe(resolveMotifSet({ preset: OTHER_PRESET }));
    expect(runtimeStyle().textContent).not.toBe('');
  });

  it('writes a document that names no style at once, because it needs no remaps', () => {
    render(
      <EventConfigProvider>
        <p>The page</p>
      </EventConfigProvider>,
    );
    act(() => {
      subscriptions.get('theme')({ radius: 'round' });
    });
    expect(loader.calls).toBe(0);
    expect(runtimeStyle().textContent).toContain('--radius-base: 16px;');
  });

  it('tries the load again after a failure, and applies the style when it lands', async () => {
    vi.useFakeTimers();
    render(
      <EventConfigProvider>
        <p>The page</p>
      </EventConfigProvider>,
    );
    act(() => {
      subscriptions.get('theme')({ preset: OTHER_PRESET });
    });
    expect(loader.calls).toBe(1);
    await act(async () => {
      loader.reject();
    });
    // The build-time look stays, and nothing is half-applied.
    expect(document.documentElement.dataset.theme).toBe(snapshotTheme.preset);
    expect(runtimeStyle().textContent).toBe('');
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    expect(loader.calls).toBe(2);
    await act(async () => {
      loader.resolve();
    });
    expect(document.documentElement.dataset.theme).toBe(OTHER_PRESET);
    expect(runtimeStyle().textContent).not.toBe('');
  });
});
