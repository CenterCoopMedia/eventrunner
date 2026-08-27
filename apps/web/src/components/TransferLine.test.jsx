// TransferLine — the sentence that may only be said from a record.
//
// The old version of this line compared two room strings and printed a
// transfer nobody had recorded. It was deleted. These tests pin the shape
// that makes the mistake unrepeatable: this component is handed a fact or
// it is handed nothing, and it invents neither half.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import TransferLine from './TransferLine.jsx';

const MOVEMENT = {
  from: { id: 'fx-hall', name: '[Fixture] Main hall', floor: 'Ground floor' },
  to: { id: 'fx-lab', name: '[Fixture] Editing lab', floor: 'Second floor' },
  walkingMinutes: 6,
  accessibleRoute: '[Fixture] Lift by the cloakroom, then right.',
};

describe('TransferLine', () => {
  it('states where you are, where it is, and how long it takes', () => {
    render(<TransferLine movement={MOVEMENT} />);
    expect(
      screen.getByText(
        /Transfer from \[Fixture\] Main hall to \[Fixture\] Editing lab, Second floor — 6 min walk/,
      ),
    ).toBeInTheDocument();
  });

  it('renders nothing at all when handed no movement', () => {
    // The whole safety property: no record, no sentence. There is no
    // estimate and no placeholder to leak an unearned claim through.
    const { container } = render(<TransferLine movement={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('states the step-free route in the operator’s words', () => {
    render(<TransferLine movement={MOVEMENT} />);
    expect(
      screen.getByText(/Step-free route: \[Fixture\] Lift by the cloakroom, then right\./),
    ).toBeInTheDocument();
  });

  it('says nothing about a step-free route nobody surveyed', () => {
    // Absent must read as silence, never as "there isn't one" — an
    // invented assurance is the one failure with a person on the end of it.
    render(<TransferLine movement={{ ...MOVEMENT, accessibleRoute: null }} />);
    expect(screen.queryByText(/Step-free/)).toBeNull();
    expect(screen.getByText(/6 min walk/)).toBeInTheDocument();
  });

  it('reads a recorded zero as under a minute, not as "0 min"', () => {
    // Zero is a recorded answer meaning "across the corridor". The field is
    // whole minutes, so this is a reading of the number stated rather than
    // a number invented — and "0 min walk" reads like a bug.
    render(<TransferLine movement={{ ...MOVEMENT, walkingMinutes: 0 }} />);
    expect(screen.getByText(/under a minute’s walk/)).toBeInTheDocument();
    expect(screen.queryByText(/0 min/)).toBeNull();
  });

  it('leaves the floor out when the destination states none', () => {
    render(
      <TransferLine
        movement={{ ...MOVEMENT, to: { id: 'fx-annex', name: '[Fixture] Annex' } }}
      />,
    );
    expect(screen.getByText(/to \[Fixture\] Annex — 6 min walk/)).toBeInTheDocument();
  });

  it('labels both signs with the words beside them, never the drawing alone', () => {
    // "A route mark or wayfinding icon without a text label is a puzzle,
    // not a sign" — so the drawings are aria-hidden and the sentence
    // carries the meaning.
    const { container } = render(<TransferLine movement={MOVEMENT} />);
    const icons = [...container.querySelectorAll('[data-wayfinding-icon]')];
    expect(icons.map((icon) => icon.dataset.wayfindingIcon)).toEqual(['walk', 'step-free']);
    for (const icon of icons) expect(icon).toHaveAttribute('aria-hidden', 'true');
  });
});
