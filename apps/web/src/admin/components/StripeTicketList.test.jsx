import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import StripeTicketList from './StripeTicketList.jsx';

describe('StripeTicketList order filters', () => {
  it('names each order and ticket action even when the buyer and order repeat', async () => {
    const onOpenOrder = vi.fn();
    const call = vi.fn(async (_name, { action }) => action === 'orders' ? {
      orders: ['ord-1', 'ord-2'].map((id) => ({ id, purchaserEmail: 'buyer@example.org' })),
    } : {
      tickets: ['seat-1', 'seat-2'].map((id) => ({ id, orderId: 'ord-1', email: 'buyer@example.org', status: 'valid', claimedByUid: 'holder' })),
    });
    render(<>
      <StripeTicketList call={call} kind="orders" catalog={null} timezone="UTC" refreshToken={0} onOpenOrder={onOpenOrder} />
      <StripeTicketList call={call} kind="tickets" catalog={null} timezone="UTC" refreshToken={0} onOpenOrder={onOpenOrder} />
    </>);
    for (const name of [
      'View order ord-1 for buyer@example.org', 'View order ord-2 for buyer@example.org',
      'View order for ticket seat-1', 'View order for ticket seat-2',
    ]) fireEvent.click(await screen.findByRole('button', { name }));
    expect(screen.getAllByRole('button', { name: /^View order / })).toHaveLength(4);
    expect(onOpenOrder.mock.calls).toEqual([['ord-1'], ['ord-2'], ['ord-1'], ['ord-1']]);
  });

  it('finds the orders that need organizer attention by order state', async () => {
    const call = vi.fn(async () => ({ orders: [], nextCursor: null }));
    render(<StripeTicketList call={call} kind="orders" catalog={null} timezone="UTC" refreshToken={0} onOpenOrder={vi.fn()} />);
    await waitFor(() => expect(call).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Order state'), { target: { value: 'exception' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(call).toHaveBeenLastCalledWith('ticketingCommerceAdmin', { action: 'orders', limit: 25, status: 'exception' }));
  });
});

describe('StripeTicketList create account from ticket', () => {
  const ROWS = [
    { id: 'ord-1_0_0', externalId: 'ord-1_0_0', orderId: 'ord-1', email: 'ada@example.com', status: 'valid', claimedByUid: null },
    { id: 'ord-1_0_1', externalId: 'ord-1_0_1', orderId: 'ord-1', email: 'bo@example.com', status: 'valid', claimedByUid: 'uid-bo' },
    { id: 'ord-2_0_0', externalId: 'ord-2_0_0', orderId: 'ord-2', email: 'cy@example.com', status: 'cancelled', claimedByUid: null },
  ];

  it('offers the action on an unclaimed valid ticket and marks the row claimed after success', async () => {
    const call = vi.fn(async (name) => {
      if (name === 'createUserFromTicket') return { ok: true, uid: 'new-1', created: true, registrationStatus: 'ticketed' };
      return { tickets: ROWS, nextCursor: null };
    });
    render(<StripeTicketList call={call} kind="tickets" catalog={null} timezone="UTC" refreshToken={0} onOpenOrder={vi.fn()} />);
    const actions = await screen.findAllByRole('button', { name: /^Create account for / });
    expect(actions).toHaveLength(1);

    fireEvent.click(actions[0]);
    const dialog = screen.getByRole('dialog', { name: 'Create an account from this ticket?' });
    expect(dialog).toHaveTextContent('ada@example.com');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create account and claim ticket' }));

    expect(await screen.findByText('Account created for ada@example.com. The ticket is claimed.')).toBeInTheDocument();
    expect(call).toHaveBeenCalledWith('createUserFromTicket', { externalId: 'ord-1_0_0' });
    expect(screen.queryByRole('button', { name: /^Create account for / })).not.toBeInTheDocument();
    const row = screen.getByText('ada@example.com').closest('tr');
    expect(within(row).getByText('Claimed')).toBeInTheDocument();
  });
});
