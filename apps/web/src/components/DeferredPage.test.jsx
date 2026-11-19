import { lazy } from 'react';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import DeferredPage from './DeferredPage.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';

describe('DeferredPage', () => {
  it('announces loading and then renders the route', async () => {
    let finish;
    const Route = lazy(
      () => new Promise((resolve) => { finish = () => resolve({ default: () => <h1>Schedule</h1> }); }),
    );
    const { container } = render(<DeferredPage component={Route} label="schedule" shape="schedule" />);
    expect(screen.getByRole('status')).toHaveAccessibleName('Loading schedule…');
    expect(container.querySelector('.loading-state')).toHaveAttribute('data-loading-shape', 'schedule');
    await act(async () => finish());
    expect(await screen.findByRole('heading', { name: 'Schedule' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
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

  it('drops an abandoned route clock and paints a fast replacement without a ring', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    let abandoned;
    let finish;
    const Slow = lazy(() => new Promise((resolve) => { abandoned = () => resolve({ default: () => <h1>Old page</h1> }); }));
    const Fast = lazy(() => new Promise((resolve) => { finish = () => resolve({ default: () => <h1>New page</h1> }); }));
    const view = render(<DeferredPage component={Slow} label="old page" routeKey="/old" handoff />);
    try {
      act(() => vi.advanceTimersByTime(9_999));
      expect(screen.getByRole('status').closest('.loading-status')).toHaveAttribute('data-loading-stage', 'active');
      view.rerender(<DeferredPage component={Fast} label="new page" routeKey="/new" handoff />);
      act(() => vi.advanceTimersByTime(300));
      expect(screen.getByRole('status')).toHaveAccessibleName('Loading new page…');
      expect(view.container.querySelector('.loading-status__activity')).toBeNull();
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
