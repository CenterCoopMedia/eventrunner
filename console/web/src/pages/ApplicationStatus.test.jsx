import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { application, callsTo, connections, serveApi } from '../test/application.js';
import { renderPage } from '../test/renderPage.jsx';
import ApplicationStatus from './ApplicationStatus.jsx';

vi.mock('../api.js', () => ({ callApi: vi.fn() }));

const page = () => renderPage(<ApplicationStatus />, {
  path: '/organizations/o1/applications/a1',
  route: '/organizations/:orgId/applications/:appId',
});

function serveStatus(overrides) {
  serveApi({ getApplication: { application: application(overrides) } });
}

describe('ApplicationStatus', () => {
  beforeEach(() => {
    serveStatus({ status: 'submitted', canEdit: false, canSubmit: false, submittedAt: '2026-11-04T15:00:00.000Z' });
  });

  it('shows plain steps with the live state', async () => {
    page();
    expect(await screen.findByRole('heading', { level: 1, name: 'NC Local News Summit' })).toBeInTheDocument();
    expect(screen.getAllByText('We are reviewing your request')).toHaveLength(2);
    const stages = screen.getAllByRole('listitem');
    expect(stages.map((s) => s.textContent)).toEqual([
      'Answer the setup questionsDone',
      'We are reviewing your requestNow',
      'We are building your siteNot started',
      'Your site is readyNot started',
    ]);
    expect(stages[1]).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('nclocal.eventrunner.org')).toBeInTheDocument();
    expect(screen.getByText(/Sent on 4 November 2026/)).toBeInTheDocument();
  });

  it('shows the building and ready states', async () => {
    serveStatus({ status: 'building', canEdit: false, canWithdraw: false });
    page();
    expect(await screen.findAllByText('We are building your site')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Withdraw the request' })).not.toBeInTheDocument();
  });

  it('shows the ready state', async () => {
    serveStatus({ status: 'ready', canEdit: false, canWithdraw: false });
    page();
    const stages = await screen.findAllByRole('listitem');
    expect(stages[3]).toHaveTextContent('Your site is readyNow');
  });

  it('shows the note when changes are requested, with a link to make them', async () => {
    serveStatus({ status: 'changes_requested', note: 'Add the venue address.' });
    page();
    const note = await screen.findByRole('note');
    expect(note).toHaveTextContent('The hosting team asked for changes');
    expect(note).toHaveTextContent('Add the venue address.');
    expect(screen.getByRole('link', { name: 'Make the changes' })).toHaveAttribute('href', '/organizations/o1/applications/a1/review');
  });

  it('offers to continue a draft', async () => {
    serveStatus({ status: 'draft' });
    page();
    expect(await screen.findByRole('link', { name: 'Continue the setup' })).toHaveAttribute('href', '/organizations/o1/applications/a1/organization');
  });

  it('withdraws after one question, and Cancel keeps the request', async () => {
    let status = 'submitted';
    serveApi({
      getApplication: () => ({ application: application({ status, canEdit: false, canWithdraw: status !== 'withdrawn' }) }),
      withdrawApplication: () => { status = 'withdrawn'; return { status }; },
    });
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw the request' }));
    const group = screen.getByRole('group', { name: 'Withdraw the request' });
    expect(within(group).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.click(within(group).getByRole('button', { name: 'Cancel' }));
    expect(callsTo('withdrawApplication')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Withdraw the request' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, withdraw' }));
    expect(await screen.findByText('You withdrew the request.')).toBeInTheDocument();
    expect(await screen.findByText(/This request is withdrawn/)).toBeInTheDocument();
    expect(callsTo('withdrawApplication')).toEqual([{ orgId: 'o1', appId: 'a1' }]);
    expect(screen.queryByRole('button', { name: 'Withdraw the request' })).not.toBeInTheDocument();
  });

  it('shows a declined request with its note', async () => {
    serveStatus({ status: 'declined', note: 'This is not an event.', canEdit: false, canWithdraw: false });
    page();
    expect(await screen.findByRole('note')).toHaveTextContent('This is not an event.');
    expect(screen.getByText('This request is closed.')).toBeInTheDocument();
  });

  describe('the connected account', () => {
    const notConnected = { available: true, connected: false, displayName: null, connectedAt: null };

    it('connects and disconnects until the site is built', async () => {
      let linked = connections();
      serveApi({
        getApplication: () => ({ application: application({ status: 'submitted', canEdit: false, connections: linked }) }),
        disconnectAccount: () => {
          linked = connections({ stripe: notConnected });
          return { connections: linked, errors: {}, revoked: true, shared: false };
        },
      });
      page();
      expect(await screen.findByText('Connected: NC Local')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
      fireEvent.click(screen.getByRole('button', { name: 'Yes, disconnect' }));
      expect(await screen.findByText('You disconnected your Stripe account.')).toBeInTheDocument();
      expect(await screen.findByRole('button', { name: 'Connect with Stripe' })).toBeInTheDocument();
      expect(callsTo('disconnectAccount')).toEqual([{ orgId: 'o1', appId: 'a1', provider: 'stripe' }]);
    });

    it('an Editor sees the account and cannot change it', async () => {
      serveStatus({ status: 'submitted', canEdit: false, myRole: 'editor', connections: connections({ canChange: false, canDisconnect: false }) });
      page();
      expect(await screen.findByText('Connected: NC Local')).toBeInTheDocument();
      expect(screen.getByText('Only an Owner can change this account.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Connect again' })).not.toBeInTheDocument();
    });

    it('from approval on, the account cannot change', async () => {
      serveStatus({ status: 'approved', canEdit: false, canWithdraw: false, connections: connections({ canChange: false, canDisconnect: false }) });
      page();
      expect(await screen.findByText('Connected: NC Local')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Connect again' })).not.toBeInTheDocument();
    });

    it('a closed request can only disconnect, and asks for nothing new', async () => {
      serveStatus({ status: 'withdrawn', canEdit: false, canWithdraw: false, connections: connections({ canChange: false, canDisconnect: true }) });
      page();
      expect(await screen.findByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Connect again' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Connect with Eventbrite' })).not.toBeInTheDocument();
    });

    it('asks nothing of a request that needs no account', async () => {
      const answers = { ...application().answers, tickets: { choice: 'spreadsheet' } };
      serveStatus({ status: 'submitted', canEdit: false, answers, connections: connections({ stripe: notConnected }) });
      page();
      expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Connect with/ })).not.toBeInTheDocument();
    });
  });

  it('shows a load error', async () => {
    serveApi({ getApplication: () => { throw new Error('We could not find that request.'); } });
    page();
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not find that request.');
  });
});
