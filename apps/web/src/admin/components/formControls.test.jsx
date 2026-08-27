// The copy bench and the destructive moment
// (docs/plans/2026-08-27-admin-identity-story.md, part 2 and moment 3).
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import {
  DestructiveConfirm,
  FieldError,
  Panel,
  ServerErrorSummary,
  TextField,
  dangerButtonClass,
  primaryButtonClass,
} from './formControls.jsx';

describe('a ruled region of the stone', () => {
  it('is a ruled, tinted region — never a floating card', () => {
    const { container } = render(<Panel title="Days">body</Panel>);
    const panel = container.querySelector('section');

    expect(panel.className).toContain('border-admin-rule-hairline');
    expect(panel.className).toContain('bg-admin-ground-raised');
    expect(panel.className).toContain('p-md');
    // Elevation in this room is tint. No shadow family ships.
    expect(panel.className).not.toMatch(/shadow/);
  });

  it('drops its own padding when flush, so a galley runs to the rule', () => {
    // `p-0` in className cannot do this: Tailwind emits the named spacing
    // steps after the numeric ones, so `p-md` would win the cascade and the
    // hairline rows would sit inset from the panel edge.
    const { container } = render(
      <Panel flush>
        <ul />
      </Panel>,
    );
    const panel = container.querySelector('section');

    expect(panel.className).not.toMatch(/\bp-md\b/);
    expect(panel.className).toContain('border-admin-rule-hairline');
  });
});

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

  it('gives a hand-built field the same rejection the built ones get', () => {
    // The room has fields this file does not build — an image slot, a file
    // input, a group of checkboxes. They render FieldError rather than their
    // own spelling of it, so a rejected field looks the same everywhere.
    const built = render(
      <TextField label="Title" value="" onChange={() => {}} error="Title is required" />,
    );
    const hand = render(<FieldError message="Title is required" />);
    const paragraph = (view) => view.container.querySelector('p.text-admin-state-error');
    expect(paragraph(hand)?.className).toBe(paragraph(built)?.className);
  });

  it('announces a rejection only where it is asked to', () => {
    // A page with several fields announces once, through the server error
    // summary; several alerts at once is noise. A surface with one thing to
    // reject and no summary asks for the alert here.
    const quiet = render(<FieldError message="No file chosen" />);
    expect(quiet.container.querySelector('p')).not.toHaveAttribute('role');
    const loud = render(<FieldError message="No file chosen" role="alert" />);
    expect(loud.container.querySelector('p')).toHaveAttribute('role', 'alert');
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
