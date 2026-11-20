// A stale entry bundle asking for a replaced admin chunk must not blank the
// page: one automatic reload, then a retry panel (App.jsx lazy boundary).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router';
import { Suspense, lazy, useEffect, useState } from 'react';
import ErrorBoundary from './ErrorBoundary.jsx';
import { lazyPage } from '../lib/routePage.jsx';
import { resetErrorReportingStateForTest } from '../lib/errorReporting.js';
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

const safariMissingLazyModuleMessage = "undefined is not an object (evaluating 'e._result.default')";
const chromeDefaultPropertyMessage = "Cannot read properties of undefined (reading 'default')";

const firefoxMissingLazyModuleMessage = 'can\'t access property "default", e is undefined';

// A React.lazy whose module read throws `message`, as a stale build's absent
// module does in each browser: the boundary sees React's own Lazy frame
// under Suspense.
function LazyMissingModule({ message }) {
  const Missing = lazy(() => Promise.resolve({ get default() { throw new TypeError(message); } }));
  return <Suspense fallback={<p>Loading</p>}><Missing /></Suspense>;
}

function renderBoundary(children, props = {}) {
  return render(<MemoryRouter><ErrorBoundary {...props}>{children}</ErrorBoundary></MemoryRouter>);
}

function captureReports() {
  resetErrorReportingStateForTest();
  vi.stubEnv('VITE_ENABLE_CLIENT_ERROR_REPORTING', 'true');
  vi.stubEnv('VITE_FUNCTIONS_ORIGIN', 'https://telemetry.example.test');
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  return fetch;
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
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
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
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'title')"))).toBe(false);
    expect(isChunkLoadError(new TypeError("undefined is not an object (evaluating 'event.default')"))).toBe(false);
    expect(isChunkLoadError(new TypeError(chromeDefaultPropertyMessage))).toBe(false);
    expect(isChunkLoadError(new Error(safariMissingLazyModuleMessage))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });

  it('recognizes the React-specific Safari missing-module signal', () => {
    expect(isChunkLoadError(new TypeError(safariMissingLazyModuleMessage))).toBe(true);
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
    first.payload = new TypeError('Importing a module script failed.');
    target.dispatchEvent(first);
    expect(first.defaultPrevented).toBe(true);

    const second = new Event('vite:preloadError', { cancelable: true });
    second.payload = first.payload;
    target.dispatchEvent(second);
    expect(second.defaultPrevented).toBe(false);

    expect(reload).toHaveBeenCalledTimes(1);
    remove();
  });
});

describe('ErrorBoundary', () => {
  it('does not report when Vite has started a recovery reload', async () => {
    const fetch = captureReports();
    const reload = vi.fn();
    const remove = installChunkReload(window, { reload });
    // Safari's stack contains frames without the error name, so the benign
    // filter cannot identify the synthetic missing-module error by its stack.
    const stack = vi.spyOn(Error, 'prepareStackTrace').mockImplementation(
      (_error, frames) => frames.map(String).join('\n'),
    );
    const Page = lazyPage(async () => {
      const error = new TypeError('Importing a module script failed.');
      const event = new Event('vite:preloadError', { cancelable: true });
      event.payload = error;
      if (window.dispatchEvent(event)) throw error;
    }, 'AdminOverview');
    try {
      renderBoundary(<Suspense fallback={null}><Page /></Suspense>, { reload });
      expect(await screen.findByRole('alert')).toHaveTextContent('A page file did not load.');
      expect(reload).toHaveBeenCalledTimes(1);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      remove();
      stack.mockRestore();
    }
  });

  it('reports the page chunk and both builds when Safari omits the asset URL after reload', async () => {
    const fetch = captureReports();
    const entry = document.createElement('link');
    entry.setAttribute('data-app-entry', '');
    entry.href = '/assets/index-new1.js';
    document.head.append(entry);
    sessionStorage.setItem(RELOAD_FLAG, 'index-old2.js');
    const reload = vi.fn();
    const Page = lazyPage(() => Promise.reject(new TypeError('Importing a module script failed.')), 'AdminOverview');
    try {
      renderBoundary(<Suspense fallback={null}><Page /></Suspense>, { reload });
      expect(await screen.findByRole('alert')).toHaveTextContent('A page file did not load.');
      expect(reload).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(JSON.parse(fetch.mock.calls[0][1].body).message).toBe(
        'A page file still failed to load after automatic reload. File AdminOverview. Previous build index-old2.js. Current build index-new1.js.',
      );
    } finally {
      entry.remove();
    }
  });

  it('reports the original application error when a lazy module throws during evaluation', async () => {
    const fetch = captureReports();
    const reload = vi.fn();
    const remove = installChunkReload(window, { reload });
    const Page = lazyPage(async () => {
      const error = new ReferenceError('A required feature is undefined');
      const event = new Event('vite:preloadError', { cancelable: true });
      event.payload = error;
      if (window.dispatchEvent(event)) throw error;
    }, 'AdminOverview');
    try {
      renderBoundary(<Suspense fallback={null}><Page /></Suspense>, { reload });
      expect(await screen.findByRole('alert')).toHaveTextContent('Reload the page to try again.');
      expect(reload).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
        message: 'A required feature is undefined',
        stack: expect.stringContaining('ReferenceError: A required feature is undefined'),
      });
    } finally {
      remove();
    }
  });

  it('renders its children when nothing fails', () => {
    renderBoundary(<p>admin</p>);
    expect(screen.getByText('admin')).toBeTruthy();
  });

  it('reloads once on a missing chunk instead of leaving a blank page', () => {
    const reload = vi.fn();
    renderBoundary(<Boom error={new Error('Failed to fetch dynamically imported module: /assets/admin-a1b2.js')} />, { reload });

    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Reload the page' })).toBeTruthy();
  });

  it('recovers once from the Safari missing-module signal', () => {
    const reload = vi.fn();
    const { unmount } = renderBoundary(<Boom error={new TypeError(safariMissingLazyModuleMessage)} />, { reload });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(RELOAD_FLAG)).toBe('1');
    unmount();

    renderBoundary(<Boom error={new TypeError(safariMissingLazyModuleMessage)} />, { reload });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent('A page file did not load.');
    expect(screen.getByRole('button', { name: 'Reload the page' })).toBeTruthy();
  });

  it('does not reload for an ordinary Chrome default-property render error', () => {
    const reload = vi.fn();
    renderBoundary(<Boom error={new TypeError(chromeDefaultPropertyMessage)} />, { reload });
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Reload the page to try again.');
  });

  it.each([
    ['Chrome', chromeDefaultPropertyMessage],
    ['Firefox', firefoxMissingLazyModuleMessage],
    ['Safari', safariMissingLazyModuleMessage],
  ])('reloads once when a lazy module is missing in %s (issue 1024)', async (_browser, message) => {
    const reload = vi.fn();
    const first = renderBoundary(<LazyMissingModule message={message} />, { reload });
    expect(await screen.findByRole('alert')).toHaveTextContent('A page file did not load.');
    expect(reload).toHaveBeenCalledTimes(1);
    first.unmount();

    renderBoundary(<LazyMissingModule message={message} />, { reload });
    expect(await screen.findByRole('alert')).toHaveTextContent('A page file did not load.');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload for the Firefox default-property wording outside a lazy module', () => {
    const reload = vi.fn();
    renderBoundary(<Suspense fallback={null}><Boom error={new TypeError(firefoxMissingLazyModuleMessage)} /></Suspense>, { reload });
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Reload the page to try again.');
  });

  it('offers a retry rather than reloading again when the reload did not help', () => {
    sessionStorage.setItem(RELOAD_FLAG, '1');
    const reload = vi.fn();
    renderBoundary(<Boom error={new Error('Failed to fetch dynamically imported module: /assets/admin-a1b2.js')} />, { reload });

    expect(reload).not.toHaveBeenCalled();
    screen.getByRole('button', { name: 'Reload the page' }).click();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload for an error a reload cannot fix', () => {
    const reload = vi.fn();
    renderBoundary(<Boom error={new Error('permission-denied')} />, { reload });

    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByText('This page could not be shown')).toBeTruthy();
  });

  it('clears a failed route on navigation while the surrounding navigation stays usable', () => {
    render(
      <MemoryRouter initialEntries={['/broken']}>
        <Link to="/working">Working page</Link>
        <ErrorBoundary>
          <Routes>
            <Route path="/broken" element={<Boom error={new Error('render failed')} />} />
            <Route path="/working" element={<h1>Working page content</h1>} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('This page could not be shown');
    fireEvent.click(screen.getByRole('link', { name: 'Working page' }));
    expect(screen.getByRole('heading', { name: 'Working page content' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps a healthy stepper mounted with its answers across step navigation', () => {
    const mounted = vi.fn();
    function Stepper() {
      const [answer, setAnswer] = useState('');
      useEffect(() => { mounted(); }, [mounted]);
      return <input aria-label="Answer" value={answer} onChange={(event) => setAnswer(event.target.value)} />;
    }
    render(
      <MemoryRouter initialEntries={['/steps/first']}>
        <Link to="/steps/second">Next step</Link>
        <ErrorBoundary>
          <Routes><Route path="/steps/:step" element={<Stepper />} /></Routes>
        </ErrorBoundary>
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Answer' }), { target: { value: 'Keep my answer' } });
    fireEvent.click(screen.getByRole('link', { name: 'Next step' }));
    expect(screen.getByRole('textbox', { name: 'Answer' })).toHaveValue('Keep my answer');
    expect(mounted).toHaveBeenCalledTimes(1);
  });

  it('uses admin tokens for the admin panel and a form-specific line for a modal', () => {
    const { unmount } = renderBoundary(<Boom error={new Error('render failed')} />, {
      appearance: 'admin', title: 'This admin page could not be shown',
    });
    const panel = screen.getByRole('alert');
    expect(panel).toHaveClass('admin-room');
    expect(panel.querySelector('[class*="text-body"], [class*="font-heading"], [class*="bg-accent"]')).toBeNull();
    unmount();
    renderBoundary(<Boom error={new Error('render failed')} />, {
      appearance: 'inline', title: 'The feedback form could not open', description: 'Reload to try again.',
    });
    expect(screen.getByRole('alert')).toHaveTextContent('The feedback form could not open. Reload to try again.');
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });
});
