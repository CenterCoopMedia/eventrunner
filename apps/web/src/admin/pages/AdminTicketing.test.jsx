// AdminTicketing (issue #31): provider status, CSV import (mapping, dry-run
// preview, commit), and the ticket search list. Mocks adminApi directly,
// same convention as AdminFeedback.test.jsx — the server contract is what
// matters here, not the transport.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const callMock = vi.fn();
vi.mock('../adminApi.js', () => ({ useAdminApi: () => callMock }));

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
