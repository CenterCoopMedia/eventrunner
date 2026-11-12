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
});
