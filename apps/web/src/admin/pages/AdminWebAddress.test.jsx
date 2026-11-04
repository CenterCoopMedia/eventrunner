// AdminWebAddress: the custom web address, an optional upgrade (ADR 0007 §8).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const callMock = vi.fn();
vi.mock('../adminApi.js', () => ({ useAdminApi: () => callMock }));

import AdminWebAddress from './AdminWebAddress.jsx';

const NONE = { domain: null, state: 'none', records: [], currentAddress: 'https://example-event.eventrunner.org', lastCheckedAt: null };
const RECORDS = [
  { type: 'A', host: 'summit.example.org', value: '199.36.158.100' },
  { type: 'TXT', host: 'summit.example.org', value: 'hosting-site=example-event' },
];
const WAITING = { ...NONE, domain: 'summit.example.org', state: 'records', records: RECORDS, lastCheckedAt: '2026-11-04T15:00:00.000Z' };

function renderPage() {
  return render(<MemoryRouter><AdminWebAddress /></MemoryRouter>);
}

describe('AdminWebAddress', () => {
  beforeEach(() => callMock.mockReset());

  it('says the site already works at its address and the upgrade is optional', async () => {
    callMock.mockResolvedValueOnce(NONE);
    renderPage();
    expect(await screen.findByText('https://example-event.eventrunner.org')).toBeInTheDocument();
    expect(screen.getByText(/optional/i)).toBeInTheDocument();
    expect(callMock).toHaveBeenCalledWith('webAddress', { action: 'status' });
  });

  it('adds a domain and shows each record to add in plain words', async () => {
    callMock.mockResolvedValueOnce(NONE).mockResolvedValueOnce(WAITING);
    renderPage();
    fireEvent.change(await screen.findByLabelText('Your domain'), { target: { value: 'summit.example.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add this address' }));
    const table = await screen.findByRole('table', { name: 'Records to add at your domain provider' });
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getByText('199.36.158.100')).toBeInTheDocument();
    expect(callMock).toHaveBeenLastCalledWith('webAddress', { action: 'add', domain: 'summit.example.org' });
    expect(screen.getByRole('button', { name: 'Check now' })).toBeInTheDocument();
  });

  it('checks now and says what is left when the domain is live', async () => {
    callMock.mockResolvedValueOnce(WAITING).mockResolvedValueOnce({ ...WAITING, state: 'switch', records: [] });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Check now' }));
    expect(await screen.findByText(/hosting team/)).toBeInTheDocument();
    expect(callMock).toHaveBeenLastCalledWith('webAddress', { action: 'check' });
  });

  it('shows a refusal in the server’s words and keeps the typed domain', async () => {
    callMock.mockResolvedValueOnce(NONE).mockRejectedValueOnce(new Error('Enter a domain such as summit.example.org, with no https:// and no path.'));
    renderPage();
    fireEvent.change(await screen.findByLabelText('Your domain'), { target: { value: 'https://summit.example.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add this address' }));
    expect(await screen.findByText(/with no https:\/\/ and no path/)).toBeInTheDocument();
    expect(screen.getByLabelText('Your domain')).toHaveValue('https://summit.example.org');
  });

  it('removes the address after a confirmation', async () => {
    callMock.mockResolvedValueOnce(WAITING).mockResolvedValueOnce(NONE);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove this address' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove address' }));
    expect(await screen.findByLabelText('Your domain')).toBeInTheDocument();
    expect(callMock).toHaveBeenLastCalledWith('webAddress', { action: 'remove' });
  });
});
