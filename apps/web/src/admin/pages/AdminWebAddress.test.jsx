// AdminWebAddress: the custom web address, an optional upgrade (ADR 0007 §8).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const callMock = vi.fn();
vi.mock('../adminApi.js', () => ({ useAdminApi: () => callMock }));

import AdminWebAddress from './AdminWebAddress.jsx';

const NONE = { domain: null, state: 'none', records: [], currentAddress: 'https://example-event.eventrunner.org', lastCheckedAt: null };
const RECORDS = [
  { action: 'add', type: 'A', host: 'summit.example.org', value: '199.36.158.100' },
  { action: 'add', type: 'TXT', host: 'summit.example.org', value: 'hosting-site=example-event' },
  { action: 'remove', type: 'A', host: 'summit.example.org', value: '10.0.0.2' },
];
const WAITING = { ...NONE, domain: 'summit.example.org', state: 'records', records: RECORDS, lastCheckedAt: '2026-11-04T15:00:00.000Z' };

function renderPage() {
  return render(<MemoryRouter><AdminWebAddress /></MemoryRouter>);
}

describe('AdminWebAddress', () => {
  beforeEach(() => callMock.mockReset());

  it('retries an initial failure on the same page', async () => {
    callMock.mockRejectedValueOnce(new Error('Address status could not be loaded.')).mockResolvedValueOnce(NONE);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(NONE.currentAddress)).toBeInTheDocument();
    expect(callMock).toHaveBeenCalledTimes(2);
  });

  it('states the result of a check beside its action and moves focus to it', async () => {
    callMock.mockResolvedValueOnce(WAITING).mockResolvedValueOnce(WAITING);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Check now' }));
    const outcome = await screen.findByText('Address checked. Waiting for the records.');
    expect(outcome.parentElement).toHaveFocus();
    expect(outcome.closest('section')).toContainElement(screen.getByRole('button', { name: 'Check now' }));
  });

  it('shows the current address and directs domain setup to the team', async () => {
    callMock.mockResolvedValueOnce(NONE);
    renderPage();
    expect(await screen.findByText('https://example-event.eventrunner.org')).toBeInTheDocument();
    expect(screen.getByText("Want to use your own domain? Contact us and we'll set it up.")).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /add|remove/i })).toBeNull();
    expect(callMock).toHaveBeenCalledWith('webAddress', { action: 'status' });
  });

  it('shows an existing connection as read-only and keeps the check action', async () => {
    callMock.mockResolvedValueOnce(WAITING);
    renderPage();
    expect(await screen.findByText('summit.example.org')).toBeInTheDocument();
    expect(screen.getByText('Waiting for the records')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /add|remove/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Check now' })).toBeInTheDocument();
    expect(callMock).toHaveBeenCalledTimes(1);
  });

  it('checks now and says what is left when the domain is live', async () => {
    callMock.mockResolvedValueOnce(WAITING).mockResolvedValueOnce({ ...WAITING, state: 'switch', records: [] });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Check now' }));
    expect(await screen.findByText(/hosting team/)).toBeInTheDocument();
    expect(callMock).toHaveBeenLastCalledWith('webAddress', { action: 'check' });
  });

  it('shows a failed check in the server’s words and keeps the connection status', async () => {
    callMock.mockResolvedValueOnce(WAITING).mockRejectedValueOnce(new Error('The web address service did not answer. Try again in a few minutes.'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Check now' }));
    expect(await screen.findByText('The web address service did not answer. Try again in a few minutes.')).toBeInTheDocument();
    expect(screen.getByText('summit.example.org')).toBeInTheDocument();
    expect(callMock).toHaveBeenLastCalledWith('webAddress', { action: 'check' });
  });

  it('shows the status of a domain already in use without setup controls', async () => {
    callMock.mockResolvedValueOnce({ ...WAITING, currentAddress: 'https://summit.example.org', state: 'done', records: [] });
    renderPage();
    expect(await screen.findByText('In use')).toBeInTheDocument();
    expect(screen.getByText('https://summit.example.org')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add|remove|check/i })).toBeNull();
  });
});
