import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const state = vi.hoisted(() => ({ auth: { user: { uid: 'owner-a', email: 'owner@example.test', emailVerified: true }, loading: false }, event: { name: 'Synthetic event', timezone: 'UTC', historicalDemo: false } }));
vi.mock('../contexts/AuthContext.jsx', () => ({ useAuth: () => state.auth, functionsOrigin: () => 'https://functions.example.test' }));
vi.mock('../contexts/EventConfigContext.jsx', () => ({ useEventConfig: () => ({ eventConfig: state.event }) }));
vi.mock('../components/SignInPanel.jsx', () => ({ default: () => <p>Inline verified sign-in</p> }));
vi.mock('../lib/ticketingCommerce.js', async (original) => ({ ...await original(), ticketingRequest: vi.fn() }));
import { ticketingRequest } from '../lib/ticketingCommerce.js';
import TicketStatus from './TicketStatus.jsx';
import MyTickets from './MyTickets.jsx';

const TICKET = { externalId: 'opaque-ticket-synthetic', orderId: 'order-synthetic', ticketClass: 'General admission', firstName: 'Synthetic', lastName: 'Attendee', email: 'attendee@example.test', status: 'valid', claimedByMe: false };
const ORDER = { orderId: 'order-synthetic', status: 'paid', paymentStatus: 'succeeded', currency: 'usd', subtotalAmount: 2500, totalAmount: 2500, lines: [{ ticketTypeId: 'general', name: 'General admission', quantity: 1, unitAmount: 2500, lineAmount: 2500 }], tickets: [TICKET], refundStatus: 'none', refundedAmount: 0 };
const surface = () => <MemoryRouter initialEntries={['/tickets/status?orderId=order-synthetic&success=true']}><TicketStatus /></MemoryRouter>;

describe('authoritative order status and attendee confirmation', () => {
  beforeEach(() => {
    sessionStorage.clear();
    state.auth = { user: { uid: 'owner-a', email: 'owner@example.test', emailVerified: true }, loading: false };
    state.event = { name: 'Synthetic event', timezone: 'UTC', historicalDemo: false };
    ticketingRequest.mockReset();
    ticketingRequest.mockResolvedValue(ORDER);
  });
  it('requires purchaser sign-in even if a return URL contains an order and success flag', () => {
    state.auth.user = null;
    render(surface());
    expect(screen.getByText('Inline verified sign-in')).toBeInTheDocument();
    expect(screen.queryByText(TICKET.externalId)).not.toBeInTheDocument();
    expect(ticketingRequest).not.toHaveBeenCalled();
  });
  it('does not treat a success redirect, pending payment, or unverified ticket array as fulfillment', async () => {
    ticketingRequest.mockResolvedValue({ ...ORDER, status: 'pending', paymentStatus: 'pending', checkoutUrl: null });
    render(surface());
    expect(await screen.findByRole('heading', { name: 'We are confirming your order' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Your order is confirmed' })).not.toBeInTheDocument();
    expect(screen.queryByText(TICKET.externalId)).not.toBeInTheDocument();
    expect(screen.getByText(/Returning|Closing Stripe/)).toBeInTheDocument();
  });
  it('shows authoritative paid tickets with opaque printable codes and an explicit verified claim path', async () => {
    render(surface());
    expect(await screen.findByRole('heading', { name: 'Your order is confirmed' })).toBeInTheDocument();
    expect(screen.getByText(TICKET.externalId)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Print tickets' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Claim this ticket with the attendee’s account' })).toHaveAttribute('href', '/ticket/claim?order=order-synthetic');
    expect(ticketingRequest).toHaveBeenCalledTimes(1);
    expect(ticketingRequest).toHaveBeenCalledWith('ticketingOrderStatus', expect.objectContaining({ query: { orderId: 'order-synthetic' }, user: state.auth.user }));
  });
  it('confirms a validated free order without describing its payment as a card charge', async () => {
    ticketingRequest.mockResolvedValue({ ...ORDER, status: 'free', totalAmount: 0, subtotalAmount: 0 });
    render(surface());
    await screen.findByRole('heading', { name: 'Your order is confirmed' });
    expect(screen.getByText('No payment required')).toBeInTheDocument();
    expect(screen.getByText(TICKET.externalId)).toBeInTheDocument();
  });
  it('keeps refunded tickets visible as invalid rather than showing a paid pass', async () => {
    ticketingRequest.mockResolvedValue({ ...ORDER, status: 'refunded', refundStatus: 'full', refundedAmount: 2500, tickets: [{ ...TICKET, status: 'refunded' }] });
    render(surface());
    await screen.findByRole('heading', { name: 'Your order has been refunded' });
    expect(screen.getByText('This ticket does not currently grant admission.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Claim this ticket with the attendee’s account' })).not.toBeInTheDocument();
  });
  it('immediately hides the prior purchaser’s data when the signed-in account changes', async () => {
    const { rerender } = render(surface());
    await screen.findByText(TICKET.externalId);
    ticketingRequest.mockImplementation(() => new Promise(() => {}));
    state.auth = { ...state.auth, user: { uid: 'owner-b', email: 'other@example.test', emailVerified: true } };
    rerender(surface());
    expect(screen.queryByText(TICKET.externalId)).not.toBeInTheDocument();
    expect(screen.queryByText('Synthetic Attendee')).not.toBeInTheDocument();
  });
  it('rejects a late private response for an account that has signed out', async () => {
    let resolve;
    ticketingRequest.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const { rerender } = render(surface());
    state.auth.user = null;
    rerender(surface());
    await act(async () => resolve(ORDER));
    expect(screen.getByText('Inline verified sign-in')).toBeInTheDocument();
    expect(screen.queryByText(TICKET.externalId)).not.toBeInTheDocument();
  });
  it('keeps a failed card attempt on its existing checkout while the Session remains open', async () => {
    ticketingRequest.mockResolvedValue({ ...ORDER, status: 'pending', paymentStatus: 'failed', tickets: [], checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_synthetic' });
    render(surface());
    await screen.findByRole('heading', { name: 'We are confirming your order' });
    expect(screen.getByText(/Your latest payment attempt failed/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue your existing Stripe checkout' })).toHaveAttribute('href', 'https://checkout.stripe.com/c/pay/cs_test_synthetic');
    expect(screen.queryByRole('button', { name: 'Start a separate order' })).not.toBeInTheDocument();
    expect(ticketingRequest.mock.calls.filter(([name]) => name === 'ticketingCheckout')).toHaveLength(0);
  });
  it('recovers a pending order by its owner-scoped reference on a different device', async () => {
    ticketingRequest.mockResolvedValue({ ...ORDER, status: 'pending', paymentStatus: 'pending', tickets: [], checkoutUrl: null });
    render(surface());
    fireEvent.click(await screen.findByRole('button', { name: 'Recover existing checkout' }));
    await waitFor(() => expect(ticketingRequest).toHaveBeenCalledWith('ticketingCheckout', expect.objectContaining({ user: state.auth.user, body: { orderId: ORDER.orderId, resume: true } })));
    expect(JSON.parse(sessionStorage.getItem('eventrunner.ticket-checkout.owner-a')).orderId).toBe(ORDER.orderId);
  });
});

describe('recipient ticket page', () => {
  beforeEach(() => {
    state.event.historicalDemo = false;
    state.auth = { user: { uid: 'recipient', email: 'attendee@example.test', emailVerified: true }, loading: false };
    ticketingRequest.mockReset();
  });
  it('signs a recipient in without requesting purchaser order details', () => {
    state.auth.user = null;
    render(<MemoryRouter><MyTickets /></MemoryRouter>);
    expect(screen.getByText('Inline verified sign-in')).toBeInTheDocument();
    expect(ticketingRequest).not.toHaveBeenCalled();
  });
  it('prints the recipient’s ticket while keeping purchaser amounts off the page', async () => {
    ticketingRequest.mockResolvedValue({ tickets: [{ ...TICKET, claimedByMe: true }] });
    render(<MemoryRouter><MyTickets /></MemoryRouter>);
    await screen.findByText(TICKET.externalId);
    expect(screen.getByText('Claimed by your account.')).toBeInTheDocument();
    expect(screen.queryByText('Original total')).not.toBeInTheDocument();
    expect(screen.queryByText('$25.00')).not.toBeInTheDocument();
    expect(ticketingRequest).toHaveBeenCalledWith('ticketingMyTickets', expect.objectContaining({ user: state.auth.user, body: {} }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh tickets' }));
    await waitFor(() => expect(ticketingRequest).toHaveBeenCalledTimes(2));
  });
  it('appends the next claimed-ticket page without requesting purchaser financial details', async () => {
    ticketingRequest.mockResolvedValueOnce({ tickets: [{ ...TICKET, claimedByMe: true }], nextCursor: TICKET.externalId });
    ticketingRequest.mockResolvedValueOnce({ tickets: [{ ...TICKET, externalId: 'opaque-ticket-next', claimedByMe: true }], nextCursor: null });
    render(<MemoryRouter><MyTickets /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Load more tickets' }));
    await screen.findByText('opaque-ticket-next');
    expect(screen.getByText(TICKET.externalId)).toBeInTheDocument();
    expect(ticketingRequest).toHaveBeenLastCalledWith('ticketingMyTickets', expect.objectContaining({ body: { cursor: TICKET.externalId } }));
    expect(screen.queryByRole('button', { name: 'Load more tickets' })).not.toBeInTheDocument();
  });
});
