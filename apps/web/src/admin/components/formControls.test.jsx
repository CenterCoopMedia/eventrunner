// The copy bench and the destructive moment
// (docs/plans/2026-08-27-admin-identity-story.md, part 2 and moment 3).
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import {
  DestructiveConfirm,
  ServerErrorSummary,
  TextField,
  dangerButtonClass,
  primaryButtonClass,
} from './formControls.jsx';

describe('the copy bench', () => {
  it('runs on the admin tokens, never on the client theme', () => {
    const { container } = render(<TextField label="Page id" value="faq" onChange={() => {}} />);
    expect(container.innerHTML).not.toMatch(/brand-|rounded-brand|font-(heading|body)\b/);
    expect(screen.getByLabelText('Page id')).toHaveClass('bg-admin-ground-input');
  });

  it('keeps the label above its own input — a control label is not an eyebrow', () => {
    render(<TextField label="Path" hint="Where the page is served." value="" onChange={() => {}} />);
    const label = screen.getByText('Path');
    const input = screen.getByLabelText('Path');
    expect(label.tagName).toBe('LABEL');
    expect(label.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('draws a field boundary that clears 3:1, not the hairline rule', () => {
    // WCAG 1.4.11 again, on the admin side: --admin-rule-hairline is tuned
    // for row separators and does not clear the bar against the input
    // ground, so a control's boundary is --admin-rule-strong.
    render(<TextField label="Title" value="" onChange={() => {}} />);
    expect(screen.getByLabelText('Title')).toHaveClass('border-admin-rule-strong');
    expect(screen.getByLabelText('Title')).not.toHaveClass('border-admin-rule-hairline');
  });

  it('shows a field error as a mark and a word, never as colour alone', () => {
    render(<TextField label="Title" value="" onChange={() => {}} error="Title is required" />);
    const input = screen.getByLabelText('Title');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/Title is required/)).toBeInTheDocument();
  });
});

describe('the query', () => {
  it('renders the server’s message verbatim, in an alert, focusable', () => {
    render(
      <ServerErrorSummary
        error={{ message: 'theme.colors.primary: must be a hex color, got "teal"' }}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('theme.colors.primary: must be a hex color, got "teal"');
    expect(alert).toHaveAttribute('tabindex', '-1');
    expect(alert.className).toContain('bg-admin-ground-alarm');
    expect(alert.className).toContain('border-admin-rule-alarm');
  });
});

describe('a destructive moment', () => {
  const props = {
    trigger: 'Delete this page',
    confirmLabel: 'Delete this page',
    consequence: 'The live page and its draft both go. Nothing on the public site links to it after that.',
    permanence: 'This cannot be undone.',
  };

  it('states what is lost before it does anything', () => {
    const onConfirm = vi.fn();
    render(<DestructiveConfirm {...props} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete this page' }));
    expect(screen.getByText(/The live page and its draft both go/)).toBeInTheDocument();
    expect(screen.getByText(/This cannot be undone/)).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete this page' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('repeats the consequence in the button and stands still', () => {
    render(<DestructiveConfirm {...props} onConfirm={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete this page' }));

    const confirm = screen.getByRole('button', { name: 'Delete this page' });
    // Never "Confirm": the button repeats what it will do.
    expect(confirm.className).toBe(dangerButtonClass);
    // And never an oversized primary action — the destructive button is the
    // same size as every other button in the room (§2.4, moment 3).
    for (const size of ['px-sm', 'py-2xs', 'text-caption']) {
      expect(dangerButtonClass).toContain(size);
      expect(primaryButtonClass).toContain(size);
    }
    // Nothing animates in a destructive moment.
    expect(document.body.innerHTML).not.toMatch(/animate-|transition-|duration-/);
  });

  it('lets an operator back out', () => {
    const onConfirm = vi.fn();
    render(<DestructiveConfirm {...props} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete this page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));

    expect(screen.queryByText(/This cannot be undone/)).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
