// Back to top (M7 issue 6): when it is offered, when it withdraws, where it
// puts focus, and that it does none of it with an animation.
//
// jsdom has no layout and no IntersectionObserver, so scrollY, scrollTo and
// the observer are the seams — these assert what the control reads and what
// it asks the browser for.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import BackToTop from './BackToTop.jsx';
import { FOCUS_RING_ATTRIBUTE } from '../lib/scrollToTop.js';

let scrollTo;
/** The observers the control constructed, newest last. */
let observed;

/** Put the reader at a scroll offset and tell the page about it. */
function scrollTop(y) {
  window.scrollY = y;
  fireEvent.scroll(window);
}

/** Report whether the observed footer is on screen. */
function footerOnScreen(isIntersecting) {
  act(() => {
    for (const observer of observed) observer.callback([{ isIntersecting }]);
  });
}

/** jsdom ships no IntersectionObserver; install one that records itself. */
function installObserver() {
  observed = [];
  globalThis.IntersectionObserver = class {
    constructor(callback) {
      this.callback = callback;
      observed.push(this);
    }

    observe(target) {
      this.target = target;
    }

    disconnect() {
      this.disconnected = true;
    }
  };
}

beforeEach(() => {
  scrollTo = vi.fn();
  window.scrollTo = scrollTo;
  window.scrollY = 0;
  window.innerHeight = 800;
  installObserver();
  const footer = document.createElement('footer');
  footer.id = 'site-footer';
  document.body.append(footer);
});

afterEach(() => {
  document.getElementById('site-footer')?.remove();
  document.getElementById('banner')?.remove();
  document.querySelector('main')?.remove();
  delete globalThis.IntersectionObserver;
});

/** The shell's banner: what focus lands on (Layout.jsx owns the real one). */
function withBanner() {
  const banner = document.createElement('header');
  banner.id = 'banner';
  banner.tabIndex = -1;
  document.body.append(banner);
  return banner;
}

const control = () => screen.queryByRole('button', { name: 'Back to top' });

function renderControl() {
  return render(<BackToTop targetId="banner" footerId="site-footer" />);
}

describe('BackToTop, when it is offered', () => {
  it('offers nothing until the reader is a screen down', () => {
    renderControl();
    expect(control()).toBeNull();

    scrollTop(400);
    expect(control()).toBeNull();

    scrollTop(1200);
    expect(control()).not.toBeNull();
  });

  it('is offered straight away to a reader who arrives already scrolled', () => {
    // A reload, or a back button that restored the position: there is no
    // scroll event to wait for.
    window.scrollY = 2000;
    renderControl();
    expect(control()).not.toBeNull();
  });

  it('goes away again when the reader returns to the top', () => {
    window.scrollY = 2000;
    renderControl();
    scrollTop(0);
    expect(control()).toBeNull();
  });
});

describe('BackToTop, over the footer', () => {
  it('withdraws while the footer is on screen, so it covers no footer link', () => {
    window.scrollY = 2000;
    renderControl();
    expect(control()).not.toBeNull();

    footerOnScreen(true);
    expect(control()).toBeNull();
  });

  it('comes back when the reader scrolls up off the footer', () => {
    window.scrollY = 2000;
    renderControl();
    footerOnScreen(true);
    footerOnScreen(false);
    expect(control()).not.toBeNull();
  });

  it('watches the footer the shell named', () => {
    window.scrollY = 2000;
    renderControl();
    expect(observed).toHaveLength(1);
    expect(observed[0].target).toBe(document.getElementById('site-footer'));
  });

  it('keeps the control on a host with no IntersectionObserver', () => {
    // Same rule as SectionIndexNav: the observer is a refinement, and its
    // absence means the refinement does not happen, not that the control
    // disappears.
    delete globalThis.IntersectionObserver;
    window.scrollY = 2000;
    renderControl();
    expect(control()).not.toBeNull();
  });

  it('does not observe when the named footer is not in the document', () => {
    document.getElementById('site-footer').remove();
    window.scrollY = 2000;
    renderControl();
    expect(observed).toHaveLength(0);
    expect(control()).not.toBeNull();
  });
});

describe('BackToTop, what it does', () => {
  it('is a real button on the keyboard path, with its errand in words', () => {
    window.scrollY = 2000;
    renderControl();
    const button = control();
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('type', 'button');
    // Nothing overrides the native tab order, and the label is visible text
    // rather than an aria-label standing in for an icon.
    expect(button.hasAttribute('tabindex')).toBe(false);
    expect(button.hasAttribute('aria-label')).toBe(false);
    expect(button.textContent).toBe('Back to top');
    // The hit area is the site's own touch target.
    expect(button.className).toContain('touch-target');
  });

  it('jumps to the top without animating, in any motion setting', () => {
    window.scrollY = 2000;
    renderControl();
    fireEvent.click(control());
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' });
    expect(scrollTo.mock.calls[0][0].behavior).not.toBe('smooth');
  });

  it('moves focus to the top of the page, not just the picture', () => {
    const banner = withBanner();
    window.scrollY = 2000;
    renderControl();
    fireEvent.click(control());
    expect(document.activeElement).toBe(banner);
  });

  it('marks where it put focus, so the ring is drawn however the reader got there', () => {
    const banner = withBanner();
    window.scrollY = 2000;
    renderControl();
    fireEvent.click(control());
    expect(banner).toHaveAttribute(FOCUS_RING_ATTRIBUTE);

    // ...and stops marking it the moment focus leaves, so the outline is
    // never left behind on a landmark nobody is in.
    fireEvent.blur(banner);
    expect(banner).not.toHaveAttribute(FOCUS_RING_ATTRIBUTE);
  });
});

describe('BackToTop, when the named banner is not there', () => {
  it('falls back to the main landmark rather than dropping focus on the body', () => {
    // This control unmounts the moment it is used, so focus left where it
    // was would fall to <body> and the next Tab would start over.
    const main = document.createElement('main');
    document.body.append(main);
    window.scrollY = 2000;
    render(<BackToTop targetId="nothing-here" footerId="site-footer" />);
    fireEvent.click(control());
    expect(document.activeElement).toBe(main);
    expect(main).toHaveAttribute('tabindex', '-1');
  });

  it('falls back to the first thing a reader could tab to', () => {
    const link = document.createElement('a');
    link.href = '#main-content';
    document.body.prepend(link);
    window.scrollY = 2000;
    render(<BackToTop targetId="nothing-here" footerId="site-footer" />);
    fireEvent.click(control());
    expect(document.activeElement).toBe(link);
    link.remove();
  });

  it('still jumps when there is nothing to focus at all', () => {
    window.scrollY = 2000;
    render(<BackToTop targetId="nothing-here" footerId="site-footer" />);
    expect(() => fireEvent.click(control())).not.toThrow();
    expect(scrollTo).toHaveBeenCalled();
  });
});

describe('BackToTop, when it leaves the page', () => {
  it('removes the very listeners it added', () => {
    // Spies that call through: replacing window's listener registration
    // outright would take React's own scheduling with it.
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    try {
      const { unmount } = renderControl();
      const listened = add.mock.calls
        .filter(([type]) => type === 'scroll' || type === 'resize')
        .map(([type, handler]) => ({ type, handler }));
      expect(listened.map((entry) => entry.type).sort()).toEqual(['resize', 'scroll']);

      unmount();

      const dropped = remove.mock.calls.map(([type, handler]) => ({ type, handler }));
      // The SAME function objects, not merely a call with some function: a
      // listener removed by identity is the only one actually removed.
      for (const entry of listened) {
        expect(dropped).toContainEqual(entry);
      }
    } finally {
      add.mockRestore();
      remove.mockRestore();
    }
  });

  it('disconnects the footer observer', () => {
    const { unmount } = renderControl();
    unmount();
    expect(observed[0].disconnected).toBe(true);
  });
});
