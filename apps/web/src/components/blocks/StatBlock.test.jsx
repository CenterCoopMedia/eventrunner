// StatBlock renders BOTH stat shapes (design brief §2.1.1, PR1 half).
//
// PR1 gives stat blocks their editorial treatment and renders the four-part
// contract where the fields exist. It enforces nothing: a legacy block keeps
// rendering, and no content is dropped because a part is missing. The
// schema, the editor fields, the seed migration, and write-time enforcement
// land in PR3.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatBlock from './StatBlock.jsx';

const LEGACY = { blockType: 'stat', value: '420', label: 'Attendees expected' };

const FULL = {
  blockType: 'stat',
  value: '38',
  label: 'sessions',
  takeaway: 'Two thirds of sessions are workshops',
  description: 'Counts every published session across the three programme days.',
  source: 'Session records, read 27 August 2026.',
  alt: 'Two of every three published sessions are workshops.',
};

describe('StatBlock — legacy shape', () => {
  it('renders the figure and its label as a definition pair', () => {
    const { container } = render(<StatBlock block={LEGACY} />);
    expect(container.querySelector('dd').textContent).toBe('420');
    expect(container.querySelector('dt').textContent).toBe('Attendees expected');
  });

  it('reads the figure in tabular figures', () => {
    const { container } = render(<StatBlock block={LEGACY} />);
    expect(container.querySelector('dd')).toHaveAttribute('data-numeric');
  });

  it('opens with a hairline instead of a card', () => {
    const { container } = render(<StatBlock block={LEGACY} />);
    expect(container.firstChild).toHaveClass('border-t-hairline', 'border-t-rule-hairline');
    expect(container.firstChild.className).not.toContain('rounded-brand-lg');
  });

  it('renders nothing when half the legacy pair is missing', () => {
    const { container } = render(<StatBlock block={{ value: '420' }} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('StatBlock — four-part contract', () => {
  it('leads on the takeaway, in words', () => {
    const { container } = render(<StatBlock block={FULL} />);
    expect(container.querySelector('dt').textContent).toBe(
      'Two thirds of sessions are workshops',
    );
  });

  it('renders the description and the source line', () => {
    render(<StatBlock block={FULL} />);
    expect(
      screen.getByText('Counts every published session across the three programme days.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Session records, read 27 August 2026.')).toBeInTheDocument();
  });

  it('adds the alt text for a screen reader without hiding the figure', () => {
    const { container } = render(<StatBlock block={FULL} />);
    const alt = screen.getByText('Two of every three published sessions are workshops.');
    expect(alt).toHaveClass('sr-only');
    // The number stays in the accessibility tree: alt text describes the
    // finding, it does not replace the block's own content.
    expect(container.textContent).toContain('38');
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it('renders a partial four-part block rather than dropping it (PR1)', () => {
    // A block mid-migration carries a takeaway and nothing else. PR3
    // enforces the contract; PR1 never drops content over it.
    render(<StatBlock block={{ takeaway: 'Registration doubled', value: '2x' }} />);
    expect(screen.getByText('Registration doubled')).toBeInTheDocument();
    expect(screen.getByText(/2x/)).toBeInTheDocument();
  });

  it('renders nothing at all for an empty block', () => {
    const { container } = render(<StatBlock block={{}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('ignores whitespace-only fields', () => {
    const { container } = render(<StatBlock block={{ value: '  ', label: '  ' }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
