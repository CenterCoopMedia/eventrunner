// Byline and Dateline: who, in what role, and when, on the event's clock.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Byline, { Dateline } from './Byline.jsx';
import { renderInEveryStyle } from '../../test/everyStyle.jsx';

const inRouter = (node) => render(<MemoryRouter>{node}</MemoryRouter>);

describe('Byline', () => {
  it('names the person and their role in one line', () => {
    const { container } = inRouter(<Byline name="Marisol Reyes" role="opening speaker" />);
    expect(container.textContent).toBe('Marisol Reyes, opening speaker');
    expect(container.firstChild).toHaveClass('byline');
  });

  it('links the name where it has somewhere to go', () => {
    inRouter(<Byline name="Marisol Reyes" role="opening speaker" href="/speakers/marisol-reyes" />);
    expect(screen.getByRole('link', { name: 'Marisol Reyes' })).toHaveAttribute('href', '/speakers/marisol-reyes');
  });

  it('renders nothing without a name', () => {
    const { container } = inRouter(<Byline name="" role="editor" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders in every style and both modes', () => {
    renderInEveryStyle(<Byline name="Marisol Reyes" role="opening speaker" />, (container, pair) => {
      expect(container.querySelector('.byline__name'), `${pair.style} ${pair.mode}`).not.toBeNull();
    });
  });
});

describe('Dateline', () => {
  it('carries a machine-readable time and the label the caller formatted on the event clock', () => {
    const { container } = render(
      <Dateline dateTime="2026-10-14T13:00:00.000Z" label="14 October 2026, 09:00" zone="EDT" />,
    );
    const time = container.querySelector('time');
    expect(time).toHaveAttribute('dateTime', '2026-10-14T13:00:00.000Z');
    expect(time.textContent).toBe('14 October 2026, 09:00');
    expect(container.textContent).toBe('14 October 2026, 09:00 EDT');
    expect(container.firstChild).toHaveClass('byline');
  });

  it('renders nothing without a label', () => {
    const { container } = render(<Dateline dateTime="2026-10-14" label="" />);
    expect(container).toBeEmptyDOMElement();
  });
});
