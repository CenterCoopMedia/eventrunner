import { act, cleanup, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import RouteBoundary, { lazyPage } from './RouteBoundary.jsx';

describe('route delivery', () => {
  it('renders a fast route without a loading flash or a later timer', async () => {
    vi.useFakeTimers();
    const Page = lazyPage(() => Promise.resolve({ default: () => <h1>Loaded page</h1> }));
    try {
      render(<Page />);
      await act(async () => {});
      expect(screen.getByRole('heading', { name: 'Loaded page' })).toBeInTheDocument();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    } finally {
      cleanup();
      vi.useRealTimers();
    }
  });

  it('keeps the shell usable after a missing chunk and can navigate to another page', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const expectedError = (event) => {
      if (event.error?.message === 'synthetic unavailable module') event.preventDefault();
    };
    window.addEventListener('error', expectedError);
    const Missing = lazyPage(() => Promise.reject(new Error('synthetic unavailable module')));
    try {
      const view = render(<><header>Console shell</header><RouteBoundary resetKey="missing"><Missing /></RouteBoundary></>);
      expect(await screen.findByRole('alert')).toHaveTextContent('Reload the page to try again.');
      expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument();
      expect(screen.getByRole('banner')).toHaveTextContent('Console shell');
      expect(screen.queryByText('synthetic unavailable module')).not.toBeInTheDocument();
      view.rerender(<><header>Console shell</header><RouteBoundary resetKey="another"><h1>Another page</h1></RouteBoundary></>);
      expect(await screen.findByRole('heading', { name: 'Another page' })).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    } finally {
      window.removeEventListener('error', expectedError);
      error.mockRestore();
    }
  });
});
