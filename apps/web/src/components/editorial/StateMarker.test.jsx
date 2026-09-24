// StateMarker: a word, an ink, and a rule. Never a pill.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import StateMarker from './StateMarker.jsx';
import { renderInEveryStyle } from '../../test/everyStyle.jsx';

describe('StateMarker', () => {
  it('renders the word with the tone class and no pill', () => {
    render(<StateMarker tone="live">Running now</StateMarker>);
    const mark = screen.getByText('Running now');
    expect(mark).toHaveClass('state-marker', 'state-marker--live');
    expect(mark.className).not.toMatch(/rounded|bg-/u);
  });

  it('takes the past tone for a finished session', () => {
    render(<StateMarker tone="past">Finished</StateMarker>);
    expect(screen.getByText('Finished')).toHaveClass('state-marker--past');
  });

  it('falls back to the plain tone for one it does not know', () => {
    render(<StateMarker tone="soon">Next</StateMarker>);
    expect(screen.getByText('Next')).toHaveClass('state-marker--next');
  });

  it('draws nothing without a word, because the word is the signal', () => {
    const { container } = render(<StateMarker tone="live">{''}</StateMarker>);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders in every style and both modes', () => {
    renderInEveryStyle(<StateMarker tone="live">Running now</StateMarker>, (container, pair) => {
      expect(container.querySelector('.state-marker')?.textContent, `${pair.style} ${pair.mode}`).toBe('Running now');
    });
  });
});
