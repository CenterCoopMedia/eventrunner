// AdminTicketing (issue #31): provider status, CSV import (mapping, dry-run
// preview, commit), and the ticket search list. Mocks adminApi directly,
// same convention as AdminFeedback.test.jsx — the server contract is what
// matters here, not the transport.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

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
    await waitFor(() => expect(screen.getByText('Manual list')).toBeInTheDocument());
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
    await screen.findByText('Other');
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
    await waitFor(() => expect(screen.getByText('Manual list')).toBeInTheDocument());
    expect(screen.queryByText('Connection')).not.toBeInTheDocument();
  });

  it('shows "not connected" without an operator command for a webhook-capable provider with no registration yet', async () => {
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
    await waitFor(() => expect(screen.getByText('Eventbrite')).toBeInTheDocument());
    expect(screen.getByText('Connection')).toBeInTheDocument();
    expect(screen.getByText('Not connected. Contact support to connect ticket updates.')).toBeInTheDocument();
    expect(screen.queryByText(/register-ticketing-webhook/)).not.toBeInTheDocument();
  });

  it('shows the local connection time and no webhook id once registered', async () => {
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
    await waitFor(() => expect(screen.getByText('Eventbrite')).toBeInTheDocument());
    expect(screen.getByText(`Connected on ${new Date('2026-08-20T12:00:00.000Z').toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`)).toBeInTheDocument();
    expect(screen.queryByText(/hook-42/)).not.toBeInTheDocument();
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
    await waitFor(() => expect(screen.getByText('Manual list')).toBeInTheDocument());

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
    expect(screen.getByRole('button', { name: 'Import 1 tickets' })).toBeInTheDocument();
  });

  it.each([
    ['"unclosed', 'CSV has an unclosed quoted field.'],
    ['John "JJ" Smith', 'CSV quotes must enclose the whole field.'],
    ['"closed" tail', 'CSV quoted fields must end at a comma or line break.'],
  ])('shows the CSV syntax refusal for %s and clears the previous file', async (name, message) => {
    render(<AdminTicketing />);
    await screen.findByText('Manual list');
    const input = document.getElementById('ticketing-csv-file');
    await act(async () => { fireEvent.change(input, { target: { files: [csvFile('Email,Order ID,Name\none@example.test,ord-1,Ada')] } }); });
    expect(await screen.findByRole('button', { name: 'Preview import' })).toBeEnabled();
    await act(async () => { fireEvent.change(input, { target: { files: [csvFile(`Email,Order ID,Name\none@example.test,ord-2,${name}`)] } }); });
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByRole('button', { name: 'Preview import' })).not.toBeInTheDocument();
    expect(callMock).not.toHaveBeenCalledWith('ticketingImportCsv', expect.anything());
  });

  it('keeps a file-read failure separate from CSV syntax errors', async () => {
    render(<AdminTicketing />);
    await screen.findByText('Manual list');
    await act(async () => {
      fireEvent.change(document.getElementById('ticketing-csv-file'), { target: { files: [{ name: 'unreadable.csv', text: async () => { throw new Error('Device read failed'); } }] } });
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('That file could not be read as text.');
    expect(callMock).not.toHaveBeenCalledWith('ticketingImportCsv', expect.anything());
  });

  it('commits after a preview, using dryRun: false, and reports the summary', async () => {
    render(<AdminTicketing />);
    await waitFor(() => expect(screen.getByText('Manual list')).toBeInTheDocument());

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
    fireEvent.click(screen.getByRole('button', { name: /^Import \d+ tickets/ }));
    await flush();

    expect(callMock).toHaveBeenCalledWith(
      'ticketingImportCsv',
      expect.objectContaining({ dryRun: false }),
    );
    await waitFor(() => expect(screen.getByText(/Imported: 1 new, 0 updated/)).toBeInTheDocument());
  });

  it('surfaces a preview error verbatim, without writing anything', async () => {
    render(<AdminTicketing />);
    await waitFor(() => expect(screen.getByText('Manual list')).toBeInTheDocument());

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
    expect(screen.queryByRole('button', { name: /^Import \d+ tickets/ })).not.toBeInTheDocument();
  });

  it('searches tickets by email', async () => {
    render(<AdminTicketing />);
    await waitFor(() => expect(screen.getByText('Manual list')).toBeInTheDocument());

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

    await waitFor(() => expect(screen.getByRole('cell', { name: 'Valid' })).toBeInTheDocument());
    expect(screen.queryByText('tkt-1')).not.toBeInTheDocument();
  });

  it('loads more with the filter that produced the list, not the edited form', async () => {
    render(<AdminTicketing />);
    await waitFor(() => expect(screen.getByText('Manual list')).toBeInTheDocument());

    callMock.mockImplementationOnce(() => Promise.resolve({
      tickets: [{ id: 'tkt-1', email: 'a@example.com', status: 'valid', claimedByUid: null }],
      nextCursor: 'cursor-1',
    }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const loadMore = await screen.findByRole('button', { name: 'Load more' });

    // Edited but not searched: the next page still belongs to a@example.com.
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'b@example.com' } });
    callMock.mockImplementationOnce(() => Promise.resolve({ tickets: [], nextCursor: null }));
    fireEvent.click(loadMore);
    await flush();

    expect(callMock).toHaveBeenLastCalledWith('ticketingListTickets', { email: 'a@example.com', cursor: 'cursor-1' });
  });
});

function apiError(code, status, message = 'Server words.') {
  return Object.assign(new Error(message), { code, status });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('AdminTicketing sync all tickets', () => {
  const SYNC_STATUS = { ...STATUS, provider: 'eventbrite', webhookSupported: true, fullSyncSupported: true };

  function mockWith(sync) {
    callMock.mockReset();
    callMock.mockImplementation((name) => {
      if (name === 'getTicketingStatus') return Promise.resolve(SYNC_STATUS);
      if (name === 'ticketingListTickets') return Promise.resolve({ tickets: [], nextCursor: null });
      if (name === 'ticketingSync') return sync();
      return Promise.reject(new Error(`unexpected call: ${name}`));
    });
  }

  it('shows the action only when the status says the provider supports a full sync', async () => {
    callMock.mockReset();
    callMock.mockImplementation((name) => {
      if (name === 'getTicketingStatus') return Promise.resolve({ ...STATUS, fullSyncSupported: false });
      if (name === 'ticketingListTickets') return Promise.resolve({ tickets: [], nextCursor: null });
      return Promise.reject(new Error(`unexpected call: ${name}`));
    });
    render(<AdminTicketing />);
    await screen.findByText('Manual list');
    expect(screen.queryByRole('button', { name: 'Sync all tickets' })).not.toBeInTheDocument();
  });

  it('confirms, shows the busy state, then states the counts and reloads the status', async () => {
    const sync = deferred();
    mockWith(() => sync.promise);
    render(<AdminTicketing />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sync all tickets' }));

    const dialog = screen.getByRole('dialog', { name: 'Sync all tickets?' });
    expect(dialog).toHaveTextContent('Event Runner reads every ticket from Eventbrite and updates the tickets here.');
    expect(dialog).toHaveTextContent('Claimed tickets stay claimed.');
    expect(callMock).not.toHaveBeenCalledWith('ticketingSync', expect.anything());

    fireEvent.click(within(dialog).getByRole('button', { name: 'Sync all tickets' }));
    const busy = within(dialog).getByRole('button', { name: 'Syncing…' });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(busy);
    expect(callMock.mock.calls.filter(([name]) => name === 'ticketingSync')).toHaveLength(1);
    expect(callMock).toHaveBeenCalledWith('ticketingSync', {});

    await act(async () => sync.resolve({ ok: true, created: 3, updated: 1, skipped: 2, pages: 1, truncated: false, nextCursor: null }));
    expect(await screen.findByText('Sync finished. It saved 3 new tickets and checked 1 existing ticket. 2 records had no ticket reference and Event Runner skipped them.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(callMock.mock.calls.filter(([name]) => name === 'getTicketingStatus')).toHaveLength(2));
  });

  async function startSync() {
    fireEvent.click(await screen.findByRole('button', { name: 'Sync all tickets' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sync all tickets' }));
  }

  it('offers Continue sync after a stopped run and adds up the runs until the sync is complete', async () => {
    const runs = [
      () => Promise.resolve({ ok: true, created: 2, updated: 40, skipped: 0, pages: 9, truncated: true, stoppedReason: 'time-limit', nextCursor: 'page-10' }),
      () => continued.promise,
    ];
    const continued = deferred();
    mockWith(() => runs.shift()());
    render(<AdminTicketing />);
    await startSync();

    expect(await screen.findByText('The sync stopped at its time limit before it reached every ticket. So far the sync saved 2 new tickets and checked 40 existing tickets. Select Continue sync to go on from where it stopped.')).toBeInTheDocument();
    expect(screen.queryByText(/contact support to sync/i)).not.toBeInTheDocument();
    expect(callMock.mock.calls.filter(([name]) => name === 'ticketingSync')[0][1]).toEqual({});

    fireEvent.click(screen.getByRole('button', { name: 'Continue sync' }));
    const busy = screen.getByRole('button', { name: 'Syncing…' });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(busy);
    expect(callMock.mock.calls.filter(([name]) => name === 'ticketingSync')).toHaveLength(2);
    expect(callMock).toHaveBeenLastCalledWith('ticketingSync', { cursor: 'page-10' });

    await act(async () => continued.resolve({ ok: true, created: 1, updated: 5, skipped: 0, pages: 2, truncated: false, nextCursor: null }));
    expect(await screen.findByText('Sync finished. Across 2 runs it saved 3 new tickets and checked 45 existing tickets.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue sync' })).not.toBeInTheDocument();
  });

  it('starts a fresh Sync all tickets from the beginning, with new totals', async () => {
    const runs = [
      () => Promise.resolve({ ok: true, created: 2, updated: 0, skipped: 0, pages: 50, truncated: true, stoppedReason: 'page-limit', nextCursor: 'page-51' }),
      () => Promise.resolve({ ok: true, created: 0, updated: 7, skipped: 0, pages: 1, truncated: false, nextCursor: null }),
    ];
    mockWith(() => runs.shift()());
    render(<AdminTicketing />);
    await startSync();
    await screen.findByRole('button', { name: 'Continue sync' });
    await startSync();

    expect(await screen.findByText('Sync finished. It saved 0 new tickets and checked 7 existing tickets.')).toBeInTheDocument();
    const syncCalls = callMock.mock.calls.filter(([name]) => name === 'ticketingSync');
    expect(syncCalls.map(([, body]) => body)).toEqual([{}, {}]);
  });

  it('says a provider failure stopped the run and Continue retries the failed page', async () => {
    mockWith(() => Promise.resolve({ ok: true, created: 0, updated: 25, skipped: 0, pages: 1, truncated: true, stoppedReason: 'provider-error', nextCursor: 'ord_0025' }));
    render(<AdminTicketing />);
    await startSync();
    expect(await screen.findByText('The sync stopped because the ticketing provider could not be read. So far the sync saved 0 new tickets and checked 25 existing tickets. Select Continue sync to go on from where it stopped.')).toBeInTheDocument();
  });

  it('tells staff to start again when a stopped run has no point to continue from', async () => {
    mockWith(() => Promise.resolve({ ok: true, created: 1, updated: 0, skipped: 0, pages: 0, truncated: true, stoppedReason: 'provider-error', nextCursor: null }));
    render(<AdminTicketing />);
    await startSync();
    expect(await screen.findByText('The sync stopped because the ticketing provider could not be read. So far the sync saved 1 new ticket and checked 0 existing tickets. Select Sync all tickets to start again from the beginning.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue sync' })).not.toBeInTheDocument();
  });

  it('drops the cursor the provider refuses and says to start again', async () => {
    const words = 'The sync cannot continue from this point. Start the sync again from the beginning.';
    const runs = [
      () => Promise.resolve({ ok: true, created: 0, updated: 3, skipped: 0, pages: 9, truncated: true, stoppedReason: 'time-limit', nextCursor: 'stale' }),
      () => Promise.reject(apiError('bad-cursor', 400, words)),
    ];
    mockWith(() => runs.shift()());
    render(<AdminTicketing />);
    await startSync();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue sync' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(words);
    expect(screen.queryByRole('button', { name: 'Continue sync' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sync all tickets' })).toBeInTheDocument();
  });

  it('keeps Continue sync after a continued run that did not answer', async () => {
    const runs = [
      () => Promise.resolve({ ok: true, created: 0, updated: 3, skipped: 0, pages: 9, truncated: true, stoppedReason: 'time-limit', nextCursor: 'page-10' }),
      () => Promise.reject(apiError('network', 0, 'We could not reach the server.')),
    ];
    mockWith(() => runs.shift()());
    render(<AdminTicketing />);
    await startSync();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue sync' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The sync did not answer. Some tickets may be saved. Run the sync again. It does not make duplicate tickets.');
    expect(screen.getByRole('button', { name: 'Continue sync' })).toBeInTheDocument();
  });

  it('says when the read-only demo stopped the sync', async () => {
    mockWith(() => Promise.resolve({ ok: true, created: 0, updated: 0, skipped: 0, pages: 0, truncated: false, skippedReason: 'read-only-demo' }));
    render(<AdminTicketing />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sync all tickets' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sync all tickets' }));
    expect(await screen.findByText('This historical demo is read-only. No tickets changed.')).toBeInTheDocument();
  });

  it('keeps the dialog open with the provider words on a provider failure', async () => {
    const words = 'The sync stopped because the ticketing provider could not be read. Before it stopped, it saved 2 new tickets and checked 0 existing tickets. Try again in a few minutes.';
    mockWith(() => Promise.reject(apiError('provider-error', 502, words)));
    render(<AdminTicketing />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sync all tickets' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sync all tickets' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(words);
    expect(within(dialog).getByRole('button', { name: 'Sync all tickets' })).toBeInTheDocument();
  });

  it('says a new run is safe when the sync did not answer', async () => {
    mockWith(() => Promise.reject(apiError('unknown', 504, 'Something went wrong. Try again.')));
    render(<AdminTicketing />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sync all tickets' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sync all tickets' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The sync did not answer. Some tickets may be saved. Run the sync again. It does not make duplicate tickets.');
  });
});

describe('AdminTicketing create account from ticket', () => {
  const TICKETS = [
    { id: 'tkt-open', email: 'ada@example.com', firstName: 'Ada', status: 'valid', claimedByUid: null },
    { id: 'tkt-claimed', email: 'bo@example.com', status: 'valid', claimedByUid: 'uid-bo' },
    { id: 'tkt-refunded', email: 'cy@example.com', status: 'refunded', claimedByUid: null },
    { id: 'tkt-no-email', email: null, status: 'valid', claimedByUid: null },
  ];

  function mockWith(create) {
    callMock.mockReset();
    callMock.mockImplementation((name, body) => {
      if (name === 'getTicketingStatus') return Promise.resolve(STATUS);
      if (name === 'ticketingListTickets') return Promise.resolve({ tickets: TICKETS, nextCursor: null });
      if (name === 'createUserFromTicket') return create(body);
      return Promise.reject(new Error(`unexpected call: ${name}`));
    });
  }

  it('offers the action only for an unclaimed valid ticket with an email', async () => {
    mockWith(() => Promise.reject(new Error('not called')));
    render(<AdminTicketing />);
    await screen.findByText('ada@example.com');
    const actions = screen.getAllByRole('button', { name: /^Create account for / });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toHaveAccessibleName('Create account for ada@example.com');
  });

  it('names the address, shows the busy state, then claims the row', async () => {
    const create = deferred();
    mockWith(() => create.promise);
    render(<AdminTicketing />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create account for ada@example.com' }));

    const dialog = screen.getByRole('dialog', { name: 'Create an account from this ticket?' });
    expect(dialog).toHaveTextContent('Event Runner creates a sign-in account for ada@example.com and claims this ticket for it.');
    expect(dialog).toHaveTextContent('The person then signs in with a code sent to this address.');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Create account and claim ticket' }));
    expect(within(dialog).getByRole('button', { name: 'Creating…' })).toHaveAttribute('aria-busy', 'true');
    expect(callMock).toHaveBeenCalledWith('createUserFromTicket', { externalId: 'tkt-open' });

    await act(async () => create.resolve({ ok: true, uid: 'new-1', created: true, registrationStatus: 'ticketed' }));
    const result = await screen.findByText('Account created for ada@example.com. The ticket is claimed.');
    expect(result.parentElement).toHaveFocus();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Create account for / })).not.toBeInTheDocument();
    const row = screen.getByText('ada@example.com').closest('tr');
    expect(within(row).getByRole('cell', { name: 'Yes' })).toBeInTheDocument();
  });

  it('says when the address already had an account', async () => {
    mockWith(() => Promise.resolve({ ok: true, uid: 'uid-ada', created: false, registrationStatus: 'ticketed' }));
    render(<AdminTicketing />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create account for ada@example.com' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Create account and claim ticket' }));
    expect(await screen.findByText('ada@example.com already had an account. The ticket is now claimed for it.')).toBeInTheDocument();
  });

  it.each([
    [apiError('conflict', 409, 'Only a valid ticket can be claimed.'), 'This ticket could not be claimed. Its status may have changed. Search again to see the current status.'],
    [apiError('not-found', 404, 'No such ticket.'), 'This ticket is no longer in the list. Search again.'],
    [apiError('unprocessable', 422, 'That ticket carries no email address.'), 'This ticket has no email address. Add the address to the ticket, then try again.'],
    [apiError('read-only-demo', 403, 'This historical demo is read-only. Account, feedback, and email actions are disabled.'), 'This historical demo is read-only. Account, feedback, and email actions are disabled.'],
    [apiError('unknown', 500, 'Something went wrong. Try again.'), 'The account could not be created. Try again. If the problem continues, contact support.'],
  ])('shows words the staff member can act on for %s', async (err, words) => {
    mockWith(() => Promise.reject(err));
    render(<AdminTicketing />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create account for ada@example.com' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create account and claim ticket' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(words);
    expect(screen.getByRole('button', { name: 'Create account for ada@example.com' })).toBeInTheDocument();
  });
});
