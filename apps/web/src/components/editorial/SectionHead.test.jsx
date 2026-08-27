// SectionHead — the section boundary, and the component that makes the
// eyebrow ban (design brief §2.4) structurally impossible to break.
//
// The folio must come AFTER the heading in the DOM and sit beside it on the
// rule. A folio stacked above a heading is an eyebrow, and it is rejected at
// every size, on every surface, in every preset — so that ordering is the
// assertion this file exists for.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import SectionHead from './SectionHead.jsx';

describe('SectionHead', () => {
  it('renders the title as a heading at the level it was given', () => {
    render(<SectionHead title="Dates" id="dates" level={2} />);
    const heading = screen.getByRole('heading', { level: 2, name: 'Dates' });
    expect(heading).toHaveAttribute('id', 'dates');
  });

  it('puts the folio after the heading, never above it', () => {
    const { container } = render(<SectionHead title="Day one" folio="Thursday, October 15" />);
    const nodes = [...container.querySelectorAll('h2, .folio')];
    expect(nodes[0].tagName).toBe('H2');
    expect(nodes[nodes.length - 1].textContent).toBe('Thursday, October 15');
  });

  it('opens the boundary with the strong section rule by default', () => {
    const { container } = render(<SectionHead title="Dates" />);
    expect(container.querySelector('.section-rule')).not.toBeNull();
  });

  it('draws a hairline or no rule at all when asked', () => {
    const { container: hairline } = render(<SectionHead title="Dates" rule="hairline" />);
    expect(hairline.querySelector('.section-rule')).toBeNull();
    expect(hairline.querySelector('.border-t-hairline')).not.toBeNull();

    const { container: none } = render(<SectionHead title="Dates" rule="none" />);
    expect(none.querySelector('.section-rule')).toBeNull();
    expect(none.querySelector('.border-t-hairline')).toBeNull();
  });

  it('sets the heading itself in the folio face for a standing head', () => {
    // The schedule day head: the folio IS the heading, so the label sits on
    // the rule and the document outline still has a real h2.
    render(<SectionHead variant="folio" title="Day one" folio="Thursday, October 15" />);
    expect(screen.getByRole('heading', { level: 2, name: 'Day one' })).toHaveClass('folio');
  });

  it('renders without a folio at all', () => {
    const { container } = render(<SectionHead title="Dates" />);
    expect(container.querySelectorAll('.folio')).toHaveLength(0);
  });

  it('clamps an out-of-range level rather than emitting a bogus tag', () => {
    render(<SectionHead title="Dates" level={9} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Dates' })).toBeInTheDocument();
  });
});
