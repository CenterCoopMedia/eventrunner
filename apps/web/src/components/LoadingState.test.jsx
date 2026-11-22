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
    const status = screen.getByRole('status');
    const copy = screen.getByText('Loading the schedule…');
    expect(copy.closest('[aria-hidden="true"]')).toBeInTheDocument();
    expect(status).toBeEmptyDOMElement();
    expect(container.querySelector('.held-figure')).toBeNull();
    advance(999);
    expect(status).toBeEmptyDOMElement();
    expect(container.querySelector('.held-figure')).toBeNull();
    advance(1);
    const activity = container.querySelector('.held-figure');
    expect(activity).toHaveAttribute('aria-hidden', 'true');
    expect(copy.closest('[aria-hidden="true"]')).toBeNull();
    expect(status).not.toContainElement(activity);
    expect(screen.getByRole('status')).toBe(status);
    expect(status.textContent).toBe('Loading the schedule…');
  });

  it('updates the same polite status after ten seconds and after a minute', () => {
    const { container } = render(<LoadingState label="Loading the schedule…" />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('aria-atomic', 'true');
    const mutations = new MutationObserver(() => {});
    mutations.observe(status, { childList: true, characterData: true, subtree: true });
    expect(status).toBeEmptyDOMElement();
    for (const [elapsed, message] of [
      [1000, 'Loading the schedule…'],
      [9000, 'This is taking longer than usual. We’re still waiting for a response.'],
      [50000, 'We haven’t received a result after a minute. You can keep waiting.'],
    ]) {
      advance(elapsed - 1);
      expect(mutations.takeRecords()).toHaveLength(0);
      advance(1);
      expect(screen.getByRole('status')).toBe(status);
      expect(status.textContent).toBe(message);
      expect(mutations.takeRecords()).toHaveLength(1);
    }
    mutations.disconnect();
    expect(container.querySelector('.loading-status')).toHaveAttribute('data-loading-stage', 'prolonged');
    expect(container.querySelector('.loading-status__label').closest('[aria-hidden="true"]')).toBeNull();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(status.textContent).not.toContain('%');
  });

  it('offers retry only when a caller explicitly supplies it, and starts a new wait', () => {
    const onRetry = vi.fn();
    const { container } = render(<LoadingState label="Loading the schedule…" onRetry={onRetry} />);
    advance(59999);
    expect(screen.queryByRole('button', { name: 'Try loading again' })).not.toBeInTheDocument();
    advance(1);
    fireEvent.click(screen.getByRole('button', { name: 'Try loading again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Try loading again' })).not.toBeInTheDocument();
    expect(container.querySelector('.held-figure')).toBeNull();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    advance(1000);
    expect(container.querySelector('.held-figure')).toBeInTheDocument();
    expect(screen.getByRole('status').textContent).toBe('Loading the schedule…');
  });

  it('keeps waiting without suggesting an implicit reload when no retry is supplied', () => {
    render(<LoadingState label="Loading the schedule…" />);
    advance(60000);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('You can keep waiting.');
  });

  it('keeps a reserved block silent until recovery without taking the visible figure', () => {
    const heldUp = vi.fn();
    globalThis.addEventListener('eventrunner:held-up', heldUp);
    try {
      const { container } = render(<LoadingState placeholder={<div data-testid="reserved-block" />} recover onRetry={() => {}} />);
      advance(10_000);
      expect(screen.getByTestId('reserved-block')).toBeInTheDocument();
      expect(container.querySelector('.held-figure')).toBeNull();
      expect(heldUp).not.toHaveBeenCalled();

      advance(50_000);
      expect(screen.queryByTestId('reserved-block')).toBeNull();
      expect(screen.getByRole('status')).toHaveTextContent('This is taking longer than a minute.');
      expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
      expect(heldUp).not.toHaveBeenCalled();
    } finally {
      globalThis.removeEventListener('eventrunner:held-up', heldUp);
    }
  });

  it('clears every scheduled update when content replaces the loader', () => {
    const { rerender, container } = render(<LoadingState label="Loading the schedule…" />);
    expect(vi.getTimerCount()).toBe(3);
    advance(1000);
    expect(container.querySelector('.held-figure')).toBeInTheDocument();
    rerender(<h2>The schedule</h2>);
    expect(vi.getTimerCount()).toBe(0);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(container.querySelector('.held-figure')).toBeNull();
  });

  it('clears a settled result when the current result changes without a new wait', () => {
    const empty = 'You have no tickets for this account.';
    const { rerender } = render(<LoadingState label="Loading your tickets…" completion="" />);
    const status = screen.getByRole('status');
    advance(400);
    rerender(<LoadingState active={false} label="Loading your tickets…" completion={empty} />);
    expect(status).toHaveTextContent(empty);
    rerender(<LoadingState active={false} label="Loading your tickets…" completion="Your tickets are ready." />);
    expect(status).toBeEmptyDOMElement();
    rerender(<LoadingState active={false} label="Loading your tickets…" completion={empty} />);
    expect(status).toBeEmptyDOMElement();
  });

  it.each(['rows', 'schedule', 'directory'])('keeps %s placeholders decorative and reserves the requested rows', (shape) => {
    const { container } = render(<LoadingState label="Loading the schedule…" shape={shape} rows={3} />);
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
    const { container } = render(<LoadingState label="Loading the schedule…" rows={0} />);
    expect(container.querySelector('.loading-state__placeholder')).toBeNull();
    expect(screen.getByText('Loading the schedule…')).toBeVisible();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('previews the same layout and late explanation without starting request timers', () => {
    const { container } = render(<LoadingStateView label="Loading the schedule…" shape="directory" stage="prolonged" still />);
    expect(container.querySelector('.loading-state')).toHaveAttribute('data-loading-shape', 'directory');
    expect(screen.getByText(/after a minute/)).toBeVisible();
    expect(screen.queryByRole('status')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
