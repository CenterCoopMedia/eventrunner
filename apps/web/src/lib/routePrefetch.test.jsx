import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import { installRoutePrefetch, HOVER_DWELL_MS } from './routePrefetch.js';
import { isRoutePrefetchPending, routePage } from './routePage.jsx';
import { installChunkReload, RELOAD_FLAG } from './chunkReload.js';
import ChunkErrorBoundary from '../components/ChunkErrorBoundary.jsx';
import { prefetchPath } from '../routes.jsx';

let removeListeners;
let restoreReload;
let imports;
let page;

beforeEach(() => {
  vi.useFakeTimers();
  imports = 0;
  page = routePage(() => {
    imports += 1;
    return import('../test/fixtures/PrefetchedRoute.jsx');
  });
  sessionStorage.setItem(RELOAD_FLAG, '1');
});

afterEach(() => {
  removeListeners?.();
  restoreReload?.();
  vi.useRealTimers();
  delete navigator.connection;
  sessionStorage.clear();
});

function setup({ hashRouter = false, href = '/schedule' } = {}) {
  const root = document.createElement('div');
  const link = document.createElement('a');
  link.href = href;
  link.innerHTML = '<span>Schedule</span>';
  root.appendChild(link);
  const routes = [
    { path: '/', page: null },
    { path: '/schedule', page },
    { path: '/schedule/mine', page: null },
    { path: '/schedule/:sessionId', page },
    { path: '*', page: null },
  ];
  removeListeners = installRoutePrefetch(root, (path) => prefetchPath(path, routes), { hashRouter });
  return { root, link, target: link.firstChild };
}

function pointer(target, type, pointerType, relatedTarget = null) {
  const event = new Event(type, { bubbles: true });
  Object.assign(event, { pointerType, relatedTarget });
  target.dispatchEvent(event);
}

describe('route intent', () => {
  it('imports nothing on installation or a fast sweep, then imports once after mouse dwell', async () => {
    const { target } = setup();
    await vi.advanceTimersByTimeAsync(500);
    expect(imports).toBe(0);
    pointer(target, 'pointerover', 'mouse');
    await vi.advanceTimersByTimeAsync(HOVER_DWELL_MS - 1);
    pointer(target, 'pointerout', 'mouse');
    await vi.advanceTimersByTimeAsync(500);
    expect(imports).toBe(0);
    pointer(target, 'pointerover', 'mouse');
    await vi.advanceTimersByTimeAsync(HOVER_DWELL_MS);
    await page.prefetch();
    fireEvent.focusIn(target);
    pointer(target, 'pointerdown', 'touch');
    expect(imports).toBe(1);
    expect(sessionStorage.getItem(RELOAD_FLAG)).toBe('1');
  });

  it.each(['keyboard', 'touch'])('imports on %s intent without a dwell', async (input) => {
    const { target } = setup();
    if (input === 'keyboard') fireEvent.focusIn(target);
    else pointer(target, 'pointerdown', 'touch');
    expect(imports).toBe(1);
  });

  it('does not start a hover timer for touch movement and cancels pending dwell on teardown', async () => {
    const { target } = setup();
    pointer(target, 'pointerover', 'touch');
    await vi.advanceTimersByTimeAsync(500);
    expect(imports).toBe(0);
    pointer(target, 'pointerover', 'mouse');
    removeListeners();
    await vi.advanceTimersByTimeAsync(500);
    expect(imports).toBe(0);
  });

  it.each([{ saveData: true }, { effectiveType: '2g' }, { effectiveType: 'slow-2g' }])('skips constrained connections: %j', async (connection) => {
    navigator.connection = connection;
    const { target } = setup();
    fireEvent.focusIn(target);
    pointer(target, 'pointerdown', 'touch');
    pointer(target, 'pointerover', 'mouse');
    await vi.advanceTimersByTimeAsync(500);
    expect(imports).toBe(0);
  });

  it.each(['/schedule/mine', 'https://example.org/schedule', '/unknown'])('uses router ranking and ignores other destinations: %s', (href) => {
    const { target } = setup({ href });
    fireEvent.focusIn(target);
    expect(imports).toBe(0);
  });

  it.each(['/schedule/session-1', '/schedule?day=friday#morning'])('matches route parameters and ignores search or fragment: %s', (href) => {
    const { target } = setup({ href });
    fireEvent.focusIn(target);
    expect(imports).toBe(1);
  });

  it('matches demo hash routes, including search and an in-page fragment', () => {
    const { target } = setup({ hashRouter: true, href: `${location.pathname}#/schedule?day=friday#morning` });
    fireEvent.focusIn(target);
    expect(imports).toBe(1);
  });

  it.each(['_blank', 'download'])('leaves %s links alone', (attribute) => {
    const { link, target } = setup();
    if (attribute === 'download') link.download = '';
    else link.target = attribute;
    fireEvent.focusIn(target);
    expect(imports).toBe(0);
  });
});

describe('route import lifecycle', () => {
  it('preserves a spent reload budget when only the route table has loaded', async () => {
    const neverLoads = new Promise(() => {});
    function PendingPage() { throw neverLoads; }
    function RouteTable() {
      return <Suspense fallback={<p>Loading final page</p>}><PendingPage /></Suspense>;
    }
    const table = routePage(() => Promise.resolve({ default: RouteTable }), { resetReloadBudget: false });
    await table.prefetch();
    render(<table.Component />);
    expect(screen.getByText('Loading final page')).toBeInTheDocument();
    expect(sessionStorage.getItem(RELOAD_FLAG)).toBe('1');
  });

  it('retains real navigation recovery while another speculative import is pending', async () => {
    sessionStorage.removeItem(RELOAD_FLAG);
    let finish;
    const speculativePage = routePage(() => new Promise((resolve) => { finish = resolve; }));
    const speculation = speculativePage.prefetch();
    const reload = vi.fn();
    restoreReload = installChunkReload(window, { reload, isPrefetching: isRoutePrefetchPending });
    const navigation = routePage(() => Promise.resolve().then(() => {
      const error = new Error('Failed to fetch dynamically imported module: /assets/navigation.js');
      const event = new Event('vite:preloadError', { cancelable: true });
      event.payload = error;
      window.dispatchEvent(event);
      if (!event.defaultPrevented) throw error;
    }));
    const quietExpectedError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await act(async () => {
        render(<ChunkErrorBoundary reload={reload}><Suspense fallback={<p>Loading route</p>}><navigation.Component /></Suspense></ChunkErrorBoundary>);
      });
      expect(reload).toHaveBeenCalledTimes(1);
      expect(sessionStorage.getItem(RELOAD_FLAG)).toBe('1');
    } finally {
      finish(await import('../test/fixtures/PrefetchedRoute.jsx'));
      await speculation;
      quietExpectedError.mockRestore();
    }
  });

  it('renders a prefetched module synchronously and clears the reload budget only on mount', async () => {
    await page.prefetch();
    expect(sessionStorage.getItem(RELOAD_FLAG)).toBe('1');
    render(<Suspense fallback={<p>Loading route</p>}><page.Component /></Suspense>);
    expect(screen.getByText('Prefetched route')).toBeInTheDocument();
    expect(screen.queryByText('Loading route')).toBeNull();
    expect(sessionStorage.getItem(RELOAD_FLAG)).toBeNull();
    expect(imports).toBe(1);
  });

  it('shares a pending speculative import with navigation', async () => {
    let finish;
    const pendingPage = routePage(() => {
      imports += 1;
      return new Promise((resolve) => { finish = resolve; });
    });
    const prefetched = pendingPage.prefetch();
    render(<Suspense fallback={<p>Loading route</p>}><pendingPage.Component /></Suspense>);
    expect(imports).toBe(1);
    await act(async () => {
      finish(await import('../test/fixtures/PrefetchedRoute.jsx'));
      await prefetched;
    });
    expect(screen.getByText('Prefetched route')).toBeInTheDocument();
  });

  it.each([null, '1'])('leaves a failed prefetch silent with reload flag %s and keeps it retryable', async (flag) => {
    if (flag === null) sessionStorage.removeItem(RELOAD_FLAG);
    const reload = vi.fn();
    const failure = new Error('Failed to fetch dynamically imported module: /assets/route.js');
    let event;
    const failingPage = routePage(() => {
      imports += 1;
      if (imports > 1) return import('../test/fixtures/PrefetchedRoute.jsx');
      return Promise.resolve().then(() => {
        event = new Event('vite:preloadError', { cancelable: true });
        event.payload = failure;
        window.dispatchEvent(event);
        // Vite throws the payload unless a handler prevented it.
        if (!event.defaultPrevented) throw failure;
      });
    });
    restoreReload = installChunkReload(window, { reload, isPrefetching: isRoutePrefetchPending });
    await failingPage.prefetch();
    expect(event.defaultPrevented).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(RELOAD_FLAG)).toBe(flag);
    expect(isRoutePrefetchPending()).toBe(false);
    await act(async () => {
      render(<Suspense fallback={<p>Loading route</p>}><failingPage.Component /></Suspense>);
    });
    expect(screen.getByText('Prefetched route')).toBeInTheDocument();
    expect(imports).toBe(2);
  });
});
