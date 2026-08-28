import { lazy } from 'react';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DeferredPage from './DeferredPage.jsx';

describe('DeferredPage', () => {
  it('announces loading and then renders the route', async () => {
    let finish;
    const Route = lazy(
      () => new Promise((resolve) => { finish = () => resolve({ default: () => <h1>Schedule</h1> }); }),
    );
    render(<DeferredPage component={Route} label="schedule" />);
    expect(screen.getByRole('status')).toHaveAccessibleName('Loading schedule…');
    await act(async () => finish());
    expect(await screen.findByRole('heading', { name: 'Schedule' })).toBeInTheDocument();
  });

  it('routes a rejected import through the existing recovery boundary', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const Route = lazy(() => Promise.reject(new Error('route failed')));
    render(<DeferredPage component={Route} label="schedule" />);
    expect(
      await screen.findByRole('heading', { name: 'This part of the site did not load' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload the page' })).toBeInTheDocument();
  });
});
