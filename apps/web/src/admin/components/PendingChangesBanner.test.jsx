import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { subscribeDirtyDrafts } from '../pendingChangesSource.js';
import { subscribePendingCounts } from '../pendingCountsSource.js';
import { PendingChangesProvider, usePendingChanges } from '../PendingChangesContext.jsx';
import PendingChangesBanner from './PendingChangesBanner.jsx';

const { call } = vi.hoisted(() => ({ call: vi.fn(async () => ({ ok: true })) }));
vi.mock('../adminApi.js', () => ({ useAdminApi: () => call }));

const ALL = ['cmsContent', 'cmsPages', 'cmsSchedule', 'cmsOrganizations', 'cmsUpdates', 'cmsTimeline'];
const counts = (values = {}) => Object.fromEntries(ALL.map((id) => [id, values[id] ?? 0]));
let listener;
const detach = vi.fn();

beforeEach(() => {
  listener = null;
  detach.mockClear();
  call.mockClear();
  vi.mocked(subscribeDirtyDrafts).mockClear();
  vi.mocked(subscribePendingCounts).mockClear().mockImplementation((initialize, onNext, onError) => {
    listener = { initialize, onNext, onError };
    return detach;
  });
});

function deliver(values = {}) {
  act(() => listener.onNext(counts(values)));
}

function renderBanner(path = '/admin/pages') {
  return render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <PendingChangesProvider><PendingChangesBanner /></PendingChangesProvider>
    </MemoryRouter>,
  );
}

const banner = () => screen.queryByRole('complementary', { name: 'Unpublished changes' });

describe('the pending-changes banner', () => {
  it('does not download draft rows just to show the banner', () => {
    renderBanner();
    expect(subscribeDirtyDrafts).not.toHaveBeenCalled();
    expect(subscribePendingCounts).toHaveBeenCalledTimes(1);
  });

  it('waits for a count document and renders nothing when it is zero', () => {
    const { container } = renderBanner();
    expect(container).toBeEmptyDOMElement();
    deliver();
    expect(container).toBeEmptyDOMElement();
  });

  it('states one change in the singular with a link to its page', () => {
    renderBanner();
    deliver({ cmsContent: 1 });
    expect(banner()).toHaveAttribute('data-pending-total', '1');
    expect(banner()).toHaveTextContent('1 unpublished change: 1 content block. Review unpublished changes');
    expect(screen.getByRole('link', { name: 'Review unpublished changes' })).toHaveAttribute('href', '/admin/unpublished');
  });

  it('states the collection totals and preserves the proof-ground link treatment', () => {
    renderBanner();
    deliver({ cmsContent: 2, cmsPages: 1, cmsSchedule: 2 });
    expect(banner()).toHaveAttribute('data-pending-total', '5');
    expect(banner()).toHaveTextContent('5 unpublished changes: 2 content blocks, 1 page, 2 sessions.');
    expect(banner().className).toContain('bg-admin-ground-proof');
    const link = screen.getByRole('link', { name: 'Review unpublished changes' });
    expect(link.className).toMatch(/\btext-admin-ink\b/);
    expect(link.className).toMatch(/\bunderline\b/);
    expect(link.className).toMatch(/\badmin-target\b/);
    expect(link.className).toMatch(/\binline-flex\b/);
    expect(link.className).toMatch(/\bitems-center\b/);
  });

  it('follows saves and publishes as the one count document changes', () => {
    renderBanner();
    deliver({ cmsContent: 1 });
    deliver({ cmsContent: 1, cmsPages: 2 });
    expect(banner()).toHaveAttribute('data-pending-total', '3');
    deliver();
    expect(banner()).toBeNull();
  });

  it('is hidden on the row-counted page for every supported path spelling', () => {
    for (const path of [
      '/admin/unpublished',
      '/admin/unpublished/',
      '/admin/Unpublished',
      '/ADMIN/UNPUBLISHED',
      '/admin/%75npublished',
      '/admin/%75npublished/',
      '/%41dmin/%75npublished',
    ]) {
      const { container, unmount } = renderBanner(path);
      deliver({ cmsContent: 3 });
      expect(container, path).toBeEmptyDOMElement();
      unmount();
    }
  });

  it('still shows the banner on an encoded path that is not this page', () => {
    renderBanner('/admin/%70ages');
    deliver({ cmsContent: 1 });
    expect(banner()).not.toBeNull();
  });

  it('does not throw when a segment has a bad percent escape', () => {
    renderBanner('/admin/%E0%A4%A');
    deliver({ cmsContent: 1 });
    expect(banner()).not.toBeNull();
  });

  it('states initial failure, retains a known count on failure, and recovers', () => {
    renderBanner();
    act(() => listener.onError(new Error('denied')));
    expect(banner()).toHaveTextContent('We could not count the unpublished changes. We will try again.');
    expect(banner()).not.toHaveAttribute('data-pending-total');
    deliver({ cmsPages: 1 });
    act(() => listener.onError(new Error('again')));
    expect(banner()).toHaveTextContent('1 unpublished change: 1 page.');
    deliver({ cmsPages: 2 });
    expect(banner()).toHaveTextContent('2 unpublished changes: 2 pages.');
  });

  it('announces nothing and offers no dismiss control', () => {
    renderBanner();
    deliver({ cmsContent: 1 });
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(banner()).not.toHaveAttribute('aria-live');
  });
});

describe('the shell count', () => {
  function Probe() {
    const value = usePendingChanges();
    return <output data-ready={String(value.ready)} data-total={value.total}>{value.sentence}</output>;
  }

  it('opens one subscription, supplies an authenticated initializer, and closes it', async () => {
    const { unmount } = render(<PendingChangesProvider><Probe /></PendingChangesProvider>);
    expect(subscribePendingCounts).toHaveBeenCalledTimes(1);
    await listener.initialize();
    expect(call).toHaveBeenCalledWith('cmsEnsurePendingCounts', {});
    unmount();
    expect(detach).toHaveBeenCalledTimes(1);
  });

  it('is never ready outside a provider', () => {
    const { container } = render(<Probe />);
    expect(container.querySelector('output')).toHaveAttribute('data-ready', 'false');
    expect(container.querySelector('output')).toHaveAttribute('data-total', '0');
  });

  it('is ready only after the document arrives, without holding full rows', () => {
    const { container } = render(<PendingChangesProvider><Probe /></PendingChangesProvider>);
    const output = container.querySelector('output');
    expect(output).toHaveAttribute('data-ready', 'false');
    deliver({ cmsPages: 2001, cmsSchedule: 3 });
    expect(output).toHaveAttribute('data-ready', 'true');
    expect(output).toHaveAttribute('data-total', '2004');
    expect(subscribeDirtyDrafts).not.toHaveBeenCalled();
  });
});
