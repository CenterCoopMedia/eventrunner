// LoadingState — loading is a stated line, not a loop (design brief §2.2:
// ambient animation is banned outright, so a loading skeleton cannot pulse).
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import LoadingState from './LoadingState.jsx';

describe('LoadingState', () => {
  it('renders the label as plain, static text with no animation', () => {
    const { container } = render(<LoadingState label="Loading the schedule…" />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Loading the schedule…');
    expect(container.querySelectorAll('[class*="animate-"]')).toHaveLength(0);
    expect(container.innerHTML).not.toMatch(/animate-|pulse|shimmer|spin/);
  });

  it('defaults to a plain "Loading…" line', () => {
    render(<LoadingState />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
  });

  it('holds the space the content will take, in hairline rules', () => {
    // Without the reserved block the page reflows when the content lands,
    // and a reader who had started reading loses their place. The rows are
    // rules, not a skeleton: nothing imitates a heading or a photograph.
    const { container } = render(<LoadingState rows={4} />);
    const rows = container.querySelectorAll('.border-t-hairline');
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row.className).toContain('border-rule-hairline');
  });

  it('keeps the reserved block out of the announcement', () => {
    // The stated line says everything. The rows are shape, so a screen
    // reader is not walked through four empty items.
    const { container } = render(<LoadingState />);
    const reserved = container.querySelector('[aria-hidden="true"]');
    expect(reserved).not.toBeNull();
    expect(reserved.querySelectorAll('.border-t-hairline')).toHaveLength(3);
  });

  it('can hold no space at all where a caller wants only the line', () => {
    const { container } = render(<LoadingState rows={0} />);
    expect(container.querySelectorAll('.border-t-hairline')).toHaveLength(0);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
