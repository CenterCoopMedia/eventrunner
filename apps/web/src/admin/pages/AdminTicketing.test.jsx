// AdminTicketing (issue #31): provider status, CSV import (mapping, dry-run
// preview, commit), and the ticket search list. Mocks adminApi directly,
// same convention as AdminFeedback.test.jsx — the server contract is what
// matters here, not the transport.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const callMock = vi.fn();
vi.mock('../adminApi.js', () => ({ useAdminApi: () => callMock }));
vi.mock('../../contexts/AuthContext.jsx', () => ({
  useAuth: () => ({ isOperator: false, user: { uid: 'staff-synthetic' } }),
  functionsOrigin: () => 'https://functions.example.test',
}));
vi.mock('../../contexts/EventConfigContext.jsx', () => ({
  useEventConfig: () => ({ eventConfig: { name: 'Synthetic event', timezone: 'UTC' } }),
}));

import AdminTicketing from './AdminTicketing.jsx';

const STATUS = {
  provider: 'manual',
  externalEventId: null,
  webhookSupported: false,
  webhookRegisteredAt: null,
  webhookId: null,
  lastDeliveryAt: null,
  queue: { pending: 0, pendingCapped: false, exhausted: 0, exhaustedCapped: false, oldestReadyAt: null },
  checkedAt: '2026-08-22T00:00:00.000Z',
};

function csvFile(text) {
  const file = new File([text], 'tickets.csv', { type: 'text/csv' });
  // jsdom's File.text() exists in modern jsdom; polyfill just in case.
  if (typeof file.text !== 'function') file.text = async () => text;
  return file;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('AdminTicketing', () => {
  beforeEach(() => {
    callMock.mockReset();
    callMock.mockImplementation((name) => {
      if (name === 'getTicketingStatus') return Promise.resolve(STATUS);
      if (name === 'ticketingListTickets') return Promise.resolve({ tickets: [], nextCursor: null });
      return Promise.reject(new Error(`unexpected call: ${name}`));
    });
  });

  it('loads and renders the provider status card', async () => {
    render(<AdminTicketing />);
    await waitFor(() => expect(screen.getByText('manual')).toBeInTheDocument());
    expect(callMock).toHaveBeenCalledWith('getTicketingStatus', {});
  });

  it('mounts no provider workspace or ticket reads while provider status is pending', async () => {
    let resolveStatus;
    callMock.mockImplementation((name, body) => {
      if (name === 'getTicketingStatus') return new Promise((resolve) => { resolveStatus = resolve; });
      if (name === 'ticketingListTickets') return Promise.resolve({ tickets: [], nextCursor: null });
      if (body.action === 'catalog') return Promise.resolve({ mode: 'test', catalog: { published: false, currency: 'usd', ticketTypes: [] } });
      if (body.action === 'orders') return Promise.resolve({ orders: [], nextCursor: null });
      if (body.action === 'tickets') return Promise.resolve({ tickets: [], nextCursor: null });
      return Promise.reject(new Error(`unexpected call: ${name}`));
    });
    render(<AdminTicketing />);
    expect(screen.getByRole('status', { name: 'Loading ticketing status…' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Import tickets from a CSV' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Ticket code for check-in')).not.toBeInTheDocument();
    expect(callMock).toHaveBeenCalledTimes(1);

    await act(async () => resolveStatus({ ...STATUS, provider: 'stripe' }));
    expect(await screen.findByRole('heading', { name: 'Stripe sales' })).toBeInTheDocument();
    expect(callMock).not.toHaveBeenCalledWith('ticketingListTickets', expect.anything());
  });

  it('keeps provider workspaces closed after a status failure and recovers through Refresh', async () => {
    let statusCalls = 0;
    callMock.mockImplementation((name) => {
      if (name === 'getTicketingStatus') {
        statusCalls += 1;
        return statusCalls === 1 ? Promise.reject(new Error('The provider could not be confirmed.')) : Promise.resolve(STATUS);
      }
      if (name === 'ticketingListTickets') return Promise.resolve({ tickets: [], nextCursor: null });
      return Promise.reject(new Error(`unexpected call: ${name}`));
    });
    render(<AdminTicketing />);
    await screen.findByText('The provider could not be confirmed.');
    expect(screen.queryByRole('heading', { name: 'Import tickets from a CSV' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Ticket code for check-in')).not.toBeInTheDocument();
    expect(callMock).not.toHaveBeenCalledWith('ticketingListTickets', expect.anything());
    const refresh = screen.getByRole('button', { name: 'Refresh' });
    expect(refresh).toBeEnabled();

    fireEvent.click(refresh);
    expect(await screen.findByRole('heading', { name: 'Import tickets from a CSV' })).toBeInTheDocument();
    expect(statusCalls).toBe(2);
    expect(callMock.mock.calls.filter(([name]) => name === 'ticketingListTickets')).toHaveLength(1);
  });

  it('does not treat an unrecognized provider as permission to import manual tickets', async () => {
    callMock.mockImplementation((name) => {
      if (name === 'getTicketingStatus') return Promise.resolve({ ...STATUS, provider: 'unrecognized-provider' });
      if (name === 'ticketingListTickets') return Promise.resolve({ tickets: [], nextCursor: null });
      return Promise.reject(new Error(`unexpected call: ${name}`));
    });
    render(<AdminTicketing />);
    await screen.findByText('unrecognized-provider');
    expect(screen.queryByRole('heading', { name: 'Import tickets from a CSV' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Ticket code for check-in')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
    expect(callMock).not.toHaveBeenCalledWith('ticketingListTickets', expect.anything());
  });

  it.each(['manual', 'eventbrite', 'none'])('preserves the existing import and ticket list for a confirmed %s provider', async (provider) => {
    callMock.mockImplementation((name) => {
      if (name === 'getTicketingStatus') return Promise.resolve({ ...STATUS, provider });
      if (name === 'ticketingListTickets') return Promise.resolve({ tickets: [], nextCursor: null });
      return Promise.reject(new Error(`unexpected call: ${name}`));
    });
    render(<AdminTicketing />);
    expect(await screen.findByRole('heading', { name: 'Import tickets from a CSV' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tickets', exact: true })).toBeInTheDocument();
    expect(callMock.mock.calls.filter(([name]) => name === 'ticketingListTickets')).toHaveLength(1);
    expect(callMock).not.toHaveBeenCalledWith('ticketingCommerceAdmin', expect.anything());
  });

  it('does not keep an earlier manual workspace open while refreshing or after refresh fails', async () => {
    let rejectStatus;
    let statusCalls = 0;
    callMock.mockImplementation((name) => {
      if (name === 'getTicketingStatus') {
        statusCalls += 1;
        return statusCalls === 1 ? Promise.resolve(STATUS) : new Promise((_resolve, reject) => { rejectStatus = reject; });
      }
      if (name === 'ticketingListTickets') return Promise.resolve({ tickets: [], nextCursor: null });
      return Promise.reject(new Error(`unexpected call: ${name}`));
    });
    render(<AdminTicketing />);
    await screen.findByRole('heading', { name: 'Import tickets from a CSV' });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(screen.queryByRole('heading', { name: 'Import tickets from a CSV' })).not.toBeInTheDocument();

    await act(async () => rejectStatus(new Error('Provider refresh failed.')));
    expect(await screen.findByText('Provider refresh failed.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Import tickets from a CSV' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
  });

  it('loads the Stripe workspace without replacing the provider controls or moving keyboard focus', async () => {
    let resolveCatalog;
    callMock.mockImplementation((name, body) => {
      if (name === 'getTicketingStatus') return Promise.resolve({ ...STATUS, provider: 'stripe' });
      if (name === 'ticketingListTickets') return Promise.resolve({ tickets: [], nextCursor: null });
      if (body.action === 'catalog') return new Promise((resolve) => { resolveCatalog = resolve; });
      if (body.action === 'orders') return Promise.resolve({ orders: [], nextCursor: null });
      if (body.action === 'tickets') return Promise.resolve({ tickets: [], nextCursor: null });
      return Promise.reject(new Error(`unexpected call: ${name}`));
    });
    render(<AdminTicketing />);
    expect(await screen.findByRole('status', { name: 'Loading Stripe ticketing…' })).toBeInTheDocument();
    await waitFor(() => expect(callMock).toHaveBeenCalledWith('ticketingCommerceAdmin', { action: 'catalog' }));
    const refresh = screen.getByRole('button', { name: 'Refresh' });
    refresh.focus();
    expect(screen.queryByRole('heading', { name: 'Import tickets from a CSV' })).not.toBeInTheDocument();

    await act(async () => resolveCatalog({ mode: 'test', catalog: { published: false, currency: 'usd', ticketTypes: [] } }));
    expect(await screen.findByRole('heading', { name: 'Stripe sales' })).toBeInTheDocument();
    expect(screen.getByLabelText('Ticket code for check-in')).toBeInTheDocument();
    expect(refresh).toHaveFocus();
    expect(screen.queryByRole('status', { name: 'Loading Stripe ticketing…' })).not.toBeInTheDocument();
  });

  it('retries an initial Stripe catalog failure in place and clears the stale error', async () => {
    let catalogCalls = 0;
    let resolveCatalog;
    callMock.mockImplementation((name, body) => {
      if (name === 'getTicketingStatus') return Promise.resolve({ ...STATUS, provider: 'stripe' });
      if (name === 'ticketingListTickets') return Promise.resolve({ tickets: [], nextCursor: null });
      if (body.action === 'catalog') {
        catalogCalls += 1;
        return catalogCalls === 1 ? Promise.reject(new Error('The Stripe catalog is temporarily unavailable.')) : new Promise((resolve) => { resolveCatalog = resolve; });
      }
      if (body.action === 'orders') return Promise.resolve({ orders: [], nextCursor: null });
      if (body.action === 'tickets') return Promise.resolve({ tickets: [], nextCursor: null });
      return Promise.reject(new Error(`unexpected call: ${name}`));
    });
    render(<AdminTicketing />);
    expect(await screen.findByText('The Stripe catalog is temporarily unavailable.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
    expect(screen.getByRole('heading', { name: 'Ticketing' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Import tickets from a CSV' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry Stripe ticketing' }));
    expect(screen.queryByText('The Stripe catalog is temporarily unavailable.')).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading Stripe ticketing…' })).toBeInTheDocument();
    await waitFor(() => expect(catalogCalls).toBe(2));
    await act(async () => resolveCatalog({ mode: 'test', catalog: { published: false, currency: 'usd', ticketTypes: [] } }));
    expect(await screen.findByRole('heading', { name: 'Stripe sales' })).toBeInTheDocument();
    expect(screen.getByLabelText('Ticket code for check-in')).toBeInTheDocument();
    expect(screen.queryByText('The Stripe catalog is temporarily unavailable.')).not.toBeInTheDocument();
    expect(callMock.mock.calls.filter(([name]) => name === 'getTicketingStatus')).toHaveLength(1);
  });

  it('does not show a webhook registration row when the provider does not support webhooks', async () => {
    render(<AdminTicketing />);
    await waitFor(() => expect(screen.getByText('manual')).toBeInTheDocument());
    expect(screen.queryByText('Webhook registration')).not.toBeInTheDocument();
  });

  it('shows "not registered" plus the operator command for a webhook-capable provider with no registration yet', async () => {
    callMock.mockImplementation((name) => {
      if (name === 'getTicketingStatus') {
        return Promise.resolve({
          ...STATUS, provider: 'eventbrite', webhookSupported: true, webhookRegisteredAt: null, webhookId: null,
        });
      }
      if (name === 'ticketingListTickets') return Promise.resolve({ tickets: [], nextCursor: null });
      return Promise.reject(new Error(`unexpected call: ${name}`));
    });
    render(<AdminTicketing />);
    await waitFor(() => expect(screen.getByText('eventbrite')).toBeInTheDocument());
    expect(screen.getByText('Webhook registration')).toBeInTheDocument();
    expect(screen.getByText(/Not registered/)).toBeInTheDocument();
    expect(screen.getByText('node scripts/register-ticketing-webhook.cjs')).toBeInTheDocument();
  });

  it('shows the registration timestamp and webhook id once registered', async () => {
    callMock.mockImplementation((name) => {
      if (name === 'getTicketingStatus') {
        return Promise.resolve({
          ...STATUS,
          provider: 'eventbrite',
          webhookSupported: true,
          webhookRegisteredAt: '2026-08-20T12:00:00.000Z',
          webhookId: 'hook-42',
        });
      }
      if (name === 'ticketingListTickets') return Promise.resolve({ tickets: [], nextCursor: null });
      return Promise.reject(new Error(`unexpected call: ${name}`));
    });
    render(<AdminTicketing />);
    await waitFor(() => expect(screen.getByText('eventbrite')).toBeInTheDocument());
    expect(screen.getByText(/Registered 2026-08-20T12:00:00\.000Z \(id hook-42\)/)).toBeInTheDocument();
  });

  it('surfaces a status load error without crashing the page', async () => {
    callMock.mockImplementation((name) => {
      if (name === 'getTicketingStatus') return Promise.reject(new Error('The server is unreachable.'));
      if (name === 'ticketingListTickets') return Promise.resolve({ tickets: [], nextCursor: null });
      return Promise.reject(new Error('unexpected'));
    });
    render(<AdminTicketing />);
    await waitFor(() => expect(screen.getByText('The server is unreachable.')).toBeInTheDocument());
  });

  it('parses a CSV, auto-maps obvious headers, and previews a dry run', async () => {
    render(<AdminTicketing />);
    await waitFor(() => expect(screen.getByText('manual')).toBeInTheDocument());

    const file = csvFile('Email,Order ID,Name\na@example.com,ord-1,Ada Lovelace\n');
    const input = document.getElementById('ticketing-csv-file');
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByText(/1 row/)).toBeInTheDocument());

    callMock.mockImplementationOnce(() => Promise.resolve({
      ok: true,
      dryRun: true,
      total: 1,
      summary: { create: 1, update: 0, duplicate: 0, invalid: 0 },
      rows: [{ index: 0, verdict: 'create', externalId: 'ord-1', email: 'a@example.com' }],
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
    await flush();

    expect(callMock).toHaveBeenCalledWith(
      'ticketingImportCsv',
      expect.objectContaining({
        mapping: expect.objectContaining({ email: 'Email', id: 'Order ID' }),
        dryRun: true,
      }),
    );
    await waitFor(() => expect(screen.getByText('1 New ticket')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Commit 1 tickets' })).toBeInTheDocument();
  });

  it('commits after a preview, using dryRun: false, and reports the summary', async () => {
    render(<AdminTicketing />);
    await waitFor(() => expect(screen.getByText('manual')).toBeInTheDocument());

    const file = csvFile('Email,Order ID\na@example.com,ord-1\n');
    const input = document.getElementById('ticketing-csv-file');
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText(/1 row/)).toBeInTheDocument());

    callMock.mockImplementationOnce(() => Promise.resolve({
      ok: true,
      dryRun: true,
      total: 1,
      summary: { create: 1, update: 0, duplicate: 0, invalid: 0 },
      rows: [{ index: 0, verdict: 'create', externalId: 'ord-1', email: 'a@example.com' }],
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
    await flush();

    callMock.mockImplementationOnce(() => Promise.resolve({
      ok: true,
      dryRun: false,
      total: 1,
      created: 1,
      updated: 0,
      summary: { create: 1, update: 0, duplicate: 0, invalid: 0 },
      rows: [{ index: 0, verdict: 'create', externalId: 'ord-1', email: 'a@example.com' }],
    }));
    fireEvent.click(screen.getByRole('button', { name: /Commit/ }));
    await flush();

    expect(callMock).toHaveBeenCalledWith(
      'ticketingImportCsv',
      expect.objectContaining({ dryRun: false }),
    );
    await waitFor(() => expect(screen.getByText(/Imported: 1 new, 0 updated/)).toBeInTheDocument());
  });

  it('surfaces a preview error verbatim, without writing anything', async () => {
    render(<AdminTicketing />);
    await waitFor(() => expect(screen.getByText('manual')).toBeInTheDocument());

    const file = csvFile('Email,Order ID\na@example.com,ord-1\n');
    const input = document.getElementById('ticketing-csv-file');
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText(/1 row/)).toBeInTheDocument());

    callMock.mockImplementationOnce(() => Promise.reject(new Error('rows: at most 500 rows per import')));
    fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
    await flush();

    await waitFor(() => expect(screen.getByText('rows: at most 500 rows per import')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Commit/ })).not.toBeInTheDocument();
  });

  it('searches tickets by email', async () => {
    render(<AdminTicketing />);
    await waitFor(() => expect(screen.getByText('manual')).toBeInTheDocument());

    callMock.mockImplementationOnce((name, body) => {
      expect(name).toBe('ticketingListTickets');
      expect(body).toEqual({ email: 'a@example.com' });
      return Promise.resolve({
        tickets: [{ id: 'tkt-1', email: 'a@example.com', status: 'valid', claimedByUid: null }],
        nextCursor: null,
      });
    });

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await flush();

    await waitFor(() => expect(screen.getByText('tkt-1')).toBeInTheDocument());
  });
});
