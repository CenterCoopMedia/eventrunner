import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { application, callsTo, serveApi } from '../test/application.js';
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

  it('shows a load error', async () => {
    serveApi({ getApplication: () => { throw new Error('We could not find that request.'); } });
    page();
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not find that request.');
  });

  describe('the event fee', () => {
    const WAITING = {
      status: 'awaiting_payment',
      canEdit: false,
      canAccept: false,
      canPay: true,
      submittedAt: '2026-11-04T15:00:00.000Z',
      acceptance: { version: 1, name: 'Ana Owner', at: '2026-11-04T15:00:00.000Z' },
    };
    const pageAt = (query) => renderPage(<ApplicationStatus />, {
      path: `/organizations/o1/applications/a1${query}`,
      route: '/organizations/:orgId/applications/:appId',
    });

    it('shows the steps of a paid request and a link to pay', async () => {
      serveStatus(WAITING);
      page();
      const stages = await screen.findAllByRole('listitem');
      expect(stages.map((s) => s.textContent)).toEqual([
        'Answer the setup questionsDone',
        'Accept the agreement and pay the event feeNow',
        'We are building your siteNot started',
        'Your site is readyNot started',
      ]);
      expect(screen.getByRole('link', { name: 'Pay the event fee' })).toHaveAttribute('href', '/organizations/o1/applications/a1/fee');
      expect(screen.getByText(/Ana Owner accepted the agreement on 4 November 2026/)).toBeInTheDocument();
    });

    it('coming back from paying changes nothing: it waits for confirmation', async () => {
      serveStatus(WAITING);
      pageAt('?payment=done');
      expect(await screen.findByText('Waiting for payment confirmation')).toBeInTheDocument();
      expect(screen.getByRole('note')).toHaveTextContent('You will not be charged twice.');
      expect(screen.queryByRole('link', { name: 'Pay the event fee' })).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'open the event fee step' })).toHaveAttribute('href', '/organizations/o1/applications/a1/fee');
      expect(callsTo('startFeeCheckout')).toHaveLength(0);
    });

    it('checks again soon while it waits, and shows the confirmed payment', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        let confirmed = false;
        serveApi({
          getApplication: () => ({
            application: application(confirmed
              ? { status: 'approved', canEdit: false, canPay: false, canWithdraw: false, payment: { amount: 12345, currency: 'usd', paidAt: '2026-11-04T15:00:00.000Z' } }
              : WAITING),
          }),
        });
        pageAt('?payment=done');
        await screen.findByText('Waiting for payment confirmation');
        confirmed = true;
        await vi.advanceTimersByTimeAsync(5000);
        expect(await screen.findByText(/We received your event fee of \$123\.45 on 4 November 2026/)).toBeInTheDocument();
        expect(screen.queryByText('Waiting for payment confirmation')).not.toBeInTheDocument();
        expect(screen.getAllByRole('listitem')[2]).toHaveTextContent('We are building your siteNow');
      } finally {
        vi.useRealTimers();
      }
    });

    it('a request that was returned from paying and is still unpaid keeps its status for a teammate', async () => {
      serveStatus({ ...WAITING, myRole: 'editor', canPay: false, canWithdraw: false });
      page();
      expect(await screen.findByText(/Only an Owner can pay the event fee/)).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Pay the event fee' })).not.toBeInTheDocument();
    });

    it('a cancelled payment says no money was taken and offers to pay', async () => {
      serveStatus(WAITING);
      pageAt('?payment=cancelled');
      expect(await screen.findByRole('note')).toHaveTextContent('We took no money.');
      expect(screen.getByRole('link', { name: 'Pay the event fee' })).toBeInTheDocument();
    });

    it('the words about paying go away once the request moves on', async () => {
      serveStatus({ status: 'withdrawn', canEdit: false, canPay: false, canWithdraw: false });
      pageAt('?payment=done');
      expect(await screen.findByText(/This request is withdrawn/)).toBeInTheDocument();
      expect(screen.queryByText('Waiting for payment confirmation')).not.toBeInTheDocument();
    });

    it('never names the systems behind the console', async () => {
      serveStatus(WAITING);
      const { container } = pageAt('?payment=done');
      await screen.findByText('Waiting for payment confirmation');
      expect(container.textContent).not.toMatch(/firebase|project|tenant|environment|webhook|secret|stripe|checkout/i);
    });
  });
});
