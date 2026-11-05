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

  it('replaces the icon with a spinner and keeps the busy action named', () => {
    const { rerender } = render(<AdminIconControl label="Refresh" icon="refresh" />);
    const button = screen.getByRole('button', { name: 'Refresh' });
    expect(button.querySelector('svg')).toBeInTheDocument();
    rerender(<AdminIconControl label="Refreshing…" icon="refresh" busy aria-busy="true" aria-disabled="true" />);
    expect(button).toHaveAccessibleName('Refreshing…');
    expect(button.querySelector('svg')).toBeNull();
    expect(button.querySelector('.admin-busy-mark')).toHaveAttribute('aria-hidden', 'true');
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    fireEvent.focus(button);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Refreshing…');
    rerender(<AdminIconControl label="Refresh" icon="refresh" />);
    expect(button.querySelector('.admin-busy-mark')).toBeNull();
    expect(button.querySelector('svg')).toBeInTheDocument();
  });
});
