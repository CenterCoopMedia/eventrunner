import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const state = vi.hoisted(() => ({ auth: { user: { uid: 'purchaser-a', email: 'purchaser@example.test', emailVerified: true }, loading: false }, event: { name: 'Synthetic event', timezone: 'UTC', historicalDemo: false, registration: {} } }));
vi.mock('../contexts/AuthContext.jsx', () => ({ useAuth: () => state.auth, functionsOrigin: () => 'https://functions.example.test' }));
vi.mock('../contexts/EventConfigContext.jsx', () => ({ useEventConfig: () => ({ eventConfig: state.event }) }));
vi.mock('../components/SignInPanel.jsx', () => ({ default: () => <p>Inline verified sign-in</p> }));
vi.mock('../lib/ticketingCommerce.js', async (original) => ({ ...await original(), ticketingRequest: vi.fn() }));
import { ticketingRequest, TicketingRequestError } from '../lib/ticketingCommerce.js';
import Tickets from './Tickets.jsx';

const CATALOG = {
  provider: 'stripe', mode: 'test', salesEnabled: true, currency: 'usd', eventName: 'Synthetic event', maxPerOrder: 3,
  refundPolicy: 'Contact the organizer before the event for a refund.', taxTreatment: 'inclusive',
  ticketTypes: [{ id: 'general', name: 'General admission', description: 'Full event', unitAmount: 2500, available: true, remaining: 3, minPerOrder: 1, maxPerOrder: 3 }],
};
function Location() { const location = useLocation(); return <p>Location: {location.pathname}{location.search}</p>; }
function mount() { return render(<MemoryRouter initialEntries={['/tickets']}><Routes><Route path="/tickets" element={<Tickets />} /><Route path="*" element={<Location />} /></Routes></MemoryRouter>); }
async function fill(quantity = 1) {
  await screen.findByLabelText('Quantity — General admission');
  fireEvent.change(screen.getByLabelText('Quantity — General admission'), { target: { value: String(quantity) } });
  for (let index = 0; index < quantity; index += 1) {
    fireEvent.change(screen.getAllByLabelText('First name')[index], { target: { value: 'Synthetic' } });
    fireEvent.change(screen.getAllByLabelText('Last name')[index], { target: { value: `Attendee ${index + 1}` } });
    fireEvent.change(screen.getAllByLabelText('Attendee email')[index], { target: { value: `attendee-${index + 1}@example.test` } });
  }
  fireEvent.click(screen.getByRole('checkbox', { name: 'I have read and accept the refund policy' }));
}

describe('attendee ticket selection', () => {
  beforeEach(() => {
    sessionStorage.clear();
    state.auth = { user: { uid: 'purchaser-a', email: 'purchaser@example.test', emailVerified: true }, loading: false };
    state.event = { name: 'Synthetic event', timezone: 'UTC', historicalDemo: false, registration: {} };
    ticketingRequest.mockReset();
    ticketingRequest.mockImplementation(async (name) => name === 'ticketingCatalog' ? CATALOG : { orderId: 'order-synthetic', status: 'pending', paymentStatus: 'pending', checkoutUrl: null });
  });
  it('requires verified sign-in before revealing purchase controls', async () => {
    state.auth.user = null;
    mount();
    expect(await screen.findByText('Inline verified sign-in')).toBeInTheDocument();
    expect(screen.queryByLabelText('Quantity — General admission')).not.toBeInTheDocument();
    expect(ticketingRequest).not.toHaveBeenCalledWith('ticketingCheckout', expect.anything());
  });
  it('never starts account or payment work from the historical demo', async () => {
    state.event.historicalDemo = true;
    mount();
    expect(screen.getByText(/Ticket sales and payments are unavailable/)).toBeInTheDocument();
    expect(ticketingRequest).not.toHaveBeenCalled();
  });
  it('preserves the configured external registration path for other providers', async () => {
    state.event.registration = { externalUrl: 'https://register.example.test/event', actionLabel: 'Register with the organizer' };
    ticketingRequest.mockResolvedValue({ provider: 'manual' });
    mount();
    expect(await screen.findByRole('link', { name: 'Register with the organizer' })).toHaveAttribute('href', 'https://register.example.test/event');
    expect(screen.queryByRole('button', { name: /Continue to Stripe/ })).not.toBeInTheDocument();
  });
  it('validates attendee identity and refund terms, focusing the field that needs correction', async () => {
    mount();
    await screen.findByLabelText('Quantity — General admission');
    fireEvent.change(screen.getByLabelText('Quantity — General admission'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /Continue to Stripe/ }));
    expect(screen.getByLabelText('First name')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('First name')).toHaveFocus();
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-invalid', 'true');
    expect(ticketingRequest.mock.calls.filter(([name]) => name === 'ticketingCheckout')).toHaveLength(0);
  });
  it('shows a complete total and submits identities and quantities without trusting browser prices', async () => {
    mount();
    await fill(2);
    expect(screen.getByRole('button', { name: 'Continue to Stripe — $50.00' })).toBeInTheDocument();
    expect(screen.getByText(CATALOG.refundPolicy)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Stripe — $50.00' }));
    await screen.findByText('Location: /tickets/status?orderId=order-synthetic');
    const body = ticketingRequest.mock.calls.find(([name]) => name === 'ticketingCheckout')[1].body;
    expect(body).toEqual({ requestId: expect.any(String), lines: [{ ticketTypeId: 'general', quantity: 2, attendees: [
      { firstName: 'Synthetic', lastName: 'Attendee 1', email: 'attendee-1@example.test' },
      { firstName: 'Synthetic', lastName: 'Attendee 2', email: 'attendee-2@example.test' },
    ] }] });
    expect(JSON.stringify(body)).not.toMatch(/unitAmount|currency|priceId|entitlement/);
  });
  it('retries an uncertain request with the same frozen id and selections', async () => {
    ticketingRequest.mockImplementation(async (name) => {
      if (name === 'ticketingCatalog') return CATALOG;
      throw new TicketingRequestError('network', 'Connection interrupted');
    });
    mount();
    await fill();
    fireEvent.click(screen.getByRole('button', { name: /Continue to Stripe/ }));
    await screen.findByText('Connection interrupted');
    expect(screen.queryByLabelText('Quantity — General admission')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Resume existing checkout' }));
    await waitFor(() => expect(ticketingRequest.mock.calls.filter(([name]) => name === 'ticketingCheckout')).toHaveLength(2));
    const calls = ticketingRequest.mock.calls.filter(([name]) => name === 'ticketingCheckout');
    expect(calls[0][1].body).toEqual(calls[1][1].body);
    expect(sessionStorage.getItem('eventrunner.ticket-checkout.purchaser-a')).not.toContain('attendee-1@example.test');
  });
  it('restores a pending request after reload without retaining attendee details', async () => {
    sessionStorage.setItem('eventrunner.ticket-checkout.purchaser-a', JSON.stringify({ requestId: 'saved-request-123456789' }));
    mount();
    await screen.findByRole('button', { name: 'Resume existing checkout' });
    fireEvent.click(screen.getByRole('button', { name: 'Resume existing checkout' }));
    await waitFor(() => expect(ticketingRequest).toHaveBeenCalledWith('ticketingCheckout', expect.objectContaining({ body: { requestId: 'saved-request-123456789', resume: true } })));
  });
  it('returns to selection on a definite no-order capacity refusal', async () => {
    ticketingRequest.mockImplementation(async (name) => {
      if (name === 'ticketingCatalog') return CATALOG;
      throw new TicketingRequestError('sold-out', 'The last seat was purchased.', 409);
    });
    mount(); await fill();
    fireEvent.click(screen.getByRole('button', { name: /Continue to Stripe/ }));
    await screen.findByText('The last seat was purchased.');
    expect(screen.getByLabelText('Quantity — General admission')).toBeInTheDocument();
    expect(sessionStorage.getItem('eventrunner.ticket-checkout.purchaser-a')).toBeNull();
  });
  it('opens the purchaser’s existing order when another device already reserved seats', async () => {
    const error = new TicketingRequestError('purchase-in-progress', 'Finish your existing checkout.', 409);
    error.existingOrderId = 'ord_1234567890abcdef1234567890abcdef12345678';
    ticketingRequest.mockImplementation(async (name) => {
      if (name === 'ticketingCatalog') return CATALOG;
      throw error;
    });
    mount(); await fill();
    fireEvent.click(screen.getByRole('button', { name: /Continue to Stripe/ }));
    await screen.findByText(`Location: /tickets/status?orderId=${error.existingOrderId}`);
    expect(JSON.parse(sessionStorage.getItem('eventrunner.ticket-checkout.purchaser-a'))).toEqual({ requestId: null, orderId: error.existingOrderId });
  });
  it('resumes a saved order reference without inventing a new request id or attendee body', async () => {
    sessionStorage.setItem('eventrunner.ticket-checkout.purchaser-a', JSON.stringify({ orderId: 'ord_1234567890abcdef1234567890abcdef12345678' }));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Resume existing checkout' }));
    await waitFor(() => expect(ticketingRequest).toHaveBeenCalledWith('ticketingCheckout', expect.objectContaining({ body: { orderId: 'ord_1234567890abcdef1234567890abcdef12345678', resume: true } })));
  });
  it('does not issue another POST for double activation while checkout is running', async () => {
    let resolve;
    ticketingRequest.mockImplementation((name) => name === 'ticketingCatalog' ? Promise.resolve(CATALOG) : new Promise((done) => { resolve = done; }));
    mount(); await fill();
    fireEvent.click(screen.getByRole('button', { name: /Continue to Stripe/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Opening your order…' }));
    expect(ticketingRequest.mock.calls.filter(([name]) => name === 'ticketingCheckout')).toHaveLength(1);
    await act(async () => resolve({ orderId: 'order-synthetic', checkoutUrl: null, status: 'pending' }));
  });
});
