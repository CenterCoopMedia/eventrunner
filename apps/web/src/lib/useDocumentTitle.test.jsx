import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import {
  useDocumentTitle,
  useDerivedDocumentTitle,
  routeTitlePartFor,
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
    const view = render(<Page part="Travel" />);
    expect(getRouteTitlePart()).toBe('Travel');
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

describe('routeTitlePartFor', () => {
  const PAGES = [
    { id: 'home', label: 'Home', path: '/', visible: true, systemPage: true },
    { id: 'schedule', label: 'Schedule', path: '/schedule', visible: true, systemPage: true },
    { id: 'speakers', label: 'Speakers', path: '/speakers', visible: true, systemPage: true },
    { id: 'sponsors', label: 'Sponsors', path: '/sponsors', visible: true, systemPage: true },
    { id: 'travel', label: 'Travel', path: '/travel', visible: true, systemPage: false },
    { id: 'faq', label: 'FAQ', title: 'Frequently asked questions', path: '/faq', visible: true, systemPage: false },
    { id: 'hidden', label: 'Unfinished', path: '/hidden', visible: false, systemPage: false },
  ];
  const FEATURES = { schedule: true, speakers: true, sponsors: true, updates: false };
  const partFor = (pathname, features = FEATURES, pages = PAGES) =>
    routeTitlePartFor({ pathname, pages, features });

  it('names a listing route from its own page document', () => {
    // The routes with no record to name: without this they showed the
    // server's title and then dropped to the bare event name.
    expect(partFor('/schedule')).toBe('Schedule');
    expect(partFor('/speakers')).toBe('Speakers');
    expect(partFor('/sponsors')).toBe('Sponsors');
  });

  it('names a generic page from its stored path', () => {
    expect(partFor('/travel')).toBe('Travel');
    expect(partFor('/travel/')).toBe('Travel');
  });

  it('names a page by its heading, not by its short navigation label', () => {
    // The tab has to match the <h1> the reader is looking at and the title
    // the server already sent, both of which read the page's heading
    // (shared/page pageHeading). A tab saying "FAQ" over a page headed
    // "Frequently asked questions" would be a third name for one page.
    expect(partFor('/faq')).toBe('Frequently asked questions');
  });

  it('names a system page by its id even when its stored path drifted', () => {
    // Same rule the server applies: a system page's path is a copy of a
    // fact that lives in App.jsx, and a copy can drift.
    const drifted = PAGES.map((page) =>
      (page.id === 'schedule' ? { ...page, label: 'Programme', path: '/p/schedule' } : page));
    expect(partFor('/schedule', FEATURES, drifted)).toBe('Programme');
    expect(partFor('/p/schedule', FEATURES, drifted)).toBeNull();
  });

  it('names a detail route after its section, until the page itself claims one', () => {
    // /schedule/abc derives "Schedule"; SessionDetail then claims the
    // session's own title over it.
    expect(partFor('/schedule/some-session')).toBe('Schedule');
    expect(partFor('/speakers/rae-okonkwo')).toBe('Speakers');
    // sponsors mounts no children, so nothing sits under it.
    expect(partFor('/sponsors/anything')).toBeNull();
  });

  it('names nothing for a route whose feature is off, a hidden page, or an unknown address', () => {
    expect(partFor('/updates')).toBeNull(); // features.updates is off
    expect(partFor('/hidden')).toBeNull();
    expect(partFor('/no-such-page')).toBeNull();
    expect(partFor('/signin')).toBeNull();
    expect(partFor('/Travel')).toBeNull(); // not a path this system stores
  });

  it('names the home page nothing, so the event name stands alone there', () => {
    // The server titles '/' with the event name alone for the same reason:
    // "Home" names the document for an editor, not the site.
    expect(partFor('/')).toBeNull();
    expect(partFor('')).toBeNull();
  });

  it('survives an empty or absent page set', () => {
    expect(routeTitlePartFor({ pathname: '/schedule', pages: null, features: FEATURES })).toBeNull();
    expect(routeTitlePartFor({ pathname: '/travel', pages: [], features: null })).toBeNull();
  });
});

describe('the two layers', () => {
  beforeEach(() => {
    cleanup();
    resetRouteTitleForTest();
  });

  function Derived({ part }) {
    useDerivedDocumentTitle(part);
    return null;
  }

  it('lets a page that names itself win over what the route derived', () => {
    const derived = render(<Derived part="Schedule" />);
    expect(getRouteTitlePart()).toBe('Schedule');

    const claimed = render(<Page part="Opening remarks" />);
    expect(getRouteTitlePart()).toBe('Opening remarks');

    // Leaving the session falls back to the section, not to nothing.
    claimed.unmount();
    expect(getRouteTitlePart()).toBe('Schedule');
    derived.unmount();
    expect(getRouteTitlePart()).toBeNull();
  });

  it('tells subscribers only when the part in force actually changes', () => {
    const seen = [];
    const unsubscribe = subscribeRouteTitle((part) => seen.push(part));
    const claimed = render(<Page part="Opening remarks" />);
    // The derived part arriving underneath a claimed one changes nothing.
    const derived = render(<Derived part="Schedule" />);
    expect(seen).toEqual(['Opening remarks']);
    claimed.unmount();
    expect(seen).toEqual(['Opening remarks', 'Schedule']);
    derived.unmount();
    unsubscribe();
  });
});
