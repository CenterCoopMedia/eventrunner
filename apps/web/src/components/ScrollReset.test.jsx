// Where a route change puts the reader (M7 issue 6): the top of a new page,
// the element a fragment names — including one that does not exist yet —
// and the reader's own place when the move was never a forward navigation.
//
// jsdom has no layout, so window.scrollTo and Element.scrollIntoView are the
// seams: these assert what the shell ASKS the browser for, including that it
// never asks for an animation.
import { Suspense, lazy } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import ScrollReset, { FRAGMENT_WINDOW_MS } from './ScrollReset.jsx';

let scrollTo;
let scrollIntoView;
const originalScrollIntoView = Element.prototype.scrollIntoView;

beforeEach(() => {
  scrollTo = vi.fn();
  window.scrollTo = scrollTo;
  // jsdom implements no layout, so the element method does not exist at all.
  scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
  vi.useRealTimers();
});

const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true };

/**
 * The reset, the moves a reader can make from one page, and three fragment
 * targets that are present from the start: one that invites focus, one that
 * is a heading, and one that is neither.
 */
function renderAt(path) {
  const view = render(
    <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
      <ScrollReset />
      <Link to="/travel">Another page</Link>
      <Link to="/travel#rooms">Another page, at a heading</Link>
      <Link to="/travel#panel">Another page, at a focus target</Link>
      <Link to="/travel#wrapper">Another page, at a plain element</Link>
      <Link to="/travel#gone">Another page, at a fragment naming nothing</Link>
      <Link to="/travel#a%20room">Another page, at an encoded fragment</Link>
      <Link to="/faq#late">This page, at a fragment</Link>
      <Link to="/faq?q=parking">This page, filtered</Link>
      <h2 id="rooms">Rooms</h2>
      <section id="panel" tabIndex={-1}>
        Panel
      </section>
      <div id="wrapper">Wrapper</div>
      <div id="a room">Encoded</div>
    </MemoryRouter>,
  );
  // The mount itself resets; these tests are about what a NAVIGATION does.
  scrollTo.mockClear();
  scrollIntoView.mockClear();
  return view;
}

describe('ScrollReset, with no fragment', () => {
  it('starts a new page at the top', () => {
    renderAt('/faq');
    fireEvent.click(screen.getByText('Another page'));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' });
  });

  it('never asks for an animation, so there is none to switch off', () => {
    renderAt('/faq');
    fireEvent.click(screen.getByText('Another page'));
    expect(scrollTo.mock.calls[0][0].behavior).toBe('instant');
    expect(scrollTo.mock.calls[0][0].behavior).not.toBe('smooth');
  });
});

describe('ScrollReset, at a fragment that is already there', () => {
  it('takes the reader to the element the fragment names', () => {
    // React Router performs a client navigation, so nothing else in the
    // stack resolves the fragment — without this the reader would stay at
    // the previous page's offset.
    renderAt('/faq');
    fireEvent.click(screen.getByText('Another page, at a heading'));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.instances[0]).toBe(document.getElementById('rooms'));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'instant', block: 'start' });
    // ...and not to the top as well.
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('resolves a percent-encoded fragment against the id in the document', () => {
    renderAt('/faq');
    fireEvent.click(screen.getByText('Another page, at an encoded fragment'));
    expect(scrollIntoView.mock.instances[0]).toBe(document.getElementById('a room'));
  });

  it('moves focus to a target that already invites it', () => {
    renderAt('/faq');
    fireEvent.click(screen.getByText('Another page, at a focus target'));
    expect(document.activeElement).toBe(document.getElementById('panel'));
  });

  it('moves focus to a heading, which is a place a reader is meant to land', () => {
    renderAt('/faq');
    fireEvent.click(screen.getByText('Another page, at a heading'));
    const heading = document.getElementById('rooms');
    expect(document.activeElement).toBe(heading);
    // -1 keeps it out of the tab order, so accepting focus is all it gains.
    expect(heading).toHaveAttribute('tabindex', '-1');
  });

  it('leaves focus alone for a fragment naming an ordinary element', () => {
    const { container } = renderAt('/faq');
    const link = screen.getByText('Another page, at a plain element');
    link.focus();
    fireEvent.click(link);
    // Still on the link the reader used, not parked on a <div>.
    expect(document.activeElement).toBe(link);
    expect(container.querySelector('#wrapper')).not.toHaveAttribute('tabindex');
    // The scroll still happened; only the focus move was declined.
    expect(scrollIntoView.mock.instances[0]).toBe(document.getElementById('wrapper'));
  });
});

// THE CASE THE REAL APP ACTUALLY HAS. Every content route is React.lazy and
// ContentPage's `#section-<id>` anchors exist only after the chunk loads and
// the content renders, so a fragment target is normally ABSENT at the moment
// the navigation happens. A lookup done once, then, finds nothing.
describe('ScrollReset, at a fragment that has not rendered yet', () => {
  /** A route whose chunk resolves only when the test says so. */
  function lateRoute() {
    let resolveChunk;
    const chunk = new Promise((resolve) => {
      resolveChunk = () =>
        resolve({
          default: () => (
            <h2 id="section-rooms" tabIndex={-1}>
              Rooms
            </h2>
          ),
        });
    });
    return { Page: lazy(() => chunk), arrive: resolveChunk };
  }

  function renderLazyApp() {
    const { Page, arrive } = lateRoute();
    render(
      <MemoryRouter initialEntries={['/faq']} future={ROUTER_FUTURE}>
        <ScrollReset />
        <Link to="/travel#section-rooms">Travel, at a section</Link>
        <Link to="/faq">Back to the FAQ</Link>
        <Routes>
          <Route path="/faq" element={<p>FAQ</p>} />
          <Route
            path="/travel"
            element={
              <Suspense fallback={<p>Loading…</p>}>
                <Page />
              </Suspense>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    scrollTo.mockClear();
    scrollIntoView.mockClear();
    return { arrive };
  }

  it('waits for the target instead of calling it missing', async () => {
    const { arrive } = renderLazyApp();
    fireEvent.click(screen.getByText('Travel, at a section'));

    // The chunk has not resolved: the target does not exist, and the reader
    // has NOT been sent to the top on the strength of that.
    expect(document.getElementById('section-rooms')).toBeNull();
    expect(scrollTo).not.toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();

    await act(async () => {
      arrive();
    });
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(scrollIntoView.mock.instances[0]).toBe(document.getElementById('section-rooms'));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'instant', block: 'start' });
    // Never both: the reader is moved once for one navigation.
    expect(scrollTo).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.getElementById('section-rooms'));
  });

  it('gives up on the top after the window closes', () => {
    vi.useFakeTimers();
    renderLazyApp();
    fireEvent.click(screen.getByText('Travel, at a section'));
    expect(scrollTo).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(FRAGMENT_WINDOW_MS);
    });
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' });
  });

  it('stops waiting when the reader navigates again', () => {
    vi.useFakeTimers();
    renderLazyApp();
    fireEvent.click(screen.getByText('Travel, at a section'));
    // A second navigation, this one to another page with no fragment: it
    // resets to the top on its own account, and the abandoned wait must not
    // fire behind it and move the reader a second time.
    fireEvent.click(screen.getByText('Back to the FAQ'));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    scrollTo.mockClear();
    act(() => {
      vi.advanceTimersByTime(FRAGMENT_WINDOW_MS * 2);
    });
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('answers now on a host with no MutationObserver', () => {
    const original = globalThis.MutationObserver;
    delete globalThis.MutationObserver;
    try {
      renderLazyApp();
      fireEvent.click(screen.getByText('Travel, at a section'));
      expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' });
    } finally {
      globalThis.MutationObserver = original;
    }
  });
});

// BACK AND FORWARD ARE NOT NAVIGATIONS TO THE TOP. The browser restores the
// position the reader left, and this must not throw it away.
describe('ScrollReset, on a POP navigation', () => {
  function Stepper() {
    const navigate = useNavigate();
    return (
      <>
        <button type="button" onClick={() => navigate(-1)}>
          Back
        </button>
        <button type="button" onClick={() => navigate(1)}>
          Forward
        </button>
      </>
    );
  }

  function renderHistory(entries, index) {
    render(
      <MemoryRouter initialEntries={entries} initialIndex={index} future={ROUTER_FUTURE}>
        <ScrollReset />
        <Stepper />
        <Link to="/travel">Another page</Link>
        <h2 id="rooms">Rooms</h2>
      </MemoryRouter>,
    );
    scrollTo.mockClear();
    scrollIntoView.mockClear();
  }

  it('keeps the restored position when the reader goes back', () => {
    renderHistory(['/faq'], 0);
    fireEvent.click(screen.getByText('Another page'));
    expect(scrollTo).toHaveBeenCalledTimes(1);

    scrollTo.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('keeps the restored position when the reader goes forward again', () => {
    renderHistory(['/faq'], 0);
    fireEvent.click(screen.getByText('Another page'));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    scrollTo.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('still resolves a fragment the reader went back to', () => {
    // A URL that names a place names it whichever way the reader arrived,
    // and the browser has no fragment handling on a client POP either.
    renderHistory(['/travel#rooms', '/faq'], 1);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(scrollIntoView.mock.instances[0]).toBe(document.getElementById('rooms'));
  });
});

describe('ScrollReset, on a move within one page', () => {
  it('takes the reader to a fragment on the page they are already on', () => {
    // A hash-only move is still a navigation the router performs and the
    // browser does not resolve. Reacting to the pathname alone left the
    // reader where they were, which is the one thing the link did not ask
    // for.
    renderAt('/travel');
    fireEvent.click(screen.getByText('Another page, at a heading'));
    expect(scrollIntoView.mock.instances[0]).toBe(document.getElementById('rooms'));
    // ...and not to the top as well: the page under them has not changed.
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('keeps the reader’s place when the new fragment names nothing', () => {
    // The top reset belongs to arriving somewhere new. On the page the
    // reader is already reading there is nothing to reset.
    renderAt('/faq');
    fireEvent.click(screen.getByText('This page, at a fragment'));
    expect(scrollTo).not.toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('keeps the reader’s place when only the query string changes', () => {
    renderAt('/faq');
    fireEvent.click(screen.getByText('This page, filtered'));
    expect(scrollTo).not.toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('drops a fragment still waiting when the reader moves to another', () => {
    // The stale window was the bug: /travel#gone starts the three second
    // wait, a link to /travel#rooms takes the reader to Rooms, and the
    // timer that belonged to the abandoned fragment then yanked them to the
    // top of the page they were reading.
    vi.useFakeTimers();
    renderAt('/faq');
    fireEvent.click(screen.getByText('Another page, at a fragment naming nothing'));
    fireEvent.click(screen.getByText('Another page, at a heading'));
    expect(scrollIntoView.mock.instances[0]).toBe(document.getElementById('rooms'));
    act(() => {
      vi.advanceTimersByTime(FRAGMENT_WINDOW_MS * 2);
    });
    expect(scrollTo).not.toHaveBeenCalled();
  });
});

describe('ScrollReset itself', () => {
  it('renders nothing of its own', () => {
    const { container } = render(
      <MemoryRouter future={ROUTER_FUTURE}>
        <ScrollReset />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('stays up in a host with no scroller at all', () => {
    delete window.scrollTo;
    expect(() =>
      render(
        <MemoryRouter future={ROUTER_FUTURE}>
          <ScrollReset />
        </MemoryRouter>,
      ),
    ).not.toThrow();
  });
});
