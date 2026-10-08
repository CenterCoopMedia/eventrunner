import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import EventFigures from './EventFigures.jsx';

function show(isOperator) {
  render(<MemoryRouter><EventFigures stats={{ errors: { unresolved: 0 } }} isOperator={isOperator} /></MemoryRouter>);
}

describe('actionable overview figures', () => {
  it('keeps system error details out of the staff action path', () => {
    show(false);
    const health = screen.getByRole('article', { name: 'System health' });
    expect(health).toHaveTextContent('0 unresolved errors');
    expect(within(health).queryByRole('link')).not.toBeInTheDocument();
    expect(health).toHaveTextContent('Only operators can open the error details.');
    expect(screen.getByRole('link', { name: /Manage attendees/ })).toHaveAttribute('href', '/admin/attendees');
  });
  it('offers operators the existing error page without making new reads', () => {
    show(true);
    expect(screen.getByRole('link', { name: /Review system errors/ })).toHaveAttribute('href', '/admin/system-errors');
    expect(screen.getAllByRole('article')).toHaveLength(5);
    expect(screen.getByRole('article', { name: 'Tickets' })).toHaveTextContent('One ticket record, not one seat.');
  });
});
