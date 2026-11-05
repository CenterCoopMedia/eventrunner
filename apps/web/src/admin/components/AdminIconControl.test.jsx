import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { NavLink } from 'react-router';
import AdminIconControl from './AdminIconControl.jsx';

describe('compact utility controls', () => {
  it('keeps the action named without visible button text and explains it on keyboard focus', () => {
    const onClick = vi.fn();
    render(<AdminIconControl label="Hide menu" icon="collapse" onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Hide menu' });
    expect(button).toHaveTextContent('');
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    fireEvent.focus(button);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Hide menu');
    expect(button).toHaveAccessibleName('Hide menu');
    fireEvent.keyDown(button, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('keeps link semantics for site navigation and dismisses the hint on blur', () => {
    render(<MemoryRouter><AdminIconControl as={NavLink} to="/" label="View site" icon="globe" /></MemoryRouter>);
    const link = screen.getByRole('link', { name: 'View site' });
    expect(link).toHaveAttribute('href', '/');
    fireEvent.focus(link);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.blur(link);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
