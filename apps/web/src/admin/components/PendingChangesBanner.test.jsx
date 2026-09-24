// The pending-changes banner and the one count it reads (issue #196).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { subscribeDirtyDrafts } from '../pendingChangesSource.js';
import { PendingChangesProvider, usePendingChanges } from '../PendingChangesContext.jsx';
import PendingChangesBanner from './PendingChangesBanner.jsx';

// collection id → the listener's callbacks, so a test delivers per collection.
const listeners = new Map();
const unsubscribed = [];

beforeEach(() => {
  listeners.clear();
  unsubscribed.length = 0;
  vi.mocked(subscribeDirtyDrafts).mockImplementation((collection, onNext, onError) => {
    listeners.set(collection, { onNext, onError });
    return () => unsubscribed.push(collection);
  });
});

const ALL = ['cmsContent', 'cmsPages', 'cmsSchedule', 'cmsOrganizations', 'cmsUpdates', 'cmsTimeline'];

function deliver(docsByCollection = {}) {
  act(() => {
    for (const collection of ALL) {
      listeners.get(collection).onNext(docsByCollection[collection] ?? []);
    }
  });
}

const drafts = (collection, n) =>
  Array.from({ length: n }, (_, index) => ({ id: `${collection}-${index}`, status: 'dirty' }));

function renderBanner(path = '/admin/pages') {
  return render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <PendingChangesProvider>
        <PendingChangesBanner />
      </PendingChangesProvider>
    </MemoryRouter>,
  );
}

const banner = () => screen.queryByRole('complementary', { name: 'Unpublished changes' });

describe('the pending-changes banner', () => {
  it('renders nothing until every collection has answered', () => {
    const { container } = renderBanner();
    act(() => {
      listeners.get('cmsContent').onNext(drafts('cmsContent', 2));
    });
    expect(banner()).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when nothing is waiting', () => {
    const { container } = renderBanner();
    deliver();
    expect(banner()).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it('states one change in the singular, with the link to the page', () => {
    renderBanner();
    deliver({ cmsContent: drafts('cmsContent', 1) });
    expect(banner()).toHaveAttribute('data-pending-total', '1');
    expect(banner()).toHaveTextContent('1 unpublished change: 1 content block. Review unpublished changes');
    const link = screen.getByRole('link', { name: 'Review unpublished changes' });
    expect(link).toHaveAttribute('href', '/admin/unpublished');
  });

  it('states five changes across collections, and sets its link in the ink on the proof ground', () => {
    renderBanner();
    deliver({ cmsContent: drafts('cmsContent', 2), cmsPages: drafts('cmsPages', 1), cmsSchedule: drafts('cmsSchedule', 2) });
    expect(banner()).toHaveAttribute('data-pending-total', '5');
    expect(banner()).toHaveTextContent('5 unpublished changes: 2 content blocks, 1 page, 2 sessions.');
    expect(banner().className).toContain('bg-admin-ground-proof');
    expect(banner().className).toContain('text-admin-ink');
    const link = screen.getByRole('link', { name: 'Review unpublished changes' });
    expect(link.className).toMatch(/\btext-admin-ink\b/);
    expect(link.className).toMatch(/\bunderline\b/);
    expect(link.className).not.toContain('text-admin-ink-link');
  });

  it('gives its link the hit-area floor: 24px on a pointer, 44px on touch', () => {
    renderBanner();
    deliver({ cmsContent: drafts('cmsContent', 1) });
    const link = screen.getByRole('link', { name: 'Review unpublished changes' });
    // .admin-target sets the floor (index.css); inline-flex lets a link that
    // stays in the sentence take a minimum height at all.
    expect(link.className).toMatch(/\badmin-target\b/);
    expect(link.className).toMatch(/\binline-flex\b/);
    expect(link.className).toMatch(/\bitems-center\b/);
  });

  it('follows the count as saves and publishes arrive', () => {
    renderBanner();
    deliver({ cmsContent: drafts('cmsContent', 1) });
    act(() => listeners.get('cmsPages').onNext(drafts('cmsPages', 2)));
    expect(banner()).toHaveAttribute('data-pending-total', '3');
    act(() => {
      listeners.get('cmsPages').onNext([]);
      listeners.get('cmsContent').onNext([]);
    });
    expect(banner()).toBeNull();
  });

  it('renders nothing on the Unpublished changes page, however the path is spelled', () => {
    for (const path of ['/admin/unpublished', '/admin/unpublished/', '/admin/Unpublished', '/ADMIN/UNPUBLISHED']) {
      const { container, unmount } = renderBanner(path);
      deliver({ cmsContent: drafts('cmsContent', 3) });
      expect(container, path).toBeEmptyDOMElement();
      unmount();
    }
  });

  it('says the count failed before it has one, and keeps the last count after', () => {
    renderBanner();
    act(() => listeners.get('cmsPages').onError(new Error('denied')));
    expect(banner()).toHaveTextContent('We could not count the unpublished changes. We will try again.');
    expect(banner()).not.toHaveAttribute('data-pending-total');
    deliver({ cmsPages: drafts('cmsPages', 1) });
    expect(banner()).toHaveTextContent('1 unpublished change: 1 page.');
    act(() => listeners.get('cmsPages').onError(new Error('again')));
    expect(banner()).toHaveTextContent('1 unpublished change: 1 page.');
  });

  it('announces nothing and offers no dismiss: the editor that saved says so once', () => {
    renderBanner();
    deliver({ cmsContent: drafts('cmsContent', 1) });
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(banner()).not.toHaveAttribute('aria-live');
  });
});

describe('the one count', () => {
  function Probe() {
    const value = usePendingChanges();
    return <output data-ready={String(value.ready)} data-total={value.total}>{value.sentence}</output>;
  }

  it('opens one listener per publishable collection and closes each on unmount', () => {
    const { unmount } = render(
      <PendingChangesProvider>
        <Probe />
      </PendingChangesProvider>,
    );
    expect([...listeners.keys()].sort()).toEqual([...ALL].sort());
    unmount();
    expect(unsubscribed.sort()).toEqual([...ALL].sort());
  });

  it('is ready only once all six have answered, and sums them', () => {
    const { container } = render(
      <PendingChangesProvider>
        <Probe />
      </PendingChangesProvider>,
    );
    const output = container.querySelector('output');
    act(() => {
      for (const collection of ALL.slice(0, 5)) listeners.get(collection).onNext(drafts(collection, 1));
    });
    expect(output).toHaveAttribute('data-ready', 'false');
    act(() => listeners.get('cmsTimeline').onNext(drafts('cmsTimeline', 2)));
    expect(output).toHaveAttribute('data-ready', 'true');
    expect(output).toHaveAttribute('data-total', '7');
  });

  it('is never ready outside a provider', () => {
    const { container } = render(<Probe />);
    expect(container.querySelector('output')).toHaveAttribute('data-ready', 'false');
    expect(container.querySelector('output')).toHaveAttribute('data-total', '0');
  });

  it('tolerates a listener that returns no unsubscribe', () => {
    vi.mocked(subscribeDirtyDrafts).mockImplementation(() => undefined);
    const { unmount } = render(
      <PendingChangesProvider>
        <Probe />
      </PendingChangesProvider>,
    );
    expect(() => unmount()).not.toThrow();
  });
});
