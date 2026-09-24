// The home page's History section on the real surface (issue #194): the
// shipped Home inside the real ContentProvider, fed the committed generated
// snapshot, with only the Firestore listener seam (lib/contentSource.js)
// replaced so a test can report a published set the way the listener does.
//
// "the snapshot still renders on first paint": the section's own blocks draw
// on the first render, and the editions follow from the committed snapshot
// with no listener result at all. "an entry published from the admin
// appears on the page without a rebuild": a listener result adds it to the
// mounted page, with no remount.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

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

import Home from './Home.jsx';
import { ContentProvider } from '../contexts/ContentContext.jsx';
import snapshotTimelineData from '@generated/timelineData.js';
import snapshotSiteContent from '@generated/siteContent.js';

const STORY_TEXT = snapshotSiteContent.history__story.value.replace(/<[^>]*>/g, '').slice(0, 40);

function renderHome(HomePage = Home, Provider = ContentProvider) {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Provider>
        <HomePage />
      </Provider>
    </MemoryRouter>,
  );
}

/**
 * The History section, once its list has loaded. The section drawn before
 * the list's chunk arrives is the page's default drawing, and the loaded
 * renderer replaces it, so the region is looked up again each time.
 */
async function historyList() {
  let section = null;
  await vi.waitFor(() => {
    section = screen.getByRole('region', { name: 'History' });
    expect(section.querySelector('ol')).not.toBeNull();
  });
  return section;
}

const titlesIn = (section) =>
  within(section).queryAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);

beforeEach(() => {
  subscriptions.clear();
  eventConfig = { name: 'Demo Event', days: [] };
});

describe('Home History section, on the real content provider', () => {
  it('lists every snapshot edition in year order before the listener reports', async () => {
    renderHome();
    const section = await historyList();
    expect(screen.getByRole('article')).toHaveAttribute('data-content-source', 'snapshot');
    const expected = [...snapshotTimelineData].sort((a, b) => a.year - b.year).map((entry) => entry.title);
    expect(expected.length).toBeGreaterThanOrEqual(2);
    expect(titlesIn(section)).toEqual(expected);
  });

  it('adds an entry the listener reports to the mounted page, first when it is oldest', async () => {
    renderHome();
    const section = await historyList();
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

  it('removes the list when the live set is empty, and keeps the section’s own block', async () => {
    renderHome();
    const section = await historyList();
    act(() => {
      subscriptions.get('cmsTimeline')([]);
    });
    // The same section, now without a list; its heading and its own block stay.
    expect(section.isConnected).toBe(true);
    expect(section.querySelector('ol')).toBeNull();
    expect(within(section).getByRole('heading', { level: 2, name: 'History' })).toBeInTheDocument();
    expect(within(section).getByText(new RegExp(STORY_TEXT))).toBeInTheDocument();
  });

  it('draws the section’s own blocks on the first render, before the list’s chunk arrives', async () => {
    // A fresh module graph, so the on-demand chunk has not loaded yet. Last
    // in the file: the tests above share the first graph.
    vi.resetModules();
    const [{ default: FreshHome }, { ContentProvider: FreshProvider }] = await Promise.all([
      import('./Home.jsx'),
      import('../contexts/ContentContext.jsx'),
    ]);
    renderHome(FreshHome, FreshProvider);
    const first = screen.getByRole('region', { name: 'History' });
    expect(within(first).getByText(new RegExp(STORY_TEXT))).toBeInTheDocument();
    expect(first.querySelector('ol')).toBeNull();
    // Then the editions join it, from the snapshot, with no listener result.
    const section = await historyList();
    expect(titlesIn(section)).toEqual(
      [...snapshotTimelineData].sort((a, b) => a.year - b.year).map((entry) => entry.title),
    );
    expect(within(section).getByText(new RegExp(STORY_TEXT))).toBeInTheDocument();
    expect(subscriptions.size).toBeGreaterThan(0);
  });
});
