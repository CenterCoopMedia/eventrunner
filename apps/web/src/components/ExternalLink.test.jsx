// The new-tab marker: one sentence, in the link's own name.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import ExternalLink, { NEW_TAB_NOTE, NewTabNote } from './ExternalLink.jsx';

describe('ExternalLink', () => {
  it('opens a new tab and severs the opener', () => {
    render(<ExternalLink href="https://example.test/tickets">Get a ticket</ExternalLink>);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  it('carries the sentence inside the link name, not beside it', () => {
    // A note outside the link is read after the reader has already followed
    // it. It has to be part of the name.
    render(<ExternalLink href="https://example.test/tickets">Get a ticket</ExternalLink>);
    expect(screen.getByRole('link')).toHaveAccessibleName(`Get a ticket (${NEW_TAB_NOTE})`);
  });

  it('keeps the sentence out of the visible words', () => {
    render(<ExternalLink href="https://example.test/tickets">Get a ticket</ExternalLink>);
    expect(screen.getByRole('link').textContent).toContain('Get a ticket');
    expect(screen.getByText(new RegExp(NEW_TAB_NOTE)).className).toContain('sr-only');
  });

  it('passes the class and every other attribute through', () => {
    render(
      <ExternalLink href="https://example.test/x" className="quiet" data-testid="cta">
        Read it
      </ExternalLink>,
    );
    expect(screen.getByTestId('cta')).toHaveClass('quiet');
  });

  it('offers the same sentence to a call site with its own anchor', () => {
    render(
      <a href="https://example.test/x" target="_blank" rel="noreferrer">
        Read it
        <NewTabNote />
      </a>,
    );
    expect(screen.getByRole('link')).toHaveAccessibleName(`Read it (${NEW_TAB_NOTE})`);
  });
});
