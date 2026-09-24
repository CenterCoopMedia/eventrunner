// Progress: a native <progress> with the fraction stated beside it.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import Progress, { progressStatement } from './Progress.jsx';
import { renderInEveryStyle } from '../test/everyStyle.jsx';

describe('Progress', () => {
  it('is a native progress element, never a meter and never a ring', () => {
    const { container } = render(<Progress value={3} max={5} />);
    const bar = container.querySelector('progress');
    expect(bar).not.toBeNull();
    expect(bar).toHaveAttribute('value', '3');
    expect(bar).toHaveAttribute('max', '5');
    expect(container.querySelector('meter')).toBeNull();
    expect(container.querySelector('svg, circle')).toBeNull();
  });

  it('states the fraction in words beside the bar, and the bar is named by it', () => {
    const { container } = render(<Progress value={3} max={5} />);
    const label = screen.getByText((content, element) => element.tagName === 'P' && element.textContent === '3 of 5 tasks done');
    expect(container.querySelector('progress')).toHaveAttribute('aria-labelledby', label.id);
    expect(screen.getByRole('progressbar')).toHaveAccessibleName('3 of 5 tasks done');
  });

  it('sets the figures in the mono face with tabular figures', () => {
    const { container } = render(<Progress value={3} max={5} />);
    const figures = [...container.querySelectorAll('[data-numeric]')];
    expect(figures.map((node) => node.textContent)).toEqual(['3', '5']);
    for (const figure of figures) expect(figure).toHaveClass('font-mono');
  });

  it('names what is counted and the word for a finished one', () => {
    render(<Progress value={2} max={4} unit="files" done="sent" />);
    expect(screen.getByRole('progressbar')).toHaveAccessibleName('2 of 4 files sent');
    expect(progressStatement(1, 3, 'fields', 'complete')).toBe('1 of 3 fields complete');
  });

  it('clamps a value outside the range rather than drawing past the bar', () => {
    const { container } = render(<Progress value={9} max={5} />);
    expect(container.querySelector('progress')).toHaveAttribute('value', '5');
    expect(screen.getByRole('progressbar')).toHaveAccessibleName('5 of 5 tasks done');
  });

  it('renders in every style and both modes', () => {
    renderInEveryStyle(<Progress value={1} max={2} />, (container, pair) => {
      expect(container.querySelector('progress.progress-bar'), `${pair.style} ${pair.mode}`).not.toBeNull();
    });
  });
});
