import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import LoadingState from './LoadingState.jsx';

afterEach(() => vi.useRealTimers());

describe('console waiting feedback', () => {
  it('names the work immediately and advances only at useful waiting thresholds', () => {
    vi.useFakeTimers();
    render(<LoadingState>Loading your organizations.</LoadingState>);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Loading your organizations.');
    expect(status).toHaveAttribute('data-loading-stage', 'initial');
    act(() => vi.advanceTimersByTime(999));
    expect(status).toHaveAttribute('data-loading-stage', 'initial');
    act(() => vi.advanceTimersByTime(1));
    expect(status).toHaveAttribute('data-loading-stage', 'active');
    act(() => vi.advanceTimersByTime(9000));
    expect(status).toHaveTextContent('This is taking longer than expected.');
    act(() => vi.advanceTimersByTime(50000));
    expect(status).toHaveTextContent('No result yet.');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('removes pending timers with the result and starts a fresh wait on remount', () => {
    vi.useFakeTimers();
    const first = render(<LoadingState long>Loading your setup.</LoadingState>);
    expect(first.container.querySelector('.console-loading-indicator')).toHaveAttribute('aria-hidden', 'true');
    act(() => vi.advanceTimersByTime(10000));
    first.unmount();
    expect(vi.getTimerCount()).toBe(0);
    render(<LoadingState>Loading the agreement.</LoadingState>);
    expect(screen.getByRole('status')).toHaveAttribute('data-loading-stage', 'initial');
    expect(screen.getByRole('status')).not.toHaveTextContent('longer than expected');
  });

  it('offers Try again on a read at ten seconds, and the next read renders the page without a reload', async () => {
    vi.useFakeTimers();
    const answers = [];
    const read = vi.fn(() => new Promise((resolve) => answers.push(resolve)));
    function Page() {
      const [data, setData] = useState(null);
      const [attempt, setAttempt] = useState(0);
      useEffect(() => {
        let live = true;
        read().then((body) => { if (live) setData(body); });
        return () => { live = false; };
      }, [attempt]);
      if (!data) return <LoadingState onRetry={() => setAttempt((value) => value + 1)}>Loading the team.</LoadingState>;
      return <h1>{data.name}</h1>;
    }
    const { container } = render(<Page />);
    const indicator = () => container.querySelector('.console-loading-indicator');
    act(() => vi.advanceTimersByTime(999));
    expect(screen.getByRole('status')).toHaveAttribute('data-loading-stage', 'initial');
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('status')).toHaveAttribute('data-loading-stage', 'active');
    act(() => vi.advanceTimersByTime(8999));
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('status')).toHaveTextContent('This is taking longer than expected.');

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(read).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status')).toHaveAttribute('data-loading-stage', 'initial');
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();

    await act(async () => answers[1]({ name: 'The team' }));
    // The indicator leaves in the same render that shows the content.
    expect(screen.getByRole('heading', { name: 'The team' })).toBeInTheDocument();
    expect(indicator()).toBeNull();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    // The read that never answered in time changes nothing when it lands.
    await act(async () => answers[0]({ name: 'Stale team' }));
    expect(screen.getByRole('heading', { name: 'The team' })).toBeInTheDocument();
  });

  it('offers no Try again without a read to repeat', () => {
    vi.useFakeTimers();
    render(<LoadingState>Checking your sign-in.</LoadingState>);
    act(() => vi.advanceTimersByTime(60000));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
