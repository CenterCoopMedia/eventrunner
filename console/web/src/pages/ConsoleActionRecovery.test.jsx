import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { application, callsTo, connections, serveApi } from '../test/application.js';
import { renderPage } from '../test/renderPage.jsx';
import ApplicationStatus from './ApplicationStatus.jsx';
import ConsoleSettings from './review/ConsoleSettings.jsx';

vi.mock('../api.js', () => ({ callApi: vi.fn() }));
const SETTINGS = { gcpFolder: 'folders/123456789012', billingAccount: '012345-6789AB-CDEF01', region: 'us-central1' };
const statusPage = () => renderPage(<ApplicationStatus />, { path: '/organizations/o1/applications/a1', route: '/organizations/:orgId/applications/:appId' });
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('Console status and settings recovery', () => {
  it('keeps a failed withdrawal confirmation and error beside the action', async () => {
    const request = deferred();
    serveApi({ getApplication: { application: application() }, withdrawApplication: () => request.promise });
    statusPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw the request' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, withdraw' }));
    expect(screen.getByRole('button', { name: 'Withdrawing…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await act(async () => request.reject(new Error('This request could not be withdrawn.')));
    const confirmation = screen.getByRole('group', { name: 'Withdraw the request' });
    expect(confirmation).toBeInTheDocument();
    expect(within(confirmation.parentElement).getByRole('alert')).toHaveTextContent('This request could not be withdrawn.');
    expect(screen.getByRole('button', { name: 'Yes, withdraw' })).toBeEnabled();
    expect(callsTo('withdrawApplication')).toHaveLength(1);
  });

  it('refreshes a completed withdrawal without offering or sending it again', async () => {
    let reads = 0;
    let withdrawn = false;
    serveApi({ getApplication: () => {
      if (++reads === 2) throw new Error('Current details unavailable.');
      return { application: application({ status: withdrawn ? 'withdrawn' : 'draft', canEdit: !withdrawn, canWithdraw: !withdrawn }) };
    }, withdrawApplication: () => { withdrawn = true; return { status: 'withdrawn' }; } });
    statusPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw the request' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, withdraw' }));
    expect(await screen.findByText(/The request is withdrawn, but we could not refresh/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Withdraw the request' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Continue the setup' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh request' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Refresh request' })).not.toBeInTheDocument());
    expect(callsTo('withdrawApplication')).toHaveLength(1);
    expect(reads).toBe(3);
  });

  it('keeps a disconnected unselected account result at the account, once', async () => {
    let current = connections();
    serveApi({ getApplication: () => ({ application: application({ answers: { ...application().answers, tickets: { choice: 'spreadsheet' } }, connections: current }) }),
      disconnectAccount: () => {
        current = { ...current, stripe: { ...current.stripe, connected: false } };
        return { connections: current, errors: {}, revoked: true, shared: false };
      } });
    statusPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    const result = await screen.findByText('You disconnected your Stripe account.');
    expect(screen.getAllByText('You disconnected your Stripe account.')).toHaveLength(1);
    expect(result.closest('.application-details')).toBeInTheDocument();
    expect(screen.getByText('Your Stripe account')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connect with Stripe' })).not.toBeInTheDocument();
  });

  it('disables submitted settings until saving completes and clears stale success after an edit', async () => {
    const save = deferred();
    serveApi({ getConsoleSettings: { settings: SETTINGS }, saveConsoleSettings: () => save.promise });
    renderPage(<ConsoleSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Save settings' }));
    expect(screen.getByLabelText('Region')).toBeDisabled();
    expect(screen.getByLabelText('Billing account')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled();
    await act(async () => save.resolve({ settings: SETTINGS }));
    const result = await screen.findByText('Settings saved. New sites will use them.');
    expect(result.closest('form')).toContainElement(screen.getByRole('button', { name: 'Save settings' }));
    fireEvent.change(screen.getByLabelText('Region'), { target: { value: 'us-east1' } });
    expect(screen.queryByText('Settings saved. New sites will use them.')).not.toBeInTheDocument();
  });

  it('focuses a refused settings field after it becomes editable again', async () => {
    serveApi({ getConsoleSettings: { settings: SETTINGS }, saveConsoleSettings: () => {
      throw Object.assign(new Error('Use a supported region.'), { field: 'region' });
    } });
    renderPage(<ConsoleSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Save settings' }));
    await screen.findByText('Use a supported region.');
    expect(screen.getByLabelText('Region')).toHaveFocus();
    expect(screen.getByLabelText('Region')).toBeEnabled();
  });
});
