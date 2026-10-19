import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const state = vi.hoisted(() => ({ eventConfig: {} }));
vi.mock('../contexts/EventConfigContext.jsx', () => ({ useEventConfig: () => ({ eventConfig: state.eventConfig }) }));
vi.mock('../lib/ticketingCommerce.js', () => ({ ticketingRequest: vi.fn() }));
import { ticketingRequest } from '../lib/ticketingCommerce.js';
import RegistrationAction from './RegistrationAction.jsx';

let endpoint = 0;
function surface() {
  return <MemoryRouter><RegistrationAction placement="header" /><RegistrationAction placement="lead" /></MemoryRouter>;
}

describe('registration provider destination', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_FUNCTIONS_ORIGIN', `https://functions-${++endpoint}.example.test`);
    state.eventConfig = { registration: { externalUrl: 'https://register.example.test/event', actionLabel: 'Register externally' } };
    ticketingRequest.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('uses one public lookup to replace both configured external actions with native ticketing', async () => {
    ticketingRequest.mockResolvedValue({ provider: 'stripe', salesEnabled: true, catalogRevision: 3 });
    render(surface());
    await waitFor(() => expect(screen.getAllByRole('link', { name: 'Get tickets' })).toHaveLength(2));
    for (const link of screen.getAllByRole('link')) {
      expect(link).toHaveAttribute('href', '/tickets');
      expect(link).not.toHaveAttribute('target');
    }
    expect(screen.queryByRole('link', { name: /Register externally/ })).not.toBeInTheDocument();
    expect(ticketingRequest).toHaveBeenCalledExactlyOnceWith('ticketingCatalog');
  });

  it('provides a native action even when no external registration destination is configured', async () => {
    state.eventConfig = {};
    ticketingRequest.mockResolvedValue({ provider: 'stripe', salesEnabled: false, catalogRevision: 0 });
    render(surface());
    await waitFor(() => expect(screen.getAllByRole('link', { name: 'Get tickets' })).toHaveLength(2));
  });

  it('shows no ticket action before a Stripe catalog is published', async () => {
    // The public catalog read answers catalogRevision null until staff publish.
    ticketingRequest.mockResolvedValue({
      provider: 'stripe', salesEnabled: false, catalogRevision: null, closedReason: 'Ticket sales are not configured.',
    });
    render(surface());
    await waitFor(() => expect(ticketingRequest).toHaveBeenCalledExactlyOnceWith('ticketingCatalog'));
    await act(async () => {});
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('keeps the native action while a published catalog has paused sales or closed windows', async () => {
    ticketingRequest.mockResolvedValue({
      provider: 'stripe', salesEnabled: false, catalogRevision: 2, closedReason: 'Ticket sales are paused.',
    });
    render(surface());
    await waitFor(() => expect(screen.getAllByRole('link', { name: 'Get tickets' })).toHaveLength(2));
  });

  it.each(['manual', 'eventbrite', 'none'])('preserves the configured external action for %s', async (provider) => {
    ticketingRequest.mockResolvedValue({ provider });
    render(surface());
    await waitFor(() => expect(screen.getAllByRole('link', { name: /Register externally/ })).toHaveLength(2));
    for (const link of screen.getAllByRole('link')) expect(link).toHaveAttribute('href', 'https://register.example.test/event');
    expect(screen.queryByRole('link', { name: 'Get tickets' })).not.toBeInTheDocument();
  });

  it('keeps an unknown provider on the native ticket page instead of switching checkout sources during an outage', async () => {
    ticketingRequest.mockRejectedValue(new Error('Unavailable'));
    render(surface());
    await waitFor(() => expect(screen.getAllByRole('link', { name: 'Get tickets' })).toHaveLength(2));
    for (const link of screen.getAllByRole('link')) expect(link).toHaveAttribute('href', '/tickets');
    expect(screen.queryByRole('link', { name: /Register externally/ })).not.toBeInTheDocument();
  });

  it('waits for the provider decision before presenting a competing external destination', async () => {
    let resolve;
    ticketingRequest.mockImplementation(() => new Promise((done) => { resolve = done; }));
    render(surface());
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    await act(async () => resolve({ provider: 'stripe', catalogRevision: 1 }));
    expect(screen.getAllByRole('link', { name: 'Get tickets' })).toHaveLength(2);
  });

  it('does not probe live ticketing from a historical demo', () => {
    state.eventConfig.historicalDemo = true;
    render(surface());
    expect(screen.getAllByRole('link', { name: /Register externally/ })).toHaveLength(2);
    expect(ticketingRequest).not.toHaveBeenCalled();
  });
});
