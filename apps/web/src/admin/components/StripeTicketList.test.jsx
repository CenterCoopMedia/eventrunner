import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import StripeTicketList from './StripeTicketList.jsx';

describe('StripeTicketList order filters', () => {
  it('finds the orders that need organizer attention by order state', async () => {
    const call = vi.fn(async () => ({ orders: [], nextCursor: null }));
    render(<StripeTicketList call={call} kind="orders" catalog={null} timezone="UTC" refreshToken={0} onOpenOrder={vi.fn()} />);
    await waitFor(() => expect(call).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Order state'), { target: { value: 'exception' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(call).toHaveBeenLastCalledWith('ticketingCommerceAdmin', { action: 'orders', limit: 25, status: 'exception' }));
  });
});
