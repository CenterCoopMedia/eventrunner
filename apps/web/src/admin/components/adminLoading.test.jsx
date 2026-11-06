import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { AdminLoadingState } from './adminChrome.jsx';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('AdminLoadingState', () => {
  it('uses the shared delayed activity and stable explanation without a reload action', () => {
    const { container, unmount } = render(<AdminLoadingState label="Loading event figures…" />);
    const status = screen.getByRole('status', { name: 'Loading event figures…' });
    expect(container.querySelector('.loading-status__activity')).toBeNull();
    act(() => vi.advanceTimersByTime(1000));
    expect(container.querySelector('.loading-status__activity')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('status')).toBe(status);
    act(() => vi.advanceTimersByTime(9000));
    expect(status).toHaveTextContent('longer than usual');
    act(() => vi.advanceTimersByTime(50000));
    expect(status).toHaveTextContent('after a minute');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
