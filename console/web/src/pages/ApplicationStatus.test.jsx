import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../auth.jsx';
import { application, callsTo, connections, fullAnswers, serveApi } from '../test/application.js';
import { fakeAuth, renderPage } from '../test/renderPage.jsx';
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
    serveStatus({ status: 'approved', canEdit: false, canWithdraw: false });
  });

  it('shows plain steps with the live state', async () => {
    serveStatus({
      status: 'approved',
      canEdit: false,
      canWithdraw: false,
      acceptance: { version: 1, name: 'Ana Owner', at: '2026-11-04T15:00:00.000Z' },
    });
    page();
    expect(await screen.findByRole('heading', { level: 1, name: 'NC Local News Summit' })).toBeInTheDocument();
    expect(screen.getAllByText('We are building your site')).toHaveLength(2);
    const stages = screen.getAllByRole('listitem');
    expect(stages.map((s) => s.textContent)).toEqual([
      'Answer the setup questions and accept the agreementDone',
      'We are building your siteNow',
      'Your site is readyNot started',
    ]);
    expect(stages[1]).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('nclocal.eventrunner.org')).toBeInTheDocument();
    expect(screen.getByText(/Ana Owner accepted the agreement on 4 November 2026/)).toBeInTheDocument();
  });

  it('tells a client they can leave during a build, and what is next', async () => {
    serveStatus({ status: 'building', myRole: 'owner', canEdit: false, canWithdraw: false, build: { failed: false, needsReconnect: false, current: 'web-address' } });
    page();
    expect(await screen.findByText('You can close this page')).toBeInTheDocument();
    expect(screen.getByText(/You will receive an email when your site is ready, with a link to finish setting it up/)).toBeInTheDocument();
    expect(screen.getByText('Now: Setting up your web address. Next: Setting up email and tickets.')).toBeInTheDocument();
  });

  it('says the build is starting before its first step, and names no next step after the last', async () => {
    serveStatus({ status: 'approved', myRole: 'editor', canEdit: false, canWithdraw: false });
    const { unmount } = page();
    expect(await screen.findByText('Now: Starting the build. Next: Setting up your hosting.')).toBeInTheDocument();
    expect(screen.getByText(/The Owners will receive an email when your site is ready/)).toBeInTheDocument();
    unmount();
    serveStatus({ status: 'building', canEdit: false, canWithdraw: false, build: { failed: false, needsReconnect: false, current: 'ready' } });
    page();
    expect(await screen.findByText('Now: Emailing the link to your site.')).toBeInTheDocument();
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
    expect(stages[2]).toHaveTextContent('Your site is readyNow');
    expect(screen.getByRole('link', { name: 'Open your admin panel' })).toHaveAttribute('href', 'https://nclocal.eventrunner.org/admin');
    expect(screen.queryByText('You can close this page')).not.toBeInTheDocument();
  });

  it('names the progress panel and keeps the agreement separate from the main action', async () => {
    serveStatus({ status: 'ready', canEdit: false, canWithdraw: false, acceptance: { name: 'Ana Owner', at: '2026-11-04T15:00:00.000Z' } });
    page();
    const progress = await screen.findByRole('complementary', { name: 'Setup progress' });
    expect(within(progress).getAllByRole('listitem')[2]).toHaveAttribute('aria-current', 'step');
    const agreement = screen.getByRole('region', { name: 'Agreement' });
    expect(within(agreement).getByRole('link', { name: 'Read the agreement' })).toHaveAttribute('href', '/organizations/o1/applications/a1/accepted-agreement');
    expect(within(progress).queryByRole('link', { name: 'Open your admin panel' })).not.toBeInTheDocument();
  });

  it('announces actual build activity with the next step', async () => {
    serveStatus({ status: 'building', canEdit: false, build: { failed: false, current: 'web-address' } });
    page();
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByRole('status')).toHaveTextContent('Now: Setting up your web address. Next: Setting up email and tickets.');
  });

  it.each(['ready', 'launched', 'withdrawn', 'declined'])('shows no build activity for a %s request', async (status) => {
    serveStatus({ status, canEdit: false, canWithdraw: false });
    page();
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    if (['withdrawn', 'declined'].includes(status)) {
      expect(screen.queryByRole('complementary', { name: 'Setup progress' })).not.toBeInTheDocument();
    }
  });

  it('does not show activity when the build did not finish', async () => {
    serveStatus({ status: 'building', canEdit: false, canWithdraw: false, build: { failed: true, needsReconnect: false } });
    page();
    expect(await screen.findByText('The build did not finish')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('offers to continue a draft', async () => {
    serveStatus({ status: 'draft' });
    page();
    expect(await screen.findByRole('link', { name: 'Continue the setup' })).toHaveAttribute('href', '/organizations/o1/applications/a1/organization');
  });

  it('withdraws after one question, and Cancel keeps the request', async () => {
    let status = 'draft';
    serveApi({
      getApplication: () => ({ application: application({ status, canEdit: status === 'draft', canWithdraw: status !== 'withdrawn' }) }),
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

  it('links to the accepted agreement, to read again', async () => {
    serveStatus({ status: 'approved', canEdit: false, canWithdraw: false, acceptance: { version: 1, name: 'Ana Owner', at: '2026-11-04T15:00:00.000Z' } });
    page();
    expect(await screen.findByRole('link', { name: 'Read the agreement' })).toHaveAttribute('href', '/organizations/o1/applications/a1/accepted-agreement');
  });

  it('shows a declined request with its note', async () => {
    serveStatus({ status: 'declined', note: 'This is not an event.', canEdit: false, canWithdraw: false });
    page();
    expect(await screen.findByRole('note')).toHaveTextContent('This is not an event.');
    expect(screen.getByText('This request is closed.')).toBeInTheDocument();
  });

  describe('the connected account', () => {
    const notConnected = { available: true, connected: false, displayName: null, connectedAt: null };

    it('connects and disconnects until the agreement is accepted', async () => {
      let linked = connections();
      serveApi({
        getApplication: () => ({ application: application({ connections: linked }) }),
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

    it('an Owner can disconnect Stripe from a built site, and hears what that does', async () => {
      const built = connections({ canChange: false, canDisconnect: false, built: true, stripe: { available: true, connected: true, canEnd: true, displayName: 'NC Local', connectedAt: '2026-11-02T00:00:00.000Z' } });
      serveStatus({ status: 'ready', canEdit: false, canWithdraw: false, connections: built });
      page();
      fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
      expect(screen.getByRole('group', { name: 'Disconnect your Stripe account' })).toHaveTextContent('Your site stays online, but it stops selling paid tickets.');
    });

    it('a built site names who removes an Eventbrite account', async () => {
      const built = connections({ canChange: false, canDisconnect: false, built: true, stripe: { available: true, connected: false, canEnd: true }, eventbrite: { available: true, connected: true, displayName: 'NC Local', connectedAt: '2026-11-02T00:00:00.000Z', event: null } });
      serveStatus({ status: 'ready', canEdit: false, canWithdraw: false, connections: built });
      page();
      expect(await screen.findByText(/To disconnect this account, ask/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument();
    });

    it('a closed request with an unfinished change still offers Disconnect', async () => {
      const unfinished = { available: true, connected: false, unfinished: true, displayName: null, connectedAt: null };
      serveStatus({ status: 'withdrawn', canEdit: false, canWithdraw: false, connections: connections({ canChange: false, stripe: unfinished }) });
      page();
      expect(await screen.findByText(/An earlier change to this account did not finish/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
    });

    it('an Editor sees the account and cannot change it', async () => {
      serveStatus({ status: 'approved', canEdit: false, myRole: 'editor', connections: connections({ canChange: false, canDisconnect: false }) });
      page();
      expect(await screen.findByText('Connected: NC Local')).toBeInTheDocument();
      expect(screen.getByText('Only an Owner can change this account.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Connect again' })).not.toBeInTheDocument();
    });

    it('from acceptance on, the account cannot change while the build is well', async () => {
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
      serveStatus({ status: 'approved', canEdit: false, answers, connections: connections({ canChange: false, canDisconnect: false, stripe: notConnected }) });
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

  it('says when the copy of the agreement could not be emailed', async () => {
    render(
      <AuthContext.Provider value={fakeAuth()}>
        <MemoryRouter initialEntries={[{ pathname: '/organizations/o1/applications/a1', state: { copyFailed: true } }]}>
          <Routes><Route path="/organizations/:orgId/applications/:appId" element={<ApplicationStatus />} /></Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );
    expect(await screen.findByText(/could not email your copy of the agreement/)).toBeInTheDocument();
  });

  describe('a failed build', () => {
    const notConnected = { available: true, connected: false, displayName: null, connectedAt: null };
    const FAILED = { status: 'building', canEdit: false, canWithdraw: false, connections: connections({ canChange: false, canDisconnect: false }) };

    it('says the build did not finish and retries it, with no error text', async () => {
      let failed = true;
      serveApi({
        getApplication: () => ({ application: application({ ...FAILED, build: failed ? { failed: true, needsReconnect: false } : { failed: false, needsReconnect: false } }) }),
        retryBuild: () => { failed = false; return { started: true }; },
      });
      page();
      expect(await screen.findByRole('note')).toHaveTextContent('The build did not finish');
      expect(screen.queryByRole('button', { name: 'Reconnect' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Retry the build' }));
      expect(await screen.findByText(/We started the build again/)).toBeInTheDocument();
      expect(callsTo('retryBuild')).toEqual([{ orgId: 'o1', appId: 'a1' }]);
      expect(screen.queryByText('The build did not finish')).not.toBeInTheDocument();
      expect(screen.getByText('You can close this page')).toBeInTheDocument();
    });

    it('shows a refused retry', async () => {
      serveApi({
        getApplication: { application: application({ ...FAILED, build: { failed: true, needsReconnect: false } }) },
        retryBuild: () => { throw new Error('You have retried this build too many times today.'); },
      });
      page();
      fireEvent.click(await screen.findByRole('button', { name: 'Retry the build' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('too many times today');
    });

    it('a ticket account failure asks an Owner to reconnect first, and only that account', async () => {
      serveStatus({
        ...FAILED,
        build: { failed: true, needsReconnect: true },
        connections: connections({ canChange: false, canDisconnect: false, stripe: notConnected }),
      });
      page();
      expect(await screen.findByRole('note')).toHaveTextContent('could not use your Stripe account');
      expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Retry the build' })).not.toBeInTheDocument();
    });

    it('shows the Eventbrite consent to an Owner who can reconnect, and not to an Editor', async () => {
      const eventbrite = {
        ...FAILED,
        answers: { ...fullAnswers(), tickets: { choice: 'eventbrite' } },
        build: { failed: true, needsReconnect: true },
        connections: connections({ canChange: false, canDisconnect: false, stripe: notConnected, eventbrite: notConnected }),
      };
      const consent = /By connecting, you authorize Event Runner to read your Eventbrite/;
      serveStatus(eventbrite);
      const { unmount } = page();
      expect(await screen.findByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
      expect(screen.getByText(consent)).toBeInTheDocument();
      unmount();
      serveStatus({ ...eventbrite, myRole: 'editor' });
      page();
      await screen.findByText(/Only an Owner can reconnect an account or retry the build/);
      expect(screen.queryByText(consent)).not.toBeInTheDocument();
    });

    it('an account that is gone needs reconnecting whichever step failed', async () => {
      serveStatus({
        ...FAILED,
        build: { failed: true, needsReconnect: false },
        connections: connections({ canChange: true, canDisconnect: false, stripe: notConnected }),
      });
      page();
      expect(await screen.findByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Retry the build' })).not.toBeInTheDocument();
    });

    it('once the account is connected again, an Owner can retry', async () => {
      serveStatus({ ...FAILED, build: { failed: true, needsReconnect: true } });
      page();
      expect(await screen.findByRole('button', { name: 'Retry the build' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
    });

    it('an Editor can do neither, and is told who can', async () => {
      serveStatus({ ...FAILED, myRole: 'editor', build: { failed: true, needsReconnect: true } });
      page();
      expect(await screen.findByText(/Only an Owner can reconnect an account or retry the build/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Retry the build' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Reconnect' })).not.toBeInTheDocument();
    });

    it('an operator can retry and cannot reconnect', async () => {
      serveStatus({ ...FAILED, myRole: null, operator: true, build: { failed: true, needsReconnect: true } });
      page();
      expect(await screen.findByRole('button', { name: 'Retry the build' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Reconnect' })).not.toBeInTheDocument();
    });
  });

  it('never names the systems behind the console', async () => {
    serveStatus({
      status: 'building',
      canEdit: false,
      canWithdraw: false,
      answers: { ...application().answers, tickets: { choice: 'spreadsheet' } },
      connections: connections({ stripe: { available: true, connected: false, displayName: null, connectedAt: null } }),
      build: { failed: true, needsReconnect: false },
    });
    const { container } = page();
    await screen.findByRole('note');
    expect(container.textContent).not.toMatch(/firebase|project|tenant|environment|webhook|secret|stripe|checkout/i);
  });
});
