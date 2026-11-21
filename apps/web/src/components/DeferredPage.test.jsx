import { lazy } from 'react';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import DeferredPage from './DeferredPage.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';

describe('DeferredPage', () => {
  it('shows the operation and renders a fast route without changing the live region', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    let finish;
    const Route = lazy(
      () => new Promise((resolve) => { finish = () => resolve({ default: () => <h1>Schedule</h1> }); }),
    );
    const { container, unmount } = render(<DeferredPage component={Route} label="schedule" shape="schedule" />);
    const status = screen.getByRole('status');
    const mutations = new MutationObserver(() => {});
    mutations.observe(status, { childList: true, characterData: true, subtree: true });
    try {
      expect(status).toBeEmptyDOMElement();
      expect(screen.getByText('Loading schedule…').closest('[aria-hidden="true"]')).toBeInTheDocument();
      expect(container.querySelector('.loading-state')).toHaveAttribute('data-loading-shape', 'schedule');
      act(() => vi.advanceTimersByTime(300));
      expect(status).toBeEmptyDOMElement();
      expect(mutations.takeRecords()).toHaveLength(0);
      await act(async () => finish());
      expect(screen.getByRole('heading', { name: 'Schedule' })).toBeInTheDocument();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      mutations.disconnect();
      unmount();
      vi.useRealTimers();
    }
  });

  it('routes a rejected import through the existing recovery boundary', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const Route = lazy(() => Promise.reject(new Error('route failed')));
    render(<MemoryRouter><ErrorBoundary><DeferredPage component={Route} label="schedule" /></ErrorBoundary></MemoryRouter>);
    expect(
      await screen.findByRole('heading', { name: 'This page could not be shown' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload the page' })).toBeInTheDocument();
  });

  it('replaces a stalled route placeholder and renders the page if the import finishes later', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    let finish;
    const Route = lazy(() => new Promise((resolve) => { finish = () => resolve({ default: () => <h1>Schedule</h1> }); }));
    const view = render(<DeferredPage component={Route} label="schedule" shape="schedule" recover />);
    try {
      const status = screen.getByRole('status');
      act(() => vi.advanceTimersByTime(59_999));
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
      act(() => vi.advanceTimersByTime(1));
      expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
      expect(status).toBeVisible();
      expect(status).toHaveTextContent('This is taking longer than a minute.');
      expect(view.container.querySelector('.loading-state__placeholder')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
    await act(async () => finish());
    expect(await screen.findByRole('heading', { name: 'Schedule' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('drops an abandoned route clock and paints a fast replacement without a ring', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    let abandoned;
    let finish;
    const Slow = lazy(() => new Promise((resolve) => { abandoned = () => resolve({ default: () => <h1>Old page</h1> }); }));
    const Fast = lazy(() => new Promise((resolve) => { finish = () => resolve({ default: () => <h1>New page</h1> }); }));
    const view = render(<DeferredPage component={Slow} label="old page" routeKey="/old" />);
    try {
      act(() => vi.advanceTimersByTime(9_999));
      expect(screen.getByRole('status').closest('.loading-status')).toHaveAttribute('data-loading-stage', 'active');
      view.rerender(<DeferredPage component={Fast} label="new page" routeKey="/new" />);
      act(() => vi.advanceTimersByTime(300));
      expect(screen.getByText('Loading new page…')).toBeVisible();
      expect(screen.getByRole('status')).toBeEmptyDOMElement();
      expect(view.container.querySelector('.held-figure')).toBeNull();
      await act(async () => finish());
      expect(screen.getByRole('heading', { name: 'New page' })).toBeInTheDocument();
      expect(screen.queryByRole('status')).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
      await act(async () => abandoned());
      expect(screen.queryByRole('heading', { name: 'Old page' })).toBeNull();
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });
});
