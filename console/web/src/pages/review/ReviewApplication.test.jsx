import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callApi } from '../../api.js';
import { renderPage } from '../../test/renderPage.jsx';
import ReviewApplication from './ReviewApplication.jsx';

vi.mock('../../api.js', () => ({ callApi: vi.fn() }));

const ANSWERS = {
  organization: { name: 'NC Local', website: 'https://nclocal.example', address: '1 Main St, Newark, NJ' },
  event: {
    name: 'NC Local Summit',
    shortName: 'NCL Summit',
    tagline: 'A day for local news',
    timezone: 'America/New_York',
    days: [{ date: '2027-03-04', startTime: '09:00', endTime: '17:00', label: 'Day one' }],
    venue: { name: 'Hall A', address: '2 Main St, Newark, NJ' },
  },
  webAddress: { name: 'nclocal' },
  tickets: { choice: 'stripe' },
  email: { senderName: 'NC Local', replyTo: 'hello@nclocal.example' },
};

function request(overrides = {}) {
  return {
    application: {
      id: 'a1',
      orgId: 'o1',
      status: 'approved',
      answers: ANSWERS,
      ticketChoice: 'stripe',
      webAddressName: 'nclocal',
      revision: 2,
      history: [
        { status: 'draft', at: '2026-11-01T15:00:00.000Z', by: 'ana', byEmail: 'ana@example.org', note: null },
        { status: 'approved', at: '2026-11-03T15:00:00.000Z', by: 'ana', byEmail: 'ana@example.org', note: null },
      ],
      review: null,
      ...overrides,
    },
    organization: { id: 'o1', name: 'NC Local' },
    team: {
      members: [
        { uid: 'ana', email: 'ana@example.org', role: 'owner' },
        { uid: 'ben', email: 'ben@example.org', role: 'editor' },
      ],
      invites: [{ id: 'i1', email: 'dee@example.org', role: 'owner', expiresAt: '2026-11-10T00:00:00.000Z' }],
    },
    connection: { state: 'not_connected', label: 'Not connected yet' },
  };
}

function serve(data = request(), handlers = {}) {
  callApi.mockImplementation(async (name, body) => {
    if (name === 'getApplicationForReview') return typeof data === 'function' ? data() : data;
    if (handlers[name]) return handlers[name](body);
    return { emailed: 2, mailFailed: false };
  });
}

const page = () => renderPage(<ReviewApplication />, {
  path: '/review/a1', route: '/review/:appId', routes: { '/review': 'The queue' },
});

const DRAFT = () => request({ status: 'draft', answers: null, ticketChoice: null });

beforeEach(() => serve());

describe('ReviewApplication', () => {
  it('shows the frozen answers in plain words', async () => {
    page();
    expect(await screen.findByRole('heading', { level: 1, name: 'NC Local Summit' })).toBeInTheDocument();
    expect(callApi).toHaveBeenCalledWith('getApplicationForReview', { appId: 'a1' });
    expect(screen.getByText('Approved', { selector: '.tag' })).toBeInTheDocument();
    expect(screen.getByText('A day for local news')).toBeInTheDocument();
    expect(screen.getByText('Thursday, 4 March 2027, 9:00 a.m. to 5:00 p.m. (Day one)')).toBeInTheDocument();
    expect(screen.getAllByText('nclocal.eventrunner.org').length).toBeGreaterThan(0);
    expect(screen.getByText('NC Local <hello@nclocal.eventrunner.org>')).toBeInTheDocument();
    expect(screen.getAllByText('Sell with Stripe').length).toBeGreaterThan(0);
    expect(screen.getByText('Not connected yet')).toBeInTheDocument();
  });

  it('shows the team, the open invites and the history, oldest first', async () => {
    page();
    const team = within(await screen.findByRole('list', { name: 'Team' })).getAllByRole('listitem');
    expect(team[0]).toHaveTextContent('ana@example.org');
    expect(team[0]).toHaveTextContent('Owner');
    expect(within(screen.getByRole('list', { name: 'Invites waiting for an answer' })).getByRole('listitem')).toHaveTextContent('dee@example.org');
    const history = within(screen.getByRole('list', { name: 'History' })).getAllByRole('listitem');
    expect(history[0]).toHaveTextContent('Draft');
    expect(history[1]).toHaveTextContent('Approved');
    expect(history[1]).toHaveTextContent('by ana@example.org');
  });

  it('asks for a note before it declines, and focuses the note field', async () => {
    serve(DRAFT());
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    const field = screen.getByLabelText('Note to the client');
    expect(field).toHaveFocus();
    fireEvent.click(within(screen.getByRole('form', { name: 'Decline this request' })).getByRole('button', { name: 'Decline' }));
    expect(await screen.findByText('Write a note to the client.')).toBeInTheDocument();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveFocus();
    expect(callApi).not.toHaveBeenCalledWith('declineApplication', expect.anything());
  });

  it('refuses a note over 2,000 characters', async () => {
    serve(DRAFT());
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    fireEvent.change(screen.getByLabelText('Note to the client'), { target: { value: 'x'.repeat(2001) } });
    fireEvent.click(within(screen.getByRole('form', { name: 'Decline this request' })).getByRole('button', { name: 'Decline' }));
    expect(await screen.findByText('Shorten the note to 2,000 characters or fewer.')).toBeInTheDocument();
  });

  it('Cancel closes a decision and returns the focus to its button', async () => {
    serve(DRAFT());
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Note to the client')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decline' })).toHaveFocus();
  });

  it('declines a draft with a note', async () => {
    serve(DRAFT());
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    fireEvent.change(screen.getByLabelText('Note to the client'), { target: { value: 'Not an event.' } });
    fireEvent.click(within(screen.getByRole('form', { name: 'Decline this request' })).getByRole('button', { name: 'Decline' }));
    expect(await screen.findByText(/You declined the request/)).toBeInTheDocument();
    expect(callApi).toHaveBeenCalledWith('declineApplication', { appId: 'a1', revision: 2, note: 'Not an event.' });
  });

  it('says when the Owners could not be emailed', async () => {
    serve(DRAFT(), { declineApplication: () => ({ emailed: 0, mailFailed: true }) });
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    fireEvent.change(screen.getByLabelText('Note to the client'), { target: { value: 'Not an event.' } });
    fireEvent.click(within(screen.getByRole('form', { name: 'Decline this request' })).getByRole('button', { name: 'Decline' }));
    expect(await screen.findByText(/We could not email every Owner/)).toBeInTheDocument();
  });

  it('shows a refusal when another operator acted first', async () => {
    serve(DRAFT(), {
      declineApplication: () => { throw Object.assign(new Error('This request changed since you opened it.'), { code: 'status-changed' }); },
    });
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    fireEvent.change(screen.getByLabelText('Note to the client'), { target: { value: 'Not an event.' } });
    fireEvent.click(within(screen.getByRole('form', { name: 'Decline this request' })).getByRole('button', { name: 'Decline' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This request changed since you opened it.');
  });

  it('asks before it deletes a request as spam, then goes back to the queue', async () => {
    serve(DRAFT());
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete as spam' }));
    expect(screen.getByText(/You cannot undo this/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(callApi).not.toHaveBeenCalledWith('deleteSpamApplication', expect.anything());
    expect(screen.getByRole('button', { name: 'Delete as spam' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Delete as spam' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));
    expect(await screen.findByText('The queue')).toBeInTheDocument();
    expect(callApi).toHaveBeenCalledWith('deleteSpamApplication', { appId: 'a1', confirm: true });
  });

  it('offers no decision on an approved request with a run going', async () => {
    page();
    expect(await screen.findByText(/cancel its run first/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete as spam' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Decline' })).not.toBeInTheDocument();
  });

  it('says when the client has not accepted the agreement yet', async () => {
    serve(DRAFT());
    page();
    expect(await screen.findByText(/has not accepted the agreement yet/)).toBeInTheDocument();
    expect(screen.queryByText(/answers the client accepted/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Request' })).toBeInTheDocument();
  });

  it('tells a client the page is for the hosting team', async () => {
    callApi.mockRejectedValue(Object.assign(new Error('x'), { code: 'not-operator' }));
    page();
    expect(await screen.findByRole('heading', { level: 1, name: 'This page is for the hosting team' })).toBeInTheDocument();
  });

  describe('the agreement and the build', () => {
    const ACCEPTANCE = { id: 'r1', version: 2, sha256: 'abc123', name: 'Ana Owner', email: 'ana@example.org', at: '2026-11-03T15:00:00.000Z' };

    it('shows the acceptance as recorded', async () => {
      serve(request({ acceptance: ACCEPTANCE }));
      page();
      expect(await screen.findByRole('heading', { level: 2, name: 'Agreement' })).toBeInTheDocument();
      expect(screen.getByText(/Ana Owner \(ana@example.org\)/)).toBeInTheDocument();
      expect(screen.getByText('abc123')).toBeInTheDocument();
    });

    it('says when the build did not start', async () => {
      serve(request({ buildStart: { state: 'failed', at: '2026-11-04T15:00:00.000Z' } }));
      page();
      const note = await screen.findByRole('note');
      expect(note).toHaveTextContent('The build did not start');
      expect(note).toHaveTextContent('The request stays approved');
    });

    it('offers a retry when the build did not start, and shows the result', async () => {
      let calls = 0;
      callApi.mockImplementation(async (name) => {
        if (name === 'retryBuild') {
          calls += 1;
          return { started: true };
        }
        return { ...request({ buildStart: { state: 'failed', at: '2026-11-04T15:00:00.000Z' } }), canRetryBuild: calls === 0, build: null };
      });
      page();
      fireEvent.click(await screen.findByRole('button', { name: 'Retry the build' }));
      expect(callApi).toHaveBeenCalledWith('retryBuild', { appId: 'a1' });
      expect(await screen.findByText('The build started again.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Retry the build' })).not.toBeInTheDocument();
    });

    it('shows the failed run in full and names the step', async () => {
      serve({
        ...request({ status: 'building' }),
        canRetryBuild: true,
        build: {
          state: 'failed',
          runUrl: 'https://github.example/run/1',
          testMode: false,
          error: 'Web address: the certificate is not active',
          steps: [
            { id: 'project', label: 'Project and billing', state: 'done', at: '2026-11-04T15:00:00.000Z', detail: 'already right' },
            { id: 'web-address', label: 'Web address', state: 'failed', at: '2026-11-04T15:05:00.000Z', detail: null },
          ],
        },
      });
      page();
      const note = await screen.findByRole('note');
      expect(note).toHaveTextContent('The build failed');
      expect(note).toHaveTextContent('the certificate is not active');
      expect(note).not.toHaveTextContent('did not start');
      expect(screen.getByText('Project and billing')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Open the run' })).toHaveAttribute('href', 'https://github.example/run/1');
      expect(screen.getByRole('button', { name: 'Retry the build' })).toBeInTheDocument();
    });

    it('has no retry while a build runs', async () => {
      serve({
        ...request({ status: 'building' }),
        canRetryBuild: false,
        build: { state: 'running', runUrl: null, testMode: false, error: null, steps: [] },
      });
      page();
      expect(await screen.findByRole('heading', { level: 2, name: 'Build' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Retry the build' })).not.toBeInTheDocument();
    });
  });

  describe('closing an accepted request', () => {
    it('offers Close once the build stopped, and warns what stays', async () => {
      callApi.mockImplementation(async (name) => {
        if (name === 'getApplicationForReview') return { ...request({ status: 'building' }), canRetryBuild: true };
        return { emailed: 1, mailFailed: false };
      });
      page();
      fireEvent.click(await screen.findByRole('button', { name: 'Close this request' }));
      expect(screen.getByText(/stays until you remove it/)).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Note to the client'), { target: { value: 'Wrong person.' } });
      fireEvent.click(within(screen.getByRole('form', { name: 'Close this request' })).getByRole('button', { name: 'Close the request' }));
      await vi.waitFor(() => expect(callApi).toHaveBeenCalledWith('closeApplication', { appId: 'a1', revision: 2, note: 'Wrong person.' }));
    });

    it('says to cancel the run while one may be alive', async () => {
      callApi.mockImplementation(async () => ({ ...request({ status: 'building' }), canRetryBuild: false }));
      page();
      expect(await screen.findByText(/cancel its run first/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Close this request' })).not.toBeInTheDocument();
    });
  });
});
