// Avatar: square on the brand radius, an initial where there is no picture.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import Avatar, { initialOf } from './Avatar.jsx';
import { renderInEveryStyle } from '../../test/everyStyle.jsx';

describe('Avatar', () => {
  it('draws the picture with an empty alt when the name is text beside it', () => {
    const { container } = render(<Avatar src="https://example.test/p.png" name="Rae Okonkwo" />);
    const image = container.querySelector('img');
    expect(image).toHaveAttribute('alt', '');
    expect(image).toHaveClass('avatar', 'avatar--md');
  });

  it('is never a circle: the radius is the contract token, and no class rounds it fully', () => {
    const { container } = render(<Avatar src="https://example.test/p.png" name="Rae Okonkwo" />);
    expect(container.querySelector('img').className).not.toMatch(/rounded-full/u);
  });

  it('falls back to the initial in a hidden stand-in', () => {
    render(<Avatar src={null} name="rae okonkwo" />);
    const stub = screen.getByText('R');
    expect(stub).toHaveAttribute('aria-hidden', 'true');
    expect(stub).toHaveClass('avatar');
  });

  it('reports a failed load to the caller, which decides what to draw instead', () => {
    const onError = vi.fn();
    const { container } = render(<Avatar src="https://example.test/gone.png" name="Rae" onError={onError} />);
    fireEvent.error(container.querySelector('img'));
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('takes the three sizes a surface asks for', () => {
    const { container } = render(<Avatar src={null} name="Rae" size="lg" />);
    expect(container.firstChild).toHaveClass('avatar--lg');
  });

  it('spells the initial from the first letter, and a question mark from nothing', () => {
    expect(initialOf('  Émile')).toBe('É');
    expect(initialOf('')).toBe('?');
    expect(initialOf(undefined)).toBe('?');
  });

  it('renders in every style and both modes', () => {
    renderInEveryStyle(<Avatar src={null} name="Rae Okonkwo" />, (container, pair) => {
      expect(container.querySelector('.avatar')?.textContent, `${pair.style} ${pair.mode}`).toBe('R');
    });
  });
});
