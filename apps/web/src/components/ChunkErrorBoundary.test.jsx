// A stale entry bundle asking for a replaced admin chunk must not blank the
// page: one automatic reload, then a retry panel (App.jsx lazy boundary).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ChunkErrorBoundary from './ChunkErrorBoundary.jsx';
import {
  RELOAD_FLAG,
  clearReloadFlag,
  hasReloaded,
  installChunkReload,
  isChunkLoadError,
  reloadOnce,
} from '../lib/chunkReload.js';

function Boom({ error }) {
  throw error;
}

let consoleError;

beforeEach(() => {
  sessionStorage.clear();
  // React logs every error a boundary catches; the test asserts on the
  // rendered fallback instead, so the noise is not useful here.
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
  vi.restoreAllMocks();
});

describe('isChunkLoadError', () => {
  it('recognizes the browsers wordings for a missing module', () => {
    expect(isChunkLoadError(new Error('Failed to fetch dynamically imported module: /assets/admin-a1b2.js'))).toBe(true);
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('Loading chunk 42 failed.'))).toBe(true);
    expect(isChunkLoadError(Object.assign(new Error('nope'), { name: 'ChunkLoadError' }))).toBe(true);
  });

  it('does not claim an ordinary application error', () => {
    expect(isChunkLoadError(new Error('permission-denied'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});

describe('reloadOnce', () => {
  it('reloads once and then refuses, so a broken deploy cannot loop', () => {
    const reload = vi.fn();
    expect(reloadOnce({ storage: sessionStorage, reload })).toBe(true);
    expect(reloadOnce({ storage: sessionStorage, reload })).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(RELOAD_FLAG)).toBe('1');
  });

  it('refuses when there is nowhere to record the attempt', () => {
    const reload = vi.fn();
    expect(reloadOnce({ storage: null, reload })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('re-arms after a chunk finally loads', () => {
    reloadOnce({ storage: sessionStorage, reload: () => {} });
    expect(hasReloaded(sessionStorage)).toBe(true);
    clearReloadFlag(sessionStorage);
    expect(hasReloaded(sessionStorage)).toBe(false);
  });
});

describe('installChunkReload', () => {
  it('swallows a preload error only when a reload is actually starting', () => {
    const target = new EventTarget();
    const reload = vi.fn();
    const remove = installChunkReload(target, { reload });

    const first = new Event('vite:preloadError', { cancelable: true });
    target.dispatchEvent(first);
    expect(first.defaultPrevented).toBe(true);

    const second = new Event('vite:preloadError', { cancelable: true });
    target.dispatchEvent(second);
    expect(second.defaultPrevented).toBe(false);

    expect(reload).toHaveBeenCalledTimes(1);
    remove();
  });
});

describe('ChunkErrorBoundary', () => {
  it('renders its children when nothing fails', () => {
    render(<ChunkErrorBoundary><p>admin</p></ChunkErrorBoundary>);
    expect(screen.getByText('admin')).toBeTruthy();
  });

  it('reloads once on a missing chunk instead of leaving a blank page', () => {
    const reload = vi.fn();
    render(
      <ChunkErrorBoundary reload={reload}>
        <Boom error={new Error('Failed to fetch dynamically imported module: /assets/admin-a1b2.js')} />
      </ChunkErrorBoundary>,
    );

    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Reload the page' })).toBeTruthy();
  });

  it('offers a retry rather than reloading again when the reload did not help', () => {
    sessionStorage.setItem(RELOAD_FLAG, '1');
    const reload = vi.fn();
    render(
      <ChunkErrorBoundary reload={reload}>
        <Boom error={new Error('Failed to fetch dynamically imported module: /assets/admin-a1b2.js')} />
      </ChunkErrorBoundary>,
    );

    expect(reload).not.toHaveBeenCalled();
    screen.getByRole('button', { name: 'Reload the page' }).click();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload for an error a reload cannot fix', () => {
    const reload = vi.fn();
    render(
      <ChunkErrorBoundary reload={reload}>
        <Boom error={new Error('permission-denied')} />
      </ChunkErrorBoundary>,
    );

    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByText('This part of the site did not load')).toBeTruthy();
  });
});
