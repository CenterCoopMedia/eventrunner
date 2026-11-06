import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import LoadingState, { LoadingStateView } from './LoadingState.jsx';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function advance(milliseconds) {
  act(() => vi.advanceTimersByTime(milliseconds));
}

describe('LoadingState', () => {
  it('states the task immediately and delays decorative activity for one second', () => {
    const { container } = render(<LoadingState label="Loading the schedule…" />);
    const status = screen.getByRole('status', { name: 'Loading the schedule…' });
    expect(status).toHaveTextContent('Loading the schedule…');
    expect(container.querySelector('.loading-status__activity')).toBeNull();
    advance(999);
    expect(container.querySelector('.loading-status__activity')).toBeNull();
    advance(1);
    const activity = container.querySelector('.loading-status__activity');
    expect(activity).toHaveAttribute('aria-hidden', 'true');
    expect(status).not.toContainElement(activity);
    expect(screen.getByRole('status')).toBe(status);
    expect(status.textContent).toBe('Loading the schedule…');
  });

  it('updates the same polite status after ten seconds and after a minute', () => {
    const { container } = render(<LoadingState label="Loading the schedule…" />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('aria-atomic', 'true');
    advance(9999);
    expect(status).not.toHaveTextContent('longer than usual');
    advance(1);
    expect(screen.getByRole('status')).toBe(status);
    expect(status).toHaveTextContent('This is taking longer than usual.');
    expect(status).toHaveTextContent('still waiting for a response.');
    advance(50000);
    expect(screen.getByRole('status')).toBe(status);
    expect(status).toHaveTextContent('We haven’t received a result after a minute.');
    expect(status).toHaveTextContent('You can keep waiting.');
    expect(status).not.toHaveTextContent('longer than usual');
    expect(container.querySelector('.loading-status')).toHaveAttribute('data-loading-stage', 'prolonged');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(status.textContent).not.toContain('%');
  });

  it('offers retry only when a caller explicitly supplies it, and starts a new wait', () => {
    const onRetry = vi.fn();
    const { container } = render(<LoadingState onRetry={onRetry} />);
    advance(59999);
    expect(screen.queryByRole('button', { name: 'Try loading again' })).not.toBeInTheDocument();
    advance(1);
    fireEvent.click(screen.getByRole('button', { name: 'Try loading again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Try loading again' })).not.toBeInTheDocument();
    expect(container.querySelector('.loading-status__activity')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Loading…');
    advance(1000);
    expect(container.querySelector('.loading-status__activity')).toBeInTheDocument();
  });

  it('keeps waiting without suggesting an implicit reload when no retry is supplied', () => {
    render(<LoadingState />);
    advance(60000);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('You can keep waiting.');
  });

  it('clears every scheduled update when content replaces the loader', () => {
    const { rerender, container } = render(<LoadingState />);
    expect(vi.getTimerCount()).toBe(3);
    advance(1000);
    expect(container.querySelector('.loading-status__activity')).toBeInTheDocument();
    rerender(<h2>The schedule</h2>);
    expect(vi.getTimerCount()).toBe(0);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(container.querySelector('.loading-status__activity')).toBeNull();
  });

  it.each(['rows', 'schedule', 'directory'])('keeps %s placeholders decorative and reserves the requested rows', (shape) => {
    const { container } = render(<LoadingState shape={shape} rows={3} />);
    const reserved = container.querySelector('.loading-state__placeholder');
    expect(reserved).toHaveAttribute('data-loading-shape', shape);
    expect(reserved).toHaveAttribute('aria-hidden', 'true');
    expect(reserved.querySelectorAll('.loading-state__row')).toHaveLength(3);
    expect(reserved.textContent).toBe('');
    expect(reserved.querySelector('a, button, input, [tabindex]')).toBeNull();
    expect(screen.getByRole('status')).not.toContainElement(reserved);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('can render only the task label without reserving content space', () => {
    const { container } = render(<LoadingState rows={0} />);
    expect(container.querySelector('.loading-state__placeholder')).toBeNull();
    expect(screen.getByRole('status')).toHaveAccessibleName('Loading…');
  });

  it('previews the same layout and late explanation without starting request timers', () => {
    const { container } = render(<LoadingStateView shape="directory" stage="prolonged" />);
    expect(container.querySelector('.loading-state')).toHaveAttribute('data-loading-shape', 'directory');
    expect(screen.getByRole('status')).toHaveTextContent('after a minute');
    expect(vi.getTimerCount()).toBe(0);
  });
});
