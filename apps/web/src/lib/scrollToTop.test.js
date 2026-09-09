import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FOCUS_RING_ATTRIBUTE,
  focusAsDestination,
  scrollToElement,
  scrollToTop,
} from './scrollToTop.js';

const originalScrollTo = window.scrollTo;

afterEach(() => {
  window.scrollTo = originalScrollTo;
});

describe('scrollToTop', () => {
  it('asks for the top with no animation', () => {
    const scrollTo = vi.fn();
    window.scrollTo = scrollTo;
    scrollToTop();
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' });
  });

  it('falls back for an engine that does not know the instant behavior', () => {
    // An unknown ScrollBehavior is a TypeError, and an exception thrown from
    // an effect would take the page down over a scroll position.
    const scrollTo = vi.fn((options) => {
      if (typeof options === 'object') throw new TypeError('bad enum value');
    });
    window.scrollTo = scrollTo;
    expect(() => scrollToTop()).not.toThrow();
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0);
  });

  it('does nothing on a host with no scroller', () => {
    delete window.scrollTo;
    expect(() => scrollToTop()).not.toThrow();
  });
});

describe('scrollToElement', () => {
  it('puts the element’s own top edge at the top, with no animation', () => {
    const element = { scrollIntoView: vi.fn() };
    scrollToElement(element);
    expect(element.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'instant',
      block: 'start',
    });
  });

  it('falls back to the pre-options signature, which also aligns to the top', () => {
    const element = {
      scrollIntoView: vi.fn((options) => {
        if (typeof options === 'object') throw new TypeError('bad enum value');
      }),
    };
    expect(() => scrollToElement(element)).not.toThrow();
    expect(element.scrollIntoView).toHaveBeenLastCalledWith(true);
  });

  it('does nothing for a missing element or a host with no layout', () => {
    expect(() => scrollToElement(null)).not.toThrow();
    expect(() => scrollToElement({})).not.toThrow();
  });
});

describe('focusAsDestination', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('moves focus and marks where it landed', () => {
    const landmark = document.createElement('header');
    document.body.append(landmark);
    expect(focusAsDestination(landmark)).toBe(true);
    expect(document.activeElement).toBe(landmark);
    expect(landmark).toHaveAttribute(FOCUS_RING_ATTRIBUTE);
    // A landmark cannot accept focus without one, and -1 keeps it out of
    // the tab order, so leaving it changes nothing a reader observes.
    expect(landmark).toHaveAttribute('tabindex', '-1');
  });

  it('clears the mark when focus leaves, so no ring is left behind', () => {
    const landmark = document.createElement('header');
    document.body.append(landmark);
    focusAsDestination(landmark);
    landmark.dispatchEvent(new Event('blur'));
    expect(landmark).not.toHaveAttribute(FOCUS_RING_ATTRIBUTE);
  });

  it('keeps a tabindex the element already carried', () => {
    const control = document.createElement('button');
    control.setAttribute('tabindex', '0');
    document.body.append(control);
    focusAsDestination(control);
    expect(control).toHaveAttribute('tabindex', '0');
  });

  it('reports that it moved nothing when there is nothing to move', () => {
    expect(focusAsDestination(null)).toBe(false);
    expect(focusAsDestination({})).toBe(false);
  });
});
