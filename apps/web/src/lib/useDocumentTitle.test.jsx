import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import {
  useDocumentTitle,
  getRouteTitlePart,
  subscribeRouteTitle,
  resetRouteTitleForTest,
} from './useDocumentTitle.js';

function Page({ part }) {
  useDocumentTitle(part);
  return <p>page</p>;
}

describe('useDocumentTitle', () => {
  beforeEach(() => {
    cleanup();
    resetRouteTitleForTest();
  });

  it('names the route while it is mounted and clears the name when it leaves', () => {
    const view = render(<Page part="Travel and venue" />);
    expect(getRouteTitlePart()).toBe('Travel and venue');
    view.unmount();
    expect(getRouteTitlePart()).toBeNull();
  });

  it('treats an empty, blank, or absent part as no part at all', () => {
    // A record still loading must never write "undefined" into the tab.
    for (const part of [undefined, null, '', '   ']) {
      const view = render(<Page part={part} />);
      expect(getRouteTitlePart()).toBeNull();
      view.unmount();
    }
  });

  it('trims the part, so the composed title has one separator and no double space', () => {
    render(<Page part="  Opening remarks  " />);
    expect(getRouteTitlePart()).toBe('Opening remarks');
  });

  it('tells subscribers each time the part changes, and not when it does not', () => {
    const seen = [];
    const unsubscribe = subscribeRouteTitle((part) => seen.push(part));

    const view = render(<Page part="Schedule" />);
    view.rerender(<Page part="Schedule" />); // same value, no event
    view.rerender(<Page part="Speakers" />);
    view.unmount();

    // The null between the two names is the old effect's cleanup: React
    // runs it and the next effect back to back in one task, so the browser
    // never repaints a bare title in between.
    expect(seen).toEqual(['Schedule', null, 'Speakers', null]);
    unsubscribe();
  });

  it('a departing route does not wipe a name the arriving route already set', () => {
    const first = render(<Page part="Schedule" />);
    const second = render(<Page part="Opening remarks" />);
    expect(getRouteTitlePart()).toBe('Opening remarks');
    first.unmount(); // the old page leaves last
    expect(getRouteTitlePart()).toBe('Opening remarks');
    second.unmount();
    expect(getRouteTitlePart()).toBeNull();
  });

  it('stops telling a subscriber that has unsubscribed', () => {
    const seen = [];
    const unsubscribe = subscribeRouteTitle((part) => seen.push(part));
    unsubscribe();
    render(<Page part="Sponsors" />);
    expect(seen).toEqual([]);
    expect(getRouteTitlePart()).toBe('Sponsors');
  });
});
