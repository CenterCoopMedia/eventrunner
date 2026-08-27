// LoadingState — loading is a stated line, not a loop (design brief §2.2:
// ambient animation is banned outright, so a loading skeleton cannot pulse).
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import LoadingState from './LoadingState.jsx';

describe('LoadingState', () => {
  it('renders the label as plain, static text with no animation', () => {
    render(<LoadingState label="Loading the schedule…" />);
    const status = screen.getByRole('status', { name: 'Loading the schedule…' });
    expect(status).toHaveTextContent('Loading the schedule…');
    expect(status.className).not.toMatch(/animate-|pulse/);
    const { container } = render(<LoadingState label="Loading the schedule…" />);
    expect(container.querySelectorAll('[class*="animate-"]')).toHaveLength(0);
  });

  it('defaults to a plain "Loading…" line', () => {
    render(<LoadingState />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
  });
});
