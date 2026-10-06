// The home page's History section on the real surface (issue #194): the
// shipped Home inside the real ContentProvider, fed an isolated client
// snapshot with a History section. The historical NC Local demo deliberately
// has no invented past editions; this fixture preserves the client feature
// coverage independently of that demo's editorial content.
//
// "the snapshot still renders on first paint": the first render, before any
// effect runs and before any listener reports, already lists the test
// snapshot's editions. "an entry published from the admin appears on the
// page without a rebuild": a listener result adds it to the mounted page,
// with no remount.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderToString } from 'react-dom/server';

const { subscriptions } = vi.hoisted(() => ({ subscriptions: new Map() }));

vi.mock('../lib/contentSource.js', () => ({
  subscribeContentCollection: (name, readSource, onNext) => {
    subscriptions.set(name, onNext);
    return () => subscriptions.delete(name);
  },
  subscribeSpeakersPublic: () => () => {},
}));

let eventConfig;
vi.mock('../contexts/EventConfigContext.jsx', () => ({
  useEventConfig: () => ({ eventConfig, theme: undefined, features: {} }),
}));

vi.mock('@generated/pagesData.js', async (importOriginal) => {
  const actual = await importOriginal();
  const pagesData = actual.default.map((page) => page.id === 'home'
    ? { ...page, sections: [...page.sections, {
      id: 'history', label: 'History', allowedBlocks: ['richtext'],
      maxBlocks: 4, reorderable: true, defaultBlocks: [],
    }] }
    : page);
  return { ...actual, pagesData, default: pagesData };
});
vi.mock('@generated/siteContent.js', async (importOriginal) => {
  const actual = await importOriginal();
  const siteContent = { ...actual.default, history__story: {
    section: 'history', field: 'story', blockType: 'richtext',
    value: '<p>A synthetic client story about its previous editions.</p>',
    order: 0, visible: true, seeded: true,
  } };
  return { ...actual, siteContent, default: siteContent };
});
vi.mock('@generated/timelineData.js', () => {
  // Unsorted input also verifies the provider's first-paint ordering.
  const timelineData = [
    { id: 'edition-2024', year: 2024, title: 'Second test edition', description: null, visible: true },
    { id: 'edition-2021', year: 2021, title: 'First test edition', description: null, visible: true },
  ];
  return { timelineData, default: timelineData };
});

import Home from './Home.jsx';
import { ContentProvider } from '../contexts/ContentContext.jsx';
import snapshotTimelineData from '@generated/timelineData.js';
import snapshotSiteContent from '@generated/siteContent.js';

const STORY_TEXT = snapshotSiteContent.history__story.value.replace(/<[^>]*>/g, '').slice(0, 40);

function renderHome() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ContentProvider>
        <Home />
      </ContentProvider>
    </MemoryRouter>,
  );
}

/** The History section as the page draws it now. */
const historySection = () => screen.getByRole('region', { name: 'History' });

const SNAPSHOT_TITLES = [...snapshotTimelineData]
  .sort((a, b) => a.year - b.year)
  .map((entry) => entry.title);

const titlesIn = (section) =>
  within(section).queryAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);

beforeEach(() => {
  subscriptions.clear();
  eventConfig = { name: 'Demo Event', days: [] };
});

describe('Home History section, on the real content provider', () => {
  it('lists every snapshot edition on the first render, before any effect runs', () => {
    // A server render runs no effect at all: this is the page's first render,
    // exactly what the browser paints before any listener or chunk arrives.
    const html = renderToString(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ContentProvider>
          <Home />
        </ContentProvider>
      </MemoryRouter>,
    );
    const page = document.createElement('div');
    page.innerHTML = html;
    expect(page.querySelector('article')).toHaveAttribute('data-content-source', 'snapshot');
    const heading = page.querySelector('#section-history');
    expect(heading).not.toBeNull();
    const section = heading.closest('section');
    expect(SNAPSHOT_TITLES.length).toBeGreaterThanOrEqual(2);
    expect([...section.querySelectorAll('ol > li h3')].map((h) => h.textContent)).toEqual(SNAPSHOT_TITLES);
  });

  it('lists every snapshot edition in year order as soon as it renders, with no listener result', () => {
    renderHome();
    // Read at once: no waiting on a chunk, a listener, or a timer.
    expect(screen.getByRole('article')).toHaveAttribute('data-content-source', 'snapshot');
    expect(titlesIn(historySection())).toEqual(SNAPSHOT_TITLES);
    expect(within(historySection()).getByText(new RegExp(STORY_TEXT))).toBeInTheDocument();
  });

  it('adds an entry the listener reports to the mounted page, first when it is oldest', () => {
    renderHome();
    const section = historySection();
    const list = section.querySelector('ol');
    act(() => {
      subscriptions.get('cmsTimeline')([
        ...snapshotTimelineData,
        { id: 'edition-2019', year: 2019, title: 'A published edition', description: null, visible: true },
      ]);
    });
    expect(screen.getByRole('article')).toHaveAttribute('data-content-source', 'live');
    expect(titlesIn(section)[0]).toBe('A published edition');
    // The same list element: the page was not remounted.
    expect(section.querySelector('ol')).toBe(list);
  });

  it('removes the list when the live set is empty, and keeps the section’s own block', () => {
    renderHome();
    const section = historySection();
    act(() => {
      subscriptions.get('cmsTimeline')([]);
    });
    // The same section, now without a list; its heading and its own block stay.
    expect(section.isConnected).toBe(true);
    expect(section.querySelector('ol')).toBeNull();
    expect(within(section).getByRole('heading', { level: 2, name: 'History' })).toBeInTheDocument();
    expect(within(section).getByText(new RegExp(STORY_TEXT))).toBeInTheDocument();
  });
});
