// EmptyState — a plain sentence under a hairline rule, with generous space
// and no card (design brief §2.1, §2.4). No box, no rounded panel, no fill
// color: the rule does the dividing work a card border used to.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import EmptyState from './EmptyState.jsx';

describe('EmptyState', () => {
  it('renders the title as a level-2 heading', () => {
    render(<EmptyState title="No sessions yet" />);
    expect(screen.getByRole('heading', { level: 2, name: 'No sessions yet' })).toBeInTheDocument();
  });

  it('opens the block with a hairline rule, not a card', () => {
    const { container } = render(<EmptyState title="No sessions yet" />);
    expect(container.querySelector('.border-t-hairline')).not.toBeNull();
    // No card chrome: no border box, no rounded panel, no fill color.
    expect(container.querySelector('.rounded-brand-lg')).toBeNull();
    expect(container.querySelector('.bg-brand-surface-alt')).toBeNull();
  });

  it('renders the description only when one is given', () => {
    const { rerender } = render(<EmptyState title="No sessions yet" />);
    expect(screen.queryByText(/appear here/)).toBeNull();

    rerender(
      <EmptyState
        title="No sessions yet"
        description="Sessions appear here once they are published."
      />,
    );
    expect(screen.getByText('Sessions appear here once they are published.')).toBeInTheDocument();
  });

  it('renders the action only when one is given', () => {
    const { rerender, container } = render(<EmptyState title="No sessions yet" />);
    expect(container.querySelector('a, button')).toBeNull();

    rerender(
      <EmptyState
        title="No sessions yet"
        action={<a href="/schedule">Go to the schedule</a>}
      />,
    );
    expect(screen.getByRole('link', { name: 'Go to the schedule' })).toBeInTheDocument();
  });

  it('carries the empty-state motif above the sentence', () => {
    // Brief §3.8's fourth slot, and the third and last place the public
    // site renders a motif. It renders nothing under the `none` set, which
    // is four of the six presets (index.css holds that gate).
    const { container } = render(<EmptyState title="No sessions yet" />);
    const motif = container.querySelector('[data-motif-slot="empty-state"]');
    expect(motif).not.toBeNull();
    expect(motif).toHaveAttribute('aria-hidden', 'true');
    expect(motif.compareDocumentPosition(container.querySelector('h2'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('keeps document order rule, then heading, then description, then action', () => {
    const { container } = render(
      <EmptyState
        title="No sessions yet"
        description="Sessions appear here once they are published."
        action={<a href="/schedule">Go to the schedule</a>}
      />,
    );
    const nodes = [...container.querySelectorAll('.border-t-hairline, h2, p, a')];
    expect(nodes.map((node) => node.tagName)).toEqual(['DIV', 'H2', 'P', 'A']);
  });
});
