import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import StripeTicketList from './StripeTicketList.jsx';
import StripeOrderDetail from './StripeOrderDetail.jsx';
import StripeCompPanel from './StripeCompPanel.jsx';
import StripeCheckInPanel from './StripeCheckInPanel.jsx';
import StripeCatalogPanel from './StripeCatalogPanel.jsx';

const TYPE = { id: 'general', name: 'General admission', description: '', unitAmount: 2500, capacity: 100, active: true, visibility: 'public', minPerOrder: 1, maxPerOrder: 10, salesStartAt: null, salesEndAt: null };
const CATALOG = { schemaVersion: 1, revision: 1, published: true, salesPaused: true, currency: 'usd', capacity: 100, maxPerOrder: 10, refundPolicy: 'Contact the organizer.', taxTreatment: 'inclusive', commercialTermsConfirmed: true, salesStartAt: null, salesEndAt: null, ticketTypes: [TYPE] };
const TICKET = { externalId: 'opaque-seat-1', id: 'opaque-seat-1', orderId: 'order-1', ticketTypeId: 'general', ticketClass: 'General admission', firstName: 'Synthetic', lastName: 'Attendee', email: 'attendee@example.test', status: 'valid', claimedByUid: null, checkedInAt: null };
const ORDER = { id: 'order-1', orderId: 'order-1', purchaserEmail: 'purchaser@example.test', paymentStatus: 'succeeded', refundStatus: 'none', totalAmount: 2500, currency: 'usd', createdAt: '2026-01-01T12:00:00Z' };
const DETAIL = { order: ORDER, tickets: [TICKET], audit: [], stripeDashboardUrl: 'https://dashboard.stripe.com/acct_synthetic/test/payments/pi_synthetic' };
const call = vi.fn();

beforeEach(() => {
  call.mockReset();
  call.mockImplementation(async (_name, body) => {
    if (body.action === 'order') return DETAIL;
    if (body.action === 'orders') return { orders: [ORDER], nextCursor: null };
    if (body.action === 'tickets') return { tickets: [TICKET], nextCursor: null };
    return DETAIL;
  });
});

describe('organizer order management', () => {
  it('requires an action-time cancellation review with the order, selected ticket, money, and admission consequences', async () => {
    render(<StripeOrderDetail call={call} orderId="order-1" isOperator timezone="UTC" onChanged={vi.fn()} onClose={vi.fn()} />);
    await screen.findByRole('button', { name: 'Correct attendee' });
    fireEvent.click(screen.getByRole('checkbox', { name: /Select Synthetic Attendee/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Review ticket cancellation' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/No refund payment is created/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Original payment: \$25\.00/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Sold seats will not be returned/)).toBeInTheDocument();
    expect(call.mock.calls.some(([, body]) => body.action === 'cancelTickets')).toBe(false);
    fireEvent.change(within(dialog).getByLabelText('Reason for this action'), { target: { value: 'Attendee cannot attend.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel 1 admission tickets' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('ticketingCommerceAdmin', { action: 'cancelTickets', orderId: 'order-1', ticketIds: ['opaque-seat-1'], reason: 'Attendee cannot attend.', confirmed: true }));
  });
  it('locks email corrections on an already claimed ticket and does not expose ticket transfers', async () => {
    call.mockResolvedValue({ ...DETAIL, tickets: [{ ...TICKET, claimedByUid: 'holder' }] });
    render(<StripeOrderDetail call={call} orderId="order-1" isOperator timezone="UTC" onChanged={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Correct attendee' }));
    expect(screen.getByLabelText('Corrected attendee email')).toHaveAttribute('readonly');
    expect(screen.getByText(/claimed ticket cannot change email/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Transfer ticket/ })).not.toBeInTheDocument();
  });
  it('locks the email on an already checked-in unclaimed ticket', async () => {
    call.mockResolvedValue({ ...DETAIL, tickets: [{ ...TICKET, checkedInAt: '2026-01-02T10:00:00Z' }] });
    render(<StripeOrderDetail call={call} orderId="order-1" isOperator timezone="UTC" onChanged={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Correct attendee' }));
    expect(screen.getByLabelText('Corrected attendee email')).toHaveAttribute('readonly');
    expect(screen.getByText(/checked-in ticket cannot change email/)).toBeInTheDocument();
  });
  it('surfaces reconciliation exceptions and dispute ownership without changing admission', async () => {
    call.mockResolvedValue({ ...DETAIL, order: { ...ORDER, reconciliationException: { code: 'payment-disputed', message: 'A dispute needs an organizer decision.' }, disputes: [{ id: 'dp_synthetic', status: 'needs_response', amount: 2500, currency: 'usd' }] } });
    render(<StripeOrderDetail call={call} orderId="order-1" isOperator timezone="UTC" onChanged={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText('A dispute needs an organizer decision.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Payment disputes' })).toBeInTheDocument();
    expect(screen.getByText(/A dispute does not automatically change admission/)).toBeInTheDocument();
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('keeps refund money in Stripe Dashboard with an account and mode-specific link', async () => {
    render(<StripeOrderDetail call={call} orderId="order-1" isOperator timezone="UTC" onChanged={vi.fn()} onClose={vi.fn()} />);
    const link = await screen.findByRole('link', { name: /Open this payment in Stripe Dashboard/ });
    expect(link).toHaveAttribute('href', DETAIL.stripeDashboardUrl);
    expect(link).toHaveAccessibleName(/opens in a new tab/);
    expect(screen.queryByRole('button', { name: /^Refund payment$/ })).not.toBeInTheDocument();
  });
  it('allows an operator to record an amount-only partial refund without removing tickets', async () => {
    call.mockResolvedValue({ ...DETAIL, order: { ...ORDER, refundStatus: 'partial', refunds: [{ id: 'refund-1', amount: 500, currency: 'usd', status: 'succeeded', createdAt: '2026-01-02T12:00:00Z' }] } });
    render(<StripeOrderDetail call={call} orderId="order-1" isOperator timezone="UTC" onChanged={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText('Refund to allocate'), { target: { value: 'refund-1' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Keep every ticket valid' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review refund allocation' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/All ticket admission stays/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Reason for this action'), { target: { value: 'Organizer approved a price adjustment.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record refund with admission retained' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('ticketingCommerceAdmin', expect.objectContaining({ action: 'allocateRefund', refundId: 'refund-1', ticketIds: [], preserveAdmission: true, confirmed: true })));
  });
});

describe('complimentary tickets and online check-in', () => {
  it('keeps a comp request id stable if the confirmed issue request must be retried', async () => {
    call.mockRejectedValue(new Error('The network response was lost.'));
    render(<StripeCompPanel call={call} catalog={CATALOG} onComplete={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Comp ticket type'), { target: { value: 'general' } });
    for (const [label, value] of [['First name', 'Synthetic'], ['Last name', 'Attendee'], ['Attendee email', 'comp@example.test'], ['Reason for complimentary admission', 'Speaker admission.']]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Review complimentary tickets' }));
    expect(call).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Charge: \$0\.00/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Issue 1 complimentary tickets' }));
    await screen.findByText('The network response was lost.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Issue 1 complimentary tickets' }));
    await waitFor(() => expect(call).toHaveBeenCalledTimes(2));
    expect(call.mock.calls[0][1]).toEqual(call.mock.calls[1][1]);
    expect(call.mock.calls[0][1]).toMatchObject({ action: 'issueComp', confirmed: true, requestId: expect.any(String), attendees: [{ firstName: 'Synthetic', lastName: 'Attendee', email: 'comp@example.test' }] });
  });
  it('states duplicate scans and requires operator confirmation before undoing a check-in', async () => {
    call.mockResolvedValue({ result: 'already_checked_in', ticket: { ...TICKET, checkedInAt: '2026-01-03T10:00:00Z' } });
    render(<StripeCheckInPanel call={call} isOperator timezone="UTC" onChanged={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Ticket code for check-in'), { target: { value: TICKET.externalId } });
    fireEvent.click(screen.getByRole('button', { name: 'Check in attendee' }));
    expect(await screen.findByText(/This scan did not create another check-in/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review check-in correction' }));
    expect(call).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText('Reason for check-in correction'), { target: { value: 'Test scan before attendee arrival.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Undo recorded check-in' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('ticketingCheckIn', { ticketId: 'opaque-seat-1', action: 'undo', reason: 'Test scan before attendee arrival.', confirmed: true }));
  });
  it('does not show staff an operator-only check-in correction', async () => {
    call.mockResolvedValue({ result: 'checked_in', ticket: { ...TICKET, checkedInAt: '2026-01-03T10:00:00Z' } });
    render(<StripeCheckInPanel call={call} isOperator={false} timezone="UTC" onChanged={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Ticket code for check-in'), { target: { value: TICKET.externalId } });
    fireEvent.click(screen.getByRole('button', { name: 'Check in attendee' }));
    await screen.findByText('Checked in. Admit this attendee.');
    expect(screen.queryByRole('button', { name: 'Review check-in correction' })).not.toBeInTheDocument();
  });
});

describe('catalog precision and cursor isolation', () => {
  it('refuses a price with excessive precision instead of silently rounding money', () => {
    render(<StripeCatalogPanel call={call} data={{ catalog: CATALOG, mode: 'test' }} isOperator timezone="UTC" onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Price (USD)'), { target: { value: '12.345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save catalog' }));
    expect(screen.getByLabelText('Price (USD)')).toHaveAttribute('aria-invalid', 'true');
    expect(call).not.toHaveBeenCalled();
  });
  it('requires an explicit reload before replacing a catalog changed elsewhere', () => {
    const props = { call, data: { catalog: CATALOG }, isOperator: true, timezone: 'UTC', onSaved: vi.fn() };
    const { rerender } = render(<StripeCatalogPanel {...props} />);
    fireEvent.change(screen.getByLabelText('Ticket name'), { target: { value: 'Local unsaved change' } });
    rerender(<StripeCatalogPanel {...props} data={{ catalog: { ...CATALOG, revision: 2, salesPaused: false } }} />);
    expect(screen.getByLabelText('Ticket name')).toHaveValue('Local unsaved change');
    fireEvent.click(screen.getByRole('button', { name: 'Save catalog' }));
    expect(call).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Discard unsaved edits and reload catalog' })).toBeInTheDocument();
  });
  it('uses the submitted filters for the next page even if a search field has unsaved text', async () => {
    call.mockResolvedValue({ orders: [ORDER], nextCursor: 'cursor-page-2' });
    render(<StripeTicketList call={call} kind="orders" catalog={CATALOG} timezone="UTC" refreshToken={0} onOpenOrder={vi.fn()} />);
    await screen.findByText('order-1');
    fireEvent.change(screen.getByLabelText('Find a purchaser or order'), { target: { value: 'purchaser@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search orders' }));
    await waitFor(() => expect(call).toHaveBeenCalledTimes(2));
    await screen.findByText('order-1');
    fireEvent.change(screen.getByLabelText('Find a purchaser or order'), { target: { value: 'different@example.test' } });
    call.mockResolvedValueOnce({ orders: [{ ...ORDER, id: 'order-2', orderId: 'order-2' }], nextCursor: null });
    fireEvent.click(screen.getByRole('button', { name: 'Load more orders' }));
    await waitFor(() => expect(call).toHaveBeenLastCalledWith('ticketingCommerceAdmin', { action: 'orders', limit: 25, search: 'purchaser@example.test', cursor: 'cursor-page-2' }));
  });
  it('ignores a stale search response after a newer filter was submitted', async () => {
    let resolveFirst;
    call.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
    call.mockResolvedValue({ orders: [{ ...ORDER, orderId: 'new-order', id: 'new-order' }], nextCursor: null });
    render(<StripeTicketList call={call} kind="orders" catalog={CATALOG} timezone="UTC" refreshToken={0} onOpenOrder={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Find a purchaser or order'), { target: { value: 'new@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search orders' }));
    await screen.findByText('new-order');
    await act(async () => resolveFirst({ orders: [ORDER], nextCursor: 'old-cursor' }));
    expect(screen.queryByText('order-1')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more orders' })).not.toBeInTheDocument();
  });
});
