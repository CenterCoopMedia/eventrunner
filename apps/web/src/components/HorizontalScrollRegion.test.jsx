import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HorizontalScrollRegion, { hasHorizontalOverflow } from './HorizontalScrollRegion.jsx';

let resizeObservers;
let mutationObservers;
let originalResizeObserver;
let originalMutationObserver;

class ResizeObserverDouble {
  constructor(callback) {
    this.callback = callback;
    this.observe = vi.fn();
    this.disconnect = vi.fn();
    resizeObservers.push(this);
  }
}

class MutationObserverDouble {
  constructor(callback) {
    this.callback = callback;
    this.observe = vi.fn();
    this.disconnect = vi.fn();
    mutationObservers.push(this);
  }
}

function setWidths(node, { client, scroll }) {
  Object.defineProperty(node, 'clientWidth', { configurable: true, value: client });
  Object.defineProperty(node, 'scrollWidth', { configurable: true, value: scroll });
}

beforeEach(() => {
  resizeObservers = [];
  mutationObservers = [];
  originalResizeObserver = globalThis.ResizeObserver;
  originalMutationObserver = globalThis.MutationObserver;
  globalThis.ResizeObserver = ResizeObserverDouble;
  globalThis.MutationObserver = MutationObserverDouble;
});

afterEach(() => {
  globalThis.ResizeObserver = originalResizeObserver;
  globalThis.MutationObserver = originalMutationObserver;
});

describe('HorizontalScrollRegion', () => {
  it('adds and removes region semantics as measured overflow changes', () => {
    const { container, unmount } = render(
      <HorizontalScrollRegion label="Day one schedule grid">
        <div>Programme</div>
      </HorizontalScrollRegion>,
    );
    const region = container.firstElementChild;
    setWidths(region, { client: 320, scroll: 320 });
    act(() => resizeObservers[0].callback([]));
    expect(region).not.toHaveAttribute('tabindex');
    expect(region).not.toHaveAttribute('role');
    expect(region).not.toHaveAttribute('aria-label');

    setWidths(region, { client: 320, scroll: 640 });
    act(() => resizeObservers[0].callback([]));
    expect(region).toHaveAttribute('tabindex', '0');
    expect(region).toHaveAttribute('role', 'region');
    expect(region).toHaveAccessibleName('Day one schedule grid');

    setWidths(region, { client: 640, scroll: 640 });
    act(() => mutationObservers[0].callback([]));
    expect(region).not.toHaveAttribute('tabindex');
    expect(region).not.toHaveAttribute('role');

    unmount();
    expect(resizeObservers[0].disconnect).toHaveBeenCalledOnce();
    expect(mutationObservers[0].disconnect).toHaveBeenCalledOnce();
  });

  it('uses the window resize fallback when ResizeObserver is unavailable', () => {
    globalThis.ResizeObserver = undefined;
    const { container } = render(
      <HorizontalScrollRegion label="Wide table">
        <table><tbody><tr><td>Value</td></tr></tbody></table>
      </HorizontalScrollRegion>,
    );
    const region = container.firstElementChild;
    setWidths(region, { client: 200, scroll: 400 });
    act(() => window.dispatchEvent(new Event('resize')));
    expect(region).toHaveAttribute('tabindex', '0');
    expect(region).toHaveAccessibleName('Wide table');
  });

  it('uses strict width comparison', () => {
    expect(hasHorizontalOverflow({ clientWidth: 200, scrollWidth: 200 })).toBe(false);
    expect(hasHorizontalOverflow({ clientWidth: 200, scrollWidth: 201 })).toBe(true);
  });
});
