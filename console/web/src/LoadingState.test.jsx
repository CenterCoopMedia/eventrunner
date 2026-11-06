import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
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
});
