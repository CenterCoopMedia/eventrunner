import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

const state = vi.hoisted(() => ({ form: null, pushForm: null, consentCommits: [], auth: { user: { uid: 'purchaser-a', email: 'purchaser@example.test', emailVerified: true }, loading: false }, event: { name: 'Synthetic event', timezone: 'UTC', historicalDemo: false, registration: {} } }));
vi.mock('../contexts/AuthContext.jsx', () => ({ useAuth: () => state.auth, functionsOrigin: () => 'https://functions.example.test' }));
vi.mock('../contexts/EventConfigContext.jsx', () => ({ useEventConfig: () => ({ eventConfig: state.event }) }));
vi.mock('../components/SignInPanel.jsx', () => ({ default: () => <p>Inline verified sign-in</p> }));
vi.mock('../components/forms/Choice.jsx', async (original) => {
  const actual = await original();
  const { useLayoutEffect, useRef } = await import('react');
  function ObservedCheckbox(props) {
    const wrapper = useRef(null);
    useLayoutEffect(() => {
      const article = wrapper.current.closest('article');
      const heading = [...article.querySelectorAll('h3')].find((node) => node.textContent === 'Refund policy');
      // Observe the actual committed control and policy before any parent
      // passive effect can reset an old consent value.
      state.consentCommits.push({
        policy: heading?.nextElementSibling?.textContent,
        checked: wrapper.current.querySelector('input').checked,
        buyer: article.querySelector('span.font-semibold')?.textContent,
      });
    });
    return <div ref={wrapper}><actual.Checkbox {...props} /></div>;
  }
  return { ...actual, Checkbox: ObservedCheckbox };
});

// The registration form is delivered at once; a test can push a newer one.
vi.mock('../lib/registrationFormSource.js', () => ({
  subscribeRegistrationForm: (onNext) => { state.pushForm = onNext; onNext(state.form); return () => {}; },
}));
vi.mock('../lib/ticketingCommerce.js', async (original) => ({ ...await original(), ticketingRequest: vi.fn() }));
import { readCheckoutAttempt, ticketingRequest, TicketingRequestError } from '../lib/ticketingCommerce.js';
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
const FORM = {
  standard: { organization: { enabled: true, required: true }, photoConsent: { enabled: true, required: false } },
  custom: [],
  revision: 4,
};
const checkoutCalls = () => ticketingRequest.mock.calls.filter(([name]) => name === 'ticketingCheckout');
function next(title) { fireEvent.click(screen.getByRole('button', { name: `Next: ${title}` })); }
async function choose(quantity = 1) {
  await screen.findByLabelText('Quantity — General admission');
  fireEvent.change(screen.getByLabelText('Quantity — General admission'), { target: { value: String(quantity) } });
}
function nameAttendees(quantity = 1) {
  for (let index = 0; index < quantity; index += 1) {
    fireEvent.change(screen.getAllByLabelText('First name')[index], { target: { value: 'Synthetic' } });
    fireEvent.change(screen.getAllByLabelText('Last name')[index], { target: { value: `Attendee ${index + 1}` } });
    fireEvent.change(screen.getAllByLabelText('Attendee email')[index], { target: { value: `attendee-${index + 1}@example.test` } });
  }
}
/** Walks Tickets → Attendees → Review (no questions asked) and accepts the terms. */
async function fill(quantity = 1) {
  await choose(quantity);
  next('Attendees');
  nameAttendees(quantity);
  next('Review');
  fireEvent.click(screen.getByRole('checkbox', { name: 'I have read and accept the refund policy' }));
}
/** From wherever the buyer was sent back to, Next through to Review. */
function toReview() {
  for (const title of ['Attendees', 'Questions', 'Review']) {
    const button = screen.queryByRole('button', { name: `Next: ${title}` });
    if (button) fireEvent.click(button);
  }
}

describe('attendee ticket selection', () => {
  beforeEach(() => {
    sessionStorage.clear();
    state.form = null;
    state.pushForm = null;
    state.consentCommits = [];
    state.auth = { user: { uid: 'purchaser-a', email: 'purchaser@example.test', emailVerified: true }, loading: false };
    state.event = { name: 'Synthetic event', timezone: 'UTC', historicalDemo: false, registration: {} };
    ticketingRequest.mockReset();
    ticketingRequest.mockImplementation(async (name) => name === 'ticketingCatalog' ? CATALOG : { orderId: 'order-synthetic', status: 'pending', paymentStatus: 'pending', checkoutUrl: null });
  });
  it.each(['sold-out', 'rate-limited', 'account-not-ready'])('requires renewed terms acceptance when a %s refresh returns another revision', async (code) => {
    const changed = { ...CATALOG, catalogRevision: 2, refundPolicy: 'Updated refund policy requires organizer approval.',
      ticketTypes: CATALOG.ticketTypes.map((type) => ({ ...type, unitAmount: 3500 })) };
    let catalogCalls = 0;
    let checkoutCalls = 0;
    ticketingRequest.mockImplementation(async (name) => {
      if (name === 'ticketingCatalog') return ++catalogCalls === 1 ? CATALOG : changed;
      if (++checkoutCalls === 1) throw new TicketingRequestError(code, 'Review the available tickets and try again.', code === 'account-not-ready' ? 503 : code === 'rate-limited' ? 429 : 409);
      return { orderId: 'order-synthetic', checkoutUrl: null };
    });
    mount(); await fill();
    expect(screen.getByRole('checkbox')).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: /Continue to Stripe/ }));
    await screen.findByText('Review the available tickets and try again.');
    // A capacity refusal returns the buyer to selection; the others stay on Review.
    if (code === 'sold-out') expect(await screen.findByLabelText('Quantity — General admission')).toHaveValue('1');
    await waitFor(() => { toReview(); expect(screen.getByText(changed.refundPolicy)).toBeInTheDocument(); });
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    const updatedCommits = state.consentCommits.filter(({ policy }) => policy === changed.refundPolicy);
    expect(updatedCommits.length).toBeGreaterThan(0);
    expect(updatedCommits.every(({ checked }) => checked === false)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Stripe — $35.00' }));
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-invalid', 'true');
    expect(ticketingRequest.mock.calls.filter(([name]) => name === 'ticketingCheckout')).toHaveLength(1);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Stripe — $35.00' }));
    await screen.findByText('Location: /tickets/status?orderId=order-synthetic');
    const calls = ticketingRequest.mock.calls.filter(([name]) => name === 'ticketingCheckout');
    expect(calls).toHaveLength(2);
    expect(calls[0][1].body.catalogRevision).toBe(1);
    expect(calls[1][1].body.catalogRevision).toBe(2);
    expect(calls[1][1].body.requestId).not.toBe(calls[0][1].body.requestId);
  });
  it.each([undefined, null, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1])('does not accept or submit an invalid displayed revision: %s', async (catalogRevision) => {
    ticketingRequest.mockResolvedValue({ ...CATALOG, catalogRevision });
    mount(); await fill();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: /Continue to Stripe/ }));
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-invalid', 'true');
    expect(ticketingRequest.mock.calls.filter(([name]) => name === 'ticketingCheckout')).toHaveLength(0);
  });
  it('asks for a ticket choice instead of offering a free reservation when no tickets are chosen', async () => {
    mount();
    await screen.findByLabelText('Quantity — General admission');
    expect(screen.queryByText(/No payment is required/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reserve tickets|Continue to Stripe/ })).not.toBeInTheDocument();
    expect(screen.getByText('Choose at least one ticket to continue.')).toBeInTheDocument();
    // Next stays usable and explains itself rather than going silent.
    next('Attendees');
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose at least one ticket.');
    expect(screen.getByRole('alert')).toHaveFocus();
    expect(screen.getByLabelText('Quantity — General admission')).toBeInTheDocument();
    expect(ticketingRequest).not.toHaveBeenCalledWith('ticketingCheckout', expect.anything());
    // A chosen paid ticket replaces the prompt with its total and clears the
    // empty-cart error; Review then offers the paid handoff.
    fireEvent.change(screen.getByLabelText('Quantity — General admission'), { target: { value: '1' } });
    expect(screen.queryByText('Choose at least one ticket to continue.')).not.toBeInTheDocument();
    expect(screen.queryByText('Choose at least one ticket.')).not.toBeInTheDocument();
    expect(screen.getByText('Total for 1 ticket: $25.00')).toBeInTheDocument();
    next('Attendees');
    nameAttendees(1);
    next('Review');
    expect(screen.getByRole('button', { name: 'Continue to Stripe — $25.00' })).toBeInTheDocument();
  });

  it('keeps the free-order copy for a chosen free ticket', async () => {
    ticketingRequest.mockImplementation(async () => ({ ...CATALOG, ticketTypes: CATALOG.ticketTypes.map((type) => ({ ...type, unitAmount: 0 })) }));
    mount();
    await screen.findByLabelText('Quantity — General admission');
    expect(screen.queryByText(/No payment is required/)).not.toBeInTheDocument();
    await fill();
    expect(screen.getByText(/No payment is required/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reserve tickets' })).toBeInTheDocument();
  });

  it('accepts revision zero as a valid displayed catalog revision', async () => {
    ticketingRequest.mockImplementation(async (name) => name === 'ticketingCatalog'
      ? { ...CATALOG, catalogRevision: 0 }
      : { orderId: 'order-synthetic', checkoutUrl: null });
    mount(); await fill();
    expect(screen.getByRole('checkbox')).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: /Continue to Stripe/ }));
    await screen.findByText('Location: /tickets/status?orderId=order-synthetic');
    expect(ticketingRequest.mock.calls.find(([name]) => name === 'ticketingCheckout')[1].body.catalogRevision).toBe(0);
  });
  it('requires the new purchaser to accept even when the displayed revision is unchanged', async () => {
    const view = mount(); await fill();
    expect(screen.getByRole('checkbox')).toBeChecked();
    state.auth.user = { ...state.auth.user, uid: 'purchaser-b', email: 'next-purchaser@example.test' };
    view.rerender(<MemoryRouter initialEntries={['/tickets']}><Routes><Route path="/tickets" element={<Tickets />} /><Route path="*" element={<Location />} /></Routes></MemoryRouter>);
    const nextBuyerCommits = state.consentCommits.filter(({ buyer }) => buyer === 'next-purchaser@example.test');
    expect(nextBuyerCommits.length).toBeGreaterThan(0);
    expect(nextBuyerCommits.every(({ checked }) => checked === false)).toBe(true);
    // The cart resets for the new purchaser, so Review locks and selection opens.
    expect(await screen.findByLabelText('Quantity — General admission')).toHaveValue('0');
    expect(screen.queryByRole('checkbox', { checked: true })).not.toBeInTheDocument();
    expect(ticketingRequest.mock.calls.filter(([name]) => name === 'ticketingCheckout')).toHaveLength(0);
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
    expect(await screen.findByRole('link', { name: 'Register' })).toHaveAttribute('href', 'https://register.example.test/');
  });
  it.each(['javascript:alert(1)', 'https:register.example.test'])('does not render a rejected external registration destination: %s', async (externalUrl) => {
    state.event.registration = { externalUrl, actionLabel: 'Register with the organizer' };
    ticketingRequest.mockResolvedValue({ provider: 'manual' });
    mount();
    expect(await screen.findByText('Tickets are not sold on this site. Check this page again for registration details.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Register with the organizer' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Claim a ticket you already have' })).toHaveAttribute('href', '/ticket/claim');
  });
  it('offers no ticket claim when the event sells no tickets', async () => {
    ticketingRequest.mockResolvedValue({ provider: 'none' });
    mount();
    expect(await screen.findByText('Tickets are not sold on this site. Check this page again for registration details.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Claim a ticket you already have' })).not.toBeInTheDocument();
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
    await choose(1);
    next('Attendees');
    next('Review');
    expect(screen.getByLabelText('First name')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('First name')).toHaveFocus();
    expect(screen.getByLabelText('Attendee email')).toHaveAttribute('aria-invalid', 'true');
    // Review stays locked while this step fails.
    expect(screen.queryByRole('link', { name: /Review/ })).not.toBeInTheDocument();
    nameAttendees(1);
    next('Review');
    fireEvent.click(screen.getByRole('button', { name: /Continue to Stripe/ }));
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('checkbox')).toHaveFocus();
    expect(checkoutCalls()).toHaveLength(0);
  });
  it('sends a locked step address to the first step that needs work', async () => {
    render(<MemoryRouter initialEntries={['/tickets?step=review']}><Routes><Route path="/tickets" element={<Tickets />} /><Route path="*" element={<Location />} /></Routes></MemoryRouter>);
    expect(await screen.findByLabelText('Quantity — General admission')).toHaveValue('0');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
  it('shows a complete total and submits identities and quantities without trusting browser prices', async () => {
    mount();
    await fill(2);
    expect(screen.getByRole('button', { name: 'Continue to Stripe — $50.00' })).toBeInTheDocument();
    expect(screen.getByText(CATALOG.refundPolicy)).toBeInTheDocument();
    expect(screen.getByText('Ticket 2: General admission for Synthetic Attendee 2')).toBeInTheDocument();
    expect(screen.getByText('attendee-2@example.test')).toBeInTheDocument();
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
    expect(screen.getByText('attendee-1@example.test')).toBeInTheDocument();
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
    expect(await screen.findByLabelText('Quantity — General admission')).toBeInTheDocument();
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
    // The buyer stays on Review with the same cart and attendees.
    expect(screen.getByText('General admission × 1')).toBeInTheDocument();
    expect(screen.getByText('attendee-1@example.test')).toBeInTheDocument();
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
    await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus());
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

describe('registration questions in the ticket stepper', () => {
  const VIP = { id: 'vip', name: 'VIP', description: 'Front rows', unitAmount: 5000, available: true, remaining: 3, minPerOrder: 1, maxPerOrder: 3 };
  beforeEach(() => {
    sessionStorage.clear();
    state.form = FORM;
    state.pushForm = null;
    state.consentCommits = [];
    state.auth = { user: { uid: 'purchaser-a', email: 'purchaser@example.test', emailVerified: true }, loading: false };
    state.event = { name: 'Synthetic event', timezone: 'UTC', historicalDemo: false, registration: {} };
    ticketingRequest.mockReset();
    ticketingRequest.mockImplementation(async (name) => name === 'ticketingCatalog' ? CATALOG : { orderId: 'order-synthetic', checkoutUrl: null });
  });
  async function toQuestions(quantity = 2) {
    await choose(quantity);
    next('Attendees');
    nameAttendees(quantity);
    next('Questions');
  }
  function answerOrganization(index, value) {
    fireEvent.change(screen.getAllByLabelText('Organization (required)')[index], { target: { value } });
  }

  it('shows the Questions step only when the registration form asks something', async () => {
    state.form = { ...FORM, standard: {} };
    const view = mount();
    await choose(1);
    expect(screen.queryByText('Questions')).not.toBeInTheDocument();
    next('Attendees');
    expect(screen.getByRole('button', { name: 'Next: Review' })).toBeInTheDocument();
    view.unmount();

    state.form = FORM;
    mount();
    await choose(1);
    expect(screen.getByText('Questions')).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 4')).toBeInTheDocument();
    next('Attendees');
    expect(screen.getByRole('button', { name: 'Next: Questions' })).toBeInTheDocument();
  });

  it('checks each attendee’s answers on Next and sends them per attendee with the form revision', async () => {
    mount();
    await toQuestions(2);
    expect(screen.getByRole('group', { name: 'Ticket 1: General admission for Synthetic Attendee 1' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Ticket 2: General admission for Synthetic Attendee 2' })).toBeInTheDocument();
    next('Review');
    const fields = screen.getAllByLabelText('Organization (required)');
    expect(fields[0]).toHaveAttribute('aria-invalid', 'true');
    expect(fields[1]).toHaveAttribute('aria-invalid', 'true');
    expect(fields[0]).toHaveFocus();
    expect(screen.getAllByText('Answer this question.')).toHaveLength(2);
    answerOrganization(0, '  Synthetic Org  ');
    answerOrganization(1, 'Second Org');
    fireEvent.click(screen.getAllByRole('radio', { name: 'Yes' })[1]);
    next('Review');
    expect(screen.getByText('Synthetic Org')).toBeInTheDocument();
    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(screen.getByText('Not answered')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'I have read and accept the refund policy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Stripe — $50.00' }));
    await screen.findByText('Location: /tickets/status?orderId=order-synthetic');
    expect(checkoutCalls()[0][1].body).toEqual({ requestId: expect.any(String), catalogRevision: 1, formRevision: 4, lines: [{ ticketTypeId: 'general', quantity: 2, attendees: [
      { firstName: 'Synthetic', lastName: 'Attendee 1', email: 'attendee-1@example.test', answers: { organization: 'Synthetic Org' } },
      { firstName: 'Synthetic', lastName: 'Attendee 2', email: 'attendee-2@example.test', answers: { organization: 'Second Org', photoConsent: true } },
    ] }] });
  });

  it('sends no answers or form revision when every answer is blank', async () => {
    state.form = { ...FORM, standard: { photoConsent: { enabled: true, required: false } } };
    mount();
    await toQuestions(1);
    next('Review');
    fireEvent.click(screen.getByRole('checkbox', { name: 'I have read and accept the refund policy' }));
    fireEvent.click(screen.getByRole('button', { name: /Continue to Stripe/ }));
    await screen.findByText('Location: /tickets/status?orderId=order-synthetic');
    const body = checkoutCalls()[0][1].body;
    expect(body).not.toHaveProperty('formRevision');
    expect(body.lines[0].attendees[0]).not.toHaveProperty('answers');
  });

  it('takes the newer form on form-changed, keeps answers still asked, and returns to Questions', async () => {
    let checkouts = 0;
    ticketingRequest.mockImplementation(async (name) => {
      if (name === 'ticketingCatalog') return CATALOG;
      checkouts += 1;
      if (checkouts === 1) throw new TicketingRequestError('form-changed', 'The registration questions changed.', 409);
      return { orderId: 'order-synthetic', checkoutUrl: null };
    });
    mount();
    await toQuestions(1);
    answerOrganization(0, 'Synthetic Org');
    fireEvent.click(screen.getByRole('radio', { name: 'Yes' }));
    next('Review');
    fireEvent.click(screen.getByRole('checkbox', { name: 'I have read and accept the refund policy' }));
    // The live form moves on while the buyer reviews; the page stays pinned.
    const NEWER = { standard: { organization: { enabled: true, required: true }, jobTitle: { enabled: true, required: true } }, custom: [], revision: 5 };
    act(() => state.pushForm(NEWER));
    expect(screen.getByText('May the organizers photograph you and use the photos?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Continue to Stripe/ }));
    // The step re-renders as the newer form lands, so query again until it settles.
    await waitFor(() => {
      expect(screen.getByText(/The registration questions changed while you were buying/)).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Answer the registration questions' })).toBeInTheDocument();
      expect(screen.getByLabelText('Job title (required)')).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Organization (required)')).toHaveValue('Synthetic Org');
    expect(screen.getByLabelText('Job title (required)')).toHaveValue('');
    expect(screen.queryByRole('radio', { name: 'Yes' })).not.toBeInTheDocument();
    expect(sessionStorage.getItem('eventrunner.ticket-checkout.purchaser-a')).toBeNull();
    next('Review');
    expect(screen.getByLabelText('Job title (required)')).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(screen.getByLabelText('Job title (required)'), { target: { value: 'Reporter' } });
    next('Review');
    expect(screen.getByRole('checkbox')).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: /Continue to Stripe/ }));
    await screen.findByText('Location: /tickets/status?orderId=order-synthetic');
    const [first, second] = checkoutCalls().map(([, options]) => options.body);
    expect(first.formRevision).toBe(4);
    expect(first.lines[0].attendees[0].answers).toEqual({ organization: 'Synthetic Org', photoConsent: true });
    expect(second.formRevision).toBe(5);
    expect(second.lines[0].attendees[0].answers).toEqual({ organization: 'Synthetic Org', jobTitle: 'Reporter' });
    expect(second.requestId).not.toBe(first.requestId);
  });

  it('maps a server answer error to that attendee’s field, numbering lines sorted by ticket type id', async () => {
    // The catalog lists VIP first; the server numbers lines sorted by id, so line 0 is general.
    ticketingRequest.mockImplementation(async (name) => {
      if (name === 'ticketingCatalog') return { ...CATALOG, maxPerOrder: 6, ticketTypes: [VIP, ...CATALOG.ticketTypes] };
      throw new TicketingRequestError('invalid-checkout', 'lines.0.attendees.1.answers.organization: Use at most 200 characters.; lines.1.attendees.0.answers.organization: Answer this question.', 400);
    });
    mount();
    await screen.findByLabelText('Quantity — VIP');
    fireEvent.change(screen.getByLabelText('Quantity — VIP'), { target: { value: '1' } });
    await choose(2);
    next('Attendees');
    nameAttendees(3);
    next('Questions');
    // Seats in page order: VIP 1, General 1, General 2.
    answerOrganization(0, 'VIP Org');
    answerOrganization(1, 'General Org 1');
    answerOrganization(2, 'General Org 2');
    next('Review');
    fireEvent.click(screen.getByRole('checkbox', { name: 'I have read and accept the refund policy' }));
    fireEvent.click(screen.getByRole('button', { name: /Continue to Stripe/ }));
    expect(await screen.findByText('Use at most 200 characters.')).toBeInTheDocument();
    const fields = screen.getAllByLabelText('Organization (required)');
    expect(fields[0]).toHaveAttribute('aria-invalid', 'true');
    expect(fields[1]).not.toHaveAttribute('aria-invalid', 'true');
    expect(fields[2]).toHaveAttribute('aria-invalid', 'true');
    expect(fields[0]).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Answer the registration questions' })).toBeInTheDocument();
    expect(screen.queryByText(/lines\.0\.attendees/)).not.toBeInTheDocument();
    expect(sessionStorage.getItem('eventrunner.ticket-checkout.purchaser-a')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resume existing checkout' })).not.toBeInTheDocument();
  });
});

describe('promo codes on the review step', () => {
  const PREVIEW = {
    code: 'EARLY', subtotalAmount: 4000, totalAmount: 4000, discountAmount: 1000,
    lines: [{ ticketTypeId: 'general', name: 'General admission', quantity: 2, unitAmount: 2000, lineAmount: 4000, listUnitAmount: 2500 }],
  };
  const previewCalls = () => ticketingRequest.mock.calls.filter(([name]) => name === 'ticketingPromoPreview');
  let checkoutError = null;
  beforeEach(() => {
    sessionStorage.clear();
    state.form = null;
    state.consentCommits = [];
    state.auth = { user: { uid: 'purchaser-a', email: 'purchaser@example.test', emailVerified: true }, loading: false };
    state.event = { name: 'Synthetic event', timezone: 'UTC', historicalDemo: false, registration: {} };
    checkoutError = null;
    ticketingRequest.mockReset();
    ticketingRequest.mockImplementation(async (name, { body } = {}) => {
      if (name === 'ticketingCatalog') return CATALOG;
      if (name === 'ticketingPromoPreview') {
        if (body.code.trim().toUpperCase() !== 'EARLY') throw new TicketingRequestError('promo-invalid', 'This code is not valid.', 400);
        return PREVIEW;
      }
      if (checkoutError) throw checkoutError;
      return { orderId: 'order-synthetic', status: 'pending', paymentStatus: 'pending', checkoutUrl: null };
    });
  });
  async function apply(code) {
    fireEvent.change(screen.getByLabelText('Promo code'), { target: { value: code } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply code' }));
  }

  it('applies a code, shows the lower total, and sends the code with the order', async () => {
    mount(); await fill(2);
    await apply(' early ');
    expect(await screen.findByText('Promo code EARLY')).toBeInTheDocument();
    expect(previewCalls()[0][1].body).toEqual({ code: 'early', catalogRevision: 1, lines: [{ ticketTypeId: 'general', quantity: 2 }] });
    expect(screen.getByText('−$10.00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Stripe — $40.00' }));
    await screen.findByText('Location: /tickets/status?orderId=order-synthetic');
    expect(checkoutCalls()[0][1].body.promoCode).toBe('EARLY');
  });

  it('does not start checkout while a code check is still running', async () => {
    let finish;
    ticketingRequest.mockImplementation(async (name) => {
      if (name === 'ticketingCatalog') return CATALOG;
      if (name === 'ticketingPromoPreview') return new Promise((resolve) => { finish = () => resolve(PREVIEW); });
      return { orderId: 'order-synthetic', status: 'pending', paymentStatus: 'pending', checkoutUrl: null };
    });
    mount(); await fill(2);
    await apply('EARLY');
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Stripe — $50.00' }));
    expect(checkoutCalls()).toHaveLength(0);
    await act(async () => finish());
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to Stripe — $40.00' }));
    await screen.findByText('Location: /tickets/status?orderId=order-synthetic');
    expect(checkoutCalls()).toHaveLength(1);
    expect(checkoutCalls()[0][1].body.promoCode).toBe('EARLY');
  });

  it('shows a refused code by the field and sends no code', async () => {
    mount(); await fill(1);
    await apply('GUESS');
    expect(await screen.findByText('This code is not valid.')).toBeInTheDocument();
    expect(screen.getByLabelText('Promo code')).toHaveAttribute('aria-invalid', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Stripe — $25.00' }));
    await screen.findByText('Location: /tickets/status?orderId=order-synthetic');
    expect(checkoutCalls()[0][1].body).not.toHaveProperty('promoCode');
  });

  it('drops an applied code when the tickets change', async () => {
    mount(); await fill(2);
    await apply('EARLY');
    await screen.findByText('Promo code EARLY');
    fireEvent.click(screen.getByRole('link', { name: 'Back' }));
    fireEvent.click(screen.getByRole('link', { name: 'Back' }));
    fireEvent.change(await screen.findByLabelText('Quantity — General admission'), { target: { value: '1' } });
    toReview();
    await screen.findByRole('button', { name: 'Continue to Stripe — $25.00' });
    expect(screen.queryByText('Promo code EARLY')).not.toBeInTheDocument();
  });

  it('removes the code when checkout refuses it, and keeps no order', async () => {
    mount(); await fill(2);
    await apply('EARLY');
    await screen.findByText('Promo code EARLY');
    checkoutError = new TicketingRequestError('promo-exhausted', 'This code has no uses left.', 409);
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Stripe — $40.00' }));
    expect(await screen.findAllByText('This code has no uses left.')).not.toHaveLength(0);
    expect(screen.queryByText('Promo code EARLY')).not.toBeInTheDocument();
    // A refused code is refused before any order, so no saved checkout is kept.
    expect(readCheckoutAttempt('purchaser-a')).toBeNull();
  });
});
