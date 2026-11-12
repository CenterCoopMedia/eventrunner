import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api.js';
import { leavePage } from '../../setup/leavePage.js';
import { takeConnectReturn } from '../../setup/connections.js';
import { application, callsTo, connections, emptyAnswers, fullAnswers, serveApi } from '../../test/application.js';
import { renderSetup } from '../../test/setupPage.jsx';

vi.mock('../../api.js', async (importOriginal) => ({ ...(await importOriginal()), callApi: vi.fn() }));
vi.mock('../../setup/leavePage.js', () => ({ leavePage: vi.fn() }));

const STRIPE_PAGE = 'https://connect.stripe.com/oauth/authorize?state=s1';
const notConnected = { available: true, connected: false, displayName: null, connectedAt: null };
const answersWith = (choice) => ({ ...fullAnswers(), tickets: { choice } });
const CONSENT = /By connecting, you authorize Event Runner to read your Eventbrite/;
const eventbriteAccount = (event = null) => ({ available: true, connected: true, displayName: 'Ana', connectedAt: '2026-11-02T00:00:00.000Z', event });

function serve(app, extra = {}) {
  serveApi({ getApplication: { application: application(app) }, ...extra });
}

beforeEach(() => {
  vi.mocked(leavePage).mockClear();
  window.sessionStorage.clear();
  serve({ answers: emptyAnswers(), connections: connections({ stripe: notConnected }) });
});

describe('Tickets step', () => {
  it.each(['stripe', 'eventbrite'])('keeps Review context when connecting %s', async (provider) => {
    const url = provider === 'stripe' ? STRIPE_PAGE : 'https://www.eventbrite.com/oauth/authorize?state=s1';
    serve({ answers: answersWith(provider), connections: connections({ [provider]: { ...notConnected, event: null } }) }, { startConnection: { url } });
    renderSetup('tickets', { query: '?check=1&from=review' });
    fireEvent.click(await screen.findByRole('button', { name: `Connect with ${provider === 'stripe' ? 'Stripe' : 'Eventbrite'}` }));
    await waitFor(() => expect(leavePage).toHaveBeenCalledWith(url));
    expect(takeConnectReturn()).toBe('/organizations/o1/applications/a1/tickets?check=1&from=review');
  });

  it('offers the four choices in plain words', async () => {
    renderSetup('tickets');
    const group = await screen.findByRole('group', { name: 'Ticket sales' });
    expect(group).toBeInTheDocument();
    for (const name of ['Sell with Stripe', 'Use Eventbrite', 'Import a spreadsheet later', 'No tickets']) {
      expect(screen.getByRole('radio', { name: new RegExp(name) })).not.toBeChecked();
    }
  });

  it('explains who owns the account and offers the button, and nothing to connect for the other choices', async () => {
    renderSetup('tickets');
    fireEvent.click(await screen.findByRole('radio', { name: /Sell with Stripe/ }));
    const panel = screen.getByRole('region', { name: 'Your Stripe account' });
    expect(panel).toHaveTextContent('You own this account');
    expect(panel).toHaveTextContent('the money from ticket sales goes straight to it');
    expect(panel).not.toHaveTextContent('You can disconnect this account');
    expect(screen.queryByText(CONSENT)).not.toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Connect with Stripe' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Use Eventbrite/ }));
    expect(screen.getByRole('button', { name: 'Connect with Eventbrite' })).toBeInTheDocument();
    expect(screen.getByText(CONSENT)).toHaveTextContent('add a webhook to your Eventbrite account so your site hears about order and attendee changes.');
    for (const name of [/Import a spreadsheet later/, /No tickets/]) {
      fireEvent.click(screen.getByRole('radio', { name }));
      expect(screen.queryByRole('button', { name: /Connect with/ })).not.toBeInTheDocument();
    }
  });

  it('shows the Eventbrite consent before connecting again', async () => {
    serve({ answers: answersWith('eventbrite'), connections: connections({ eventbrite: eventbriteAccount() }) }, { listEventbriteEvents: { events: [] } });
    renderSetup('tickets');
    const panel = await screen.findByRole('region', { name: 'Your Eventbrite account' });
    expect(within(panel).getByRole('button', { name: 'Connect again' })).toBeInTheDocument();
    expect(within(panel).getByText(CONSENT)).toHaveTextContent('add a webhook to your Eventbrite account so your site hears about order and attendee changes.');
  });

  it('does not ask an Editor, who cannot connect, for the Eventbrite consent', async () => {
    serve({
      answers: answersWith('eventbrite'),
      myRole: 'editor',
      connections: connections({ canChange: false, canDisconnect: false, eventbrite: eventbriteAccount() }),
    });
    renderSetup('tickets');
    await screen.findByRole('region', { name: 'Your Eventbrite account' });
    expect(screen.queryByText(CONSENT)).not.toBeInTheDocument();
  });

  it('asks nothing to be typed: the step has no text box', async () => {
    serve({ answers: answersWith('eventbrite'), connections: connections({ eventbrite: eventbriteAccount() }) }, { listEventbriteEvents: { events: [] } });
    renderSetup('tickets');
    await screen.findByText(/Create an upcoming event on Eventbrite/);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('saves the choice, then goes to the provider and remembers the way back', async () => {
    serve({ answers: emptyAnswers(), connections: connections({ stripe: notConnected }) }, { startConnection: { url: STRIPE_PAGE } });
    renderSetup('tickets');
    fireEvent.click(await screen.findByRole('radio', { name: /Sell with Stripe/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Connect with Stripe' }));
    await waitFor(() => expect(leavePage).toHaveBeenCalledWith(STRIPE_PAGE));
    expect(callsTo('saveApplicationStep').at(-1)).toMatchObject({ step: 'tickets', answers: { choice: 'stripe' } });
    expect(callsTo('startConnection')).toEqual([{ orgId: 'o1', appId: 'a1', provider: 'stripe' }]);
    expect(window.sessionStorage.getItem('console.connectReturn')).toBe('/organizations/o1/applications/a1/tickets');
  });

  it('does not follow an address that is not the provider', async () => {
    serve({ answers: answersWith('stripe'), connections: connections({ stripe: notConnected }) }, { startConnection: { url: 'https://evil.example/oauth' } });
    renderSetup('tickets');
    fireEvent.click(await screen.findByRole('button', { name: 'Connect with Stripe' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not open the Stripe page');
    expect(leavePage).not.toHaveBeenCalled();
  });

  it('shows a refusal from the server in plain words', async () => {
    serve({ answers: answersWith('stripe'), connections: connections({ stripe: notConnected }) }, {
      startConnection: () => { throw new ApiError(503, 'not-available', 'Connecting a Stripe account is not available yet.'); },
    });
    renderSetup('tickets');
    fireEvent.click(await screen.findByRole('button', { name: 'Connect with Stripe' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not available yet');
    expect(screen.getByRole('button', { name: 'Connect with Stripe' })).toBeEnabled();
  });

  it('says a provider is not available yet, and does not break', async () => {
    serve({
      answers: emptyAnswers(),
      connections: connections({ stripe: { ...notConnected, available: false }, eventbrite: { ...notConnected, available: false, event: null } }),
    });
    renderSetup('tickets');
    const stripe = await screen.findByRole('radio', { name: /Sell with Stripe.*Not available yet/ });
    expect(stripe).toBeDisabled();
    expect(screen.getByRole('radio', { name: /No tickets/ })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Connect with/ })).not.toBeInTheDocument();
  });

  it('with ?check=1 shows the field error next to the button and focuses the button', async () => {
    serve({
      answers: answersWith('stripe'),
      connections: connections({ stripe: notConnected }),
      errors: { 'tickets.connection': 'Connect your Stripe account.' },
    });
    renderSetup('tickets', { query: '?check=1' });
    const button = await screen.findByRole('button', { name: 'Connect with Stripe' });
    expect(screen.getByText('Connect your Stripe account.')).toHaveClass('field-error');
    expect(button).toHaveAccessibleDescription('Connect your Stripe account.');
    await waitFor(() => expect(button).toHaveFocus());
  });

  it('shows a connected account, and disconnect asks first and clears it', async () => {
    serve({ answers: answersWith('stripe') }, {
      disconnectAccount: {
        connections: connections({ stripe: notConnected }),
        errors: { 'tickets.connection': 'Connect your Stripe account.' },
        revoked: true,
      },
    });
    renderSetup('tickets');
    expect(await screen.findByText('Connected: NC Local')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(callsTo('disconnectAccount')).toEqual([]);
    const confirm = screen.getByRole('group', { name: 'Disconnect your Stripe account' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(await screen.findByRole('button', { name: 'Connect with Stripe' })).toBeInTheDocument();
    expect(screen.getByText('You disconnected your Stripe account.')).toBeInTheDocument();
    expect(callsTo('disconnectAccount')).toEqual([{ orgId: 'o1', appId: 'a1', provider: 'stripe' }]);
  });

  it('tells the client when the provider has no way for us to end the connection', async () => {
    serve({ answers: answersWith('eventbrite'), connections: connections({ stripe: notConnected, eventbrite: eventbriteAccount() }) }, {
      listEventbriteEvents: { events: [] },
      disconnectAccount: { connections: connections({ stripe: notConnected, eventbrite: { ...notConnected, event: null } }), errors: {}, revoked: false, shared: false },
    });
    renderSetup('tickets');
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(await screen.findByText(/we deleted our access to it/)).toBeInTheDocument();
  });

  it('says so when another event site still uses the account, and does not suggest removing it', async () => {
    serve({ answers: answersWith('stripe') }, {
      disconnectAccount: { connections: connections({ stripe: notConnected }), errors: {}, revoked: false, shared: true },
    });
    renderSetup('tickets');
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(await screen.findByText(/Another event site still uses this account/)).toBeInTheDocument();
    expect(screen.queryByText(/account settings/)).not.toBeInTheDocument();
  });

  it('picks an Eventbrite event from a list', async () => {
    const event = { id: 'e1', name: 'Summit', start: '2027-05-13T09:00:00' };
    serve({ answers: answersWith('eventbrite'), connections: connections({ eventbrite: eventbriteAccount() }) }, {
      listEventbriteEvents: { events: [event, { id: 'e2', name: 'Dinner', start: null }] },
      chooseEventbriteEvent: { connections: connections({ eventbrite: eventbriteAccount(event) }), errors: {} },
    });
    renderSetup('tickets');
    const select = await screen.findByRole('combobox', { name: 'Your Eventbrite event' });
    expect(screen.getByRole('option', { name: 'Summit, 13 May 2027' })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'e1' } });
    expect(await screen.findByText('We saved your Eventbrite event.')).toBeInTheDocument();
    expect(callsTo('chooseEventbriteEvent')).toEqual([{ orgId: 'o1', appId: 'a1', eventId: 'e1' }]);
    expect(select).toHaveValue('e1');
  });

  it('with no events, says what to do and checks again', async () => {
    let answer = { events: [] };
    serve({ answers: answersWith('eventbrite'), connections: connections({ eventbrite: eventbriteAccount() }) }, { listEventbriteEvents: () => answer });
    renderSetup('tickets');
    await screen.findByText(/Create an upcoming event on Eventbrite/);
    answer = { events: [{ id: 'e1', name: 'Summit', start: null }] };
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Eventbrite events' }));
    expect(await screen.findByRole('combobox', { name: 'Your Eventbrite event' })).toBeInTheDocument();
  });

  it('shows a failed event list in plain words, with a way to try again', async () => {
    serve({ answers: answersWith('eventbrite'), connections: connections({ eventbrite: eventbriteAccount() }) }, {
      listEventbriteEvents: () => { throw new ApiError(502, 'events-failed', 'We could not read your Eventbrite events.'); },
    });
    renderSetup('tickets');
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not read your Eventbrite events.');
    expect(screen.getByRole('button', { name: 'Refresh Eventbrite events' })).toBeInTheDocument();
  });

  it('an Editor sees the state but no buttons', async () => {
    serve({
      answers: answersWith('stripe'),
      myRole: 'editor',
      connections: connections({ canChange: false, canDisconnect: false }),
    });
    renderSetup('tickets');
    expect(await screen.findByText('Connected: NC Local')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Disconnect|Connect/ })).not.toBeInTheDocument();
    expect(screen.getByText('Only an Owner can change this account.')).toBeInTheDocument();
  });

  it('lists a connected account that is no longer the choice, so it can be disconnected', async () => {
    serve({ answers: answersWith('none') });
    renderSetup('tickets');
    expect(await screen.findByRole('region', { name: 'Your Stripe account' })).toBeInTheDocument();
  });

  it('never shows a technical word', async () => {
    serve({ answers: answersWith('stripe'), connections: connections({ stripe: notConnected }) });
    renderSetup('tickets');
    await screen.findByRole('button', { name: 'Connect with Stripe' });
    expect(document.body.textContent).not.toMatch(/token|oauth|webhook|secret|tenant|project/i);
  });
});
