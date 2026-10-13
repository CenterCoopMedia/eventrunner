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
  provider: 'stripe', mode: 'test', salesEnabled: true, catalogRevision: 1, currency: 'usd', eventName: 'Synthetic event', maxPerOrder: 3,
  refundPolicy: 'Contact the organizer before the event for a refund.', taxTreatment: 'inclusive',
  ticketTypes: [{ id: 'general', name: 'General admission', description: 'Full event', unitAmount: 2500, available: true, remaining: 3, minPerOrder: 1, maxPerOrder: 3 }],
};
const WIDE_SALES_WINDOW = { salesStartAt: '2030-05-01T14:00:00.000Z', salesEndAt: '2030-06-03T20:00:00.000Z' };
const NARROW_SALES_WINDOW = { salesStartAt: '2030-05-02T15:00:00.000Z', salesEndAt: '2030-06-01T18:00:00.000Z' };
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
  it.each(['manual', 'eventbrite', 'none'])('uses the shared canonical external registration action for %s', async (provider) => {
    state.event.registration = { externalUrl: '  HTTPS://Register.Example.TEST/event tickets  ', actionLabel: '  Register with the organizer  ' };
    ticketingRequest.mockResolvedValue({ provider });
    mount();
    expect(await screen.findByRole('link', { name: 'Register with the organizer' })).toHaveAttribute('href', 'https://register.example.test/event%20tickets');
    expect(screen.queryByRole('button', { name: /Continue to Stripe/ })).not.toBeInTheDocument();
  });
  it('supplies a readable default when the canonical registration action has no label', async () => {
    state.event.registration = { externalUrl: 'https://register.example.test', actionLabel: '   ' };
    ticketingRequest.mockResolvedValue({ provider: 'manual' });
    mount();
    expect(await screen.findByRole('link', { name: 'Open registration' })).toHaveAttribute('href', 'https://register.example.test/');
  });
  it.each(['javascript:alert(1)', 'https:register.example.test'])('does not render a rejected external registration destination: %s', async (externalUrl) => {
    state.event.registration = { externalUrl, actionLabel: 'Register with the organizer' };
    ticketingRequest.mockResolvedValue({ provider: 'manual' });
    mount();
    expect(await screen.findByText('Contact the organizers for registration information.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Register with the organizer' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Claim a ticket you already have' })).toHaveAttribute('href', '/ticket/claim');
  });
  it.each([
    ['global-only deadlines', NARROW_SALES_WINDOW, {}],
    ['a tighter global window', NARROW_SALES_WINDOW, WIDE_SALES_WINDOW],
    ['a tighter ticket-type window', WIDE_SALES_WINDOW, NARROW_SALES_WINDOW],
    ['ticket-type-only deadlines', {}, NARROW_SALES_WINDOW],
  ])('shows the effective sales window in the event timezone for %s', async (_label, globalWindow, typeWindow) => {
    state.event.timezone = 'Etc/GMT+5';
    ticketingRequest.mockResolvedValue({
      ...CATALOG, ...globalWindow,
      ticketTypes: CATALOG.ticketTypes.map((type) => ({ ...type, ...typeWindow })),
    });
    mount();
    expect(await screen.findByText('Sales open May 2, 2030, 10:00:00 AM GMT-5.')).toBeInTheDocument();
    expect(screen.getByText('Sales close Jun 1, 2030, 1:00:00 PM GMT-5.')).toBeInTheDocument();
    expect(screen.getAllByText(/^Sales (open|close) /)).toHaveLength(2);
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
    expect(body).toEqual({ requestId: expect.any(String), catalogRevision: 1, lines: [{ ticketTypeId: 'general', quantity: 2, attendees: [
      { firstName: 'Synthetic', lastName: 'Attendee 1', email: 'attendee-1@example.test' },
      { firstName: 'Synthetic', lastName: 'Attendee 2', email: 'attendee-2@example.test' },
    ] }] });
    expect(JSON.stringify(body)).not.toMatch(/unitAmount|currency|priceId|entitlement/);
  });
  it('retries an uncertain request with the same frozen id, accepted revision, and selections', async () => {
    let liveCatalog = CATALOG;
    ticketingRequest.mockImplementation(async (name) => {
      if (name === 'ticketingCatalog') return liveCatalog;
      throw new TicketingRequestError('network', 'Connection interrupted');
    });
    mount();
    await fill();
    fireEvent.click(screen.getByRole('button', { name: /Continue to Stripe/ }));
    await screen.findByText('Connection interrupted');
    liveCatalog = { ...CATALOG, catalogRevision: 2, refundPolicy: 'Updated refund policy.' };
    expect(screen.queryByLabelText('Quantity — General admission')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Resume existing checkout' }));
    await waitFor(() => expect(ticketingRequest.mock.calls.filter(([name]) => name === 'ticketingCheckout')).toHaveLength(2));
    const calls = ticketingRequest.mock.calls.filter(([name]) => name === 'ticketingCheckout');
    expect(calls[0][1].body).toEqual(calls[1][1].body);
    expect(calls[1][1].body.catalogRevision).toBe(1);
    expect(sessionStorage.getItem('eventrunner.ticket-checkout.purchaser-a')).not.toContain('attendee-1@example.test');
  });
  it('requires renewed acceptance after changed prices or terms and waits for the refreshed catalog', async () => {
    const changed = { ...CATALOG, catalogRevision: 2, refundPolicy: 'Refunds are available until May 1.',
      ticketTypes: CATALOG.ticketTypes.map((type) => ({ ...type, unitAmount: 3500 })) };
    let catalogCalls = 0;
    let refresh;
    ticketingRequest.mockImplementation((name, { body } = {}) => {
      if (name === 'ticketingCatalog') {
        catalogCalls += 1;
        return catalogCalls === 1 ? Promise.resolve(CATALOG) : new Promise((resolve) => { refresh = resolve; });
      }
      if (body.catalogRevision === 1) return Promise.reject(new TicketingRequestError('catalog-changed', 'Ticket prices or terms have changed. Review the updated catalog before continuing.', 409));
      return Promise.resolve({ orderId: 'order-synthetic', checkoutUrl: null });
    });
    mount(); await fill();
    fireEvent.click(screen.getByRole('button', { name: /Continue to Stripe/ }));
    await screen.findByText('Loading ticket information…');
    expect(screen.queryByRole('button', { name: /Continue to Stripe/ })).not.toBeInTheDocument();
    expect(sessionStorage.getItem('eventrunner.ticket-checkout.purchaser-a')).toBeNull();
    await act(async () => refresh(changed));
    expect(screen.getByText(changed.refundPolicy)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Ticket prices or terms have changed.');
    expect(screen.getByRole('alert')).toHaveFocus();
    expect(screen.getByLabelText('Attendee email')).toHaveValue('attendee-1@example.test');
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Stripe — $35.00' }));
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-invalid', 'true');
    expect(ticketingRequest.mock.calls.filter(([name]) => name === 'ticketingCheckout')).toHaveLength(1);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Stripe — $35.00' }));
    await screen.findByText('Location: /tickets/status?orderId=order-synthetic');
    const calls = ticketingRequest.mock.calls.filter(([name]) => name === 'ticketingCheckout');
    expect(calls).toHaveLength(2);
    expect(calls[1][1].body.catalogRevision).toBe(2);
    expect(calls[1][1].body.requestId).not.toBe(calls[0][1].body.requestId);
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
  it('clears a first-submission profile refusal so reload returns to ticket selection', async () => {
    ticketingRequest.mockImplementation(async (name) => {
      if (name === 'ticketingCatalog') return CATALOG;
      throw new TicketingRequestError('account-not-ready', 'Your account is still being set up. Wait a moment and try again.', 503);
    });
    const view = mount(); await fill();
    fireEvent.click(screen.getByRole('button', { name: /Continue to Stripe/ }));
    await screen.findByText('Your account is still being set up. Wait a moment and try again.');
    expect(screen.getByLabelText('Quantity — General admission')).toHaveValue('1');
    expect(screen.getByLabelText('Attendee email')).toHaveValue('attendee-1@example.test');
    expect(sessionStorage.getItem('eventrunner.ticket-checkout.purchaser-a')).toBeNull();

    view.unmount(); mount();
    expect(await screen.findByLabelText('Quantity — General admission')).toHaveValue('0');
    expect(screen.queryByRole('button', { name: 'Resume existing checkout' })).not.toBeInTheDocument();
    expect(ticketingRequest.mock.calls.filter(([name]) => name === 'ticketingCheckout')).toHaveLength(1);
  });
  it.each([
    { requestId: 'stale-request-123456789' },
    { orderId: 'ord_1234567890abcdef1234567890abcdef12345678' },
  ])('clears a saved reference only when its explicit resume confirms it is unavailable: %j', async (attempt) => {
    sessionStorage.setItem('eventrunner.ticket-checkout.purchaser-a', JSON.stringify(attempt));
    ticketingRequest.mockImplementation(async (name) => {
      if (name === 'ticketingCatalog') return CATALOG;
      throw new TicketingRequestError('not-found', 'This order is not available to this account.', 404);
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Resume existing checkout' }));
    expect(await screen.findByLabelText('Quantity — General admission')).toHaveValue('0');
    expect(screen.getByRole('alert')).toHaveTextContent('Choose your tickets again.');
    expect(screen.getByRole('alert')).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Resume existing checkout' })).not.toBeInTheDocument();
    expect(sessionStorage.getItem('eventrunner.ticket-checkout.purchaser-a')).toBeNull();
    expect(ticketingRequest).toHaveBeenCalledWith('ticketingCheckout', expect.objectContaining({ body: { ...attempt, resume: true } }));
  });
  it('recovers an active held order when selection resumes after clearing a stale request', async () => {
    const staleId = 'stale-request-123456789';
    const existingOrderId = 'ord_1234567890abcdef1234567890abcdef12345678';
    sessionStorage.setItem('eventrunner.ticket-checkout.purchaser-a', JSON.stringify({ requestId: staleId }));
    ticketingRequest.mockImplementation(async (name, { body } = {}) => {
      if (name === 'ticketingCatalog') return CATALOG;
      if (body.resume) throw new TicketingRequestError('not-found', 'This order is not available to this account.', 404);
      const error = new TicketingRequestError('purchase-in-progress', 'Finish your existing checkout.', 409);
      error.existingOrderId = existingOrderId;
      throw error;
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Resume existing checkout' }));
    await fill();
    fireEvent.click(screen.getByRole('button', { name: /Continue to Stripe/ }));
    await screen.findByText(`Location: /tickets/status?orderId=${existingOrderId}`);
    const calls = ticketingRequest.mock.calls.filter(([name]) => name === 'ticketingCheckout');
    expect(calls).toHaveLength(2);
    expect(calls[1][1].body.requestId).not.toBe(staleId);
    expect(JSON.parse(sessionStorage.getItem('eventrunner.ticket-checkout.purchaser-a'))).toEqual({ requestId: null, orderId: existingOrderId });
  });
  it.each([
    ['ticketing-unavailable', 503],
    ['not-found', 404],
  ])('preserves an initial %s response until explicit resume checks the saved request', async (code, status) => {
    ticketingRequest.mockImplementation(async (name) => {
      if (name === 'ticketingCatalog') return CATALOG;
      throw new TicketingRequestError(code, 'The checkout outcome is not confirmed.', status);
    });
    const view = mount(); await fill();
    fireEvent.click(screen.getByRole('button', { name: /Continue to Stripe/ }));
    await screen.findByText('The checkout outcome is not confirmed.');
    const firstBody = ticketingRequest.mock.calls.find(([name]) => name === 'ticketingCheckout')[1].body;
    expect(screen.queryByLabelText('Quantity — General admission')).not.toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem('eventrunner.ticket-checkout.purchaser-a'))).toEqual({ requestId: firstBody.requestId, orderId: null });

    view.unmount(); mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Resume existing checkout' }));
    await waitFor(() => expect(ticketingRequest).toHaveBeenCalledWith('ticketingCheckout', expect.objectContaining({ body: { requestId: firstBody.requestId, resume: true } })));
  });
  it.each([false, true])('keeps an earlier uncertain attempt if the purchaser profile disappears before retry (reload: %s)', async (reload) => {
    let checkoutCalls = 0;
    ticketingRequest.mockImplementation(async (name) => {
      if (name === 'ticketingCatalog') return CATALOG;
      checkoutCalls += 1;
      if (checkoutCalls === 1) throw new TicketingRequestError('network', 'Connection interrupted');
      throw new TicketingRequestError('account-not-ready', 'Your account is still being set up. Wait a moment and try again.', 503);
    });
    const view = mount(); await fill();
    fireEvent.click(screen.getByRole('button', { name: /Continue to Stripe/ }));
    await screen.findByText('Connection interrupted');
    const firstBody = ticketingRequest.mock.calls.find(([name]) => name === 'ticketingCheckout')[1].body;
    if (reload) { view.unmount(); mount(); }
    fireEvent.click(await screen.findByRole('button', { name: 'Resume existing checkout' }));
    await screen.findByText('Your account is still being set up. Wait a moment and try again.');
    expect(screen.getByRole('button', { name: 'Resume existing checkout' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Quantity — General admission')).not.toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem('eventrunner.ticket-checkout.purchaser-a'))).toEqual({ requestId: firstBody.requestId, orderId: null });
    const calls = ticketingRequest.mock.calls.filter(([name]) => name === 'ticketingCheckout');
    expect(calls).toHaveLength(2);
    expect(calls[1][1].body).toEqual(reload ? { requestId: firstBody.requestId, resume: true } : firstBody);
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
