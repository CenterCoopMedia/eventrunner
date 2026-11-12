import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import HelpTooltip from './HelpTooltip.jsx';
import { TextField } from './formControls.jsx';

describe('staff help tooltips', () => {
  it('describes the field and help button while closed, then opens on focus and dismisses with Escape', () => {
    render(<TextField label="Track" value="" onChange={() => {}} help="Choose a program topic." hint="Saving…" error="Choose one." />);
    expect(screen.getByRole('textbox', { name: 'Track' })).toHaveAccessibleDescription('Choose a program topic. Saving… Choose one.');
    const help = screen.getByRole('button', { name: 'Help with Track' });
    expect(help).toHaveAccessibleDescription('Choose a program topic.');
    expect(screen.queryByRole('tooltip', { hidden: true })).not.toBeInTheDocument();
    fireEvent.focus(help);
    expect(screen.getByRole('tooltip', { hidden: true })).toHaveTextContent('Choose a program topic.');
    fireEvent.keyDown(help, { key: 'Escape' });
    expect(screen.queryByRole('tooltip', { hidden: true })).not.toBeInTheDocument();
    expect(help).toHaveAccessibleDescription('Choose a program topic.');
  });

  it('keeps hovered help readable across the trigger gap and accepts Escape without focus', () => {
    vi.useFakeTimers();
    try {
      render(<HelpTooltip label="Schedule">Use the event’s local clock.</HelpTooltip>);
      const help = screen.getByRole('button', { name: 'Help with Schedule' });
      fireEvent.pointerEnter(help);
      const tooltip = screen.getByRole('tooltip', { hidden: true });
      fireEvent.pointerLeave(help);
      fireEvent.pointerEnter(tooltip);
      vi.advanceTimersByTime(200);
      expect(tooltip).toBeInTheDocument();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('tooltip', { hidden: true })).not.toBeInTheDocument();
    } finally { vi.useRealTimers(); }
  });

  it('keeps help inside a native modal and closes on an outside press', () => {
    render(<dialog open><HelpTooltip label="Refund">Review the affected tickets.</HelpTooltip></dialog>);
    fireEvent.focus(screen.getByRole('button', { name: 'Help with Refund' }));
    const tooltip = screen.getByRole('tooltip', { hidden: true });
    expect(tooltip.closest('dialog')).toBe(screen.getByRole('dialog'));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('tooltip', { hidden: true })).not.toBeInTheDocument();
  });

  it('adds no trigger for a self-explanatory field', () => {
    render(<TextField label="Email" value="" onChange={() => {}} data-help-skip="The label names the email address." />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
