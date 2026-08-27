// Callout — the one tilted handwritten line a Zine page may carry (design
// brief §4.3; visual story, Zine, moment 3).
//
// The stylesheet side of the device — the token font, the fixed angle, the
// Zine-only tilt — is checked in stamp.test.js beside the other Zine
// bindings. What is checked here is the thing only the component can get
// wrong: a callout is a SENTENCE, not a drawing, so it stays in the
// document and in the accessibility tree.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import Callout from './Callout.jsx';

describe('Callout', () => {
  it('renders real copy as real text, never as a decoration', () => {
    const { container } = render(<Callout>Doors at nine. Bring a pen.</Callout>);
    expect(screen.getByText('Doors at nine. Bring a pen.')).toBeInTheDocument();
    expect(container.firstChild).toHaveClass('callout');
    expect(container.firstChild).not.toHaveAttribute('aria-hidden');
    expect(container.querySelector('svg')).toBeNull();
  });

  it('renders nothing rather than an empty tilted line', () => {
    expect(render(<Callout>{null}</Callout>).container.firstChild).toBeNull();
    expect(render(<Callout>{''}</Callout>).container.firstChild).toBeNull();
    expect(render(<Callout />).container.firstChild).toBeNull();
  });
});
