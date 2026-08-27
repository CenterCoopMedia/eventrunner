// Folio and Rule — the two smallest editorial devices (design brief §2.1).
//
// A folio is text plus rule: never a chip, never a pill, never a colored
// badge. The rule beside it is decorative, so it stays out of the
// accessibility tree.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import Folio from './Folio.jsx';
import Rule from './Rule.jsx';

describe('Folio', () => {
  it('sets the label in the small-caps folio face on a rule', () => {
    const { container } = render(<Folio>Day one</Folio>);
    const label = container.querySelector('.folio');
    expect(label.textContent).toBe('Day one');
    // The face is --folio-font's job, not a utility's: Zine's struck folio
    // moves it to the mono role, and `font-data` would outrank the token.
    expect(label.className).not.toContain('font-data');
    expect(container.querySelector('.folio__rule')).not.toBeNull();
  });

  it('stores the copy in natural case and leaves the small caps to CSS', () => {
    // Interface guidelines, Typography: copy is stored in natural case and
    // presentation is text-transform's job — so the DOM text is what an
    // editor typed, not an uppercased copy of it.
    render(<Folio>Back issue</Folio>);
    expect(screen.getByText('Back issue')).toBeInTheDocument();
  });

  it('keeps the rule out of the accessibility tree', () => {
    const { container } = render(<Folio>Day one</Folio>);
    expect(container.querySelector('.folio__rule')).toHaveAttribute('aria-hidden', 'true');
  });

  it('drops the rule on request, for a margin or running-header folio', () => {
    const { container } = render(<Folio rule={false}>Page 2</Folio>);
    expect(container.querySelector('.folio__rule')).toBeNull();
  });

  it('can carry the heading itself when the folio IS the section head', () => {
    render(
      <Folio as="h2" id="day-1">
        Day one
      </Folio>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Day one' })).toHaveAttribute(
      'id',
      'day-1',
    );
  });
});

describe('Rule', () => {
  it('draws a hairline by default and stays out of the accessibility tree', () => {
    const { container } = render(<Rule />);
    const rule = container.firstChild;
    expect(rule).toHaveClass('border-t-hairline', 'border-t-rule-hairline');
    expect(rule).toHaveAttribute('aria-hidden', 'true');
  });

  it('draws the strong weight through the section-rule contract', () => {
    const { container } = render(<Rule weight="strong" />);
    expect(container.firstChild).toHaveClass('section-rule');
  });

  it('draws the nameplate weight from the nameplate rule tokens', () => {
    const { container } = render(<Rule weight="nameplate" />);
    expect(container.firstChild).toHaveClass('border-t-nameplate', 'border-t-rule-nameplate');
  });

  it('falls back to a hairline for an unknown weight', () => {
    const { container } = render(<Rule weight="wobbly" />);
    expect(container.firstChild).toHaveClass('border-t-hairline');
  });

  it('is never an <hr>: these rules divide a layout, not a document', () => {
    const { container } = render(<Rule />);
    expect(container.querySelector('hr')).toBeNull();
  });
});
