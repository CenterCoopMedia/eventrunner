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

const DEFAULTS = {
  gcpFolder: 'folders/123456789012', billingAccount: '012345-6789AB-CDEF01', region: 'us-central1', projectId: 'er-nclocal', environment: 'nclocal',
};

function request(overrides = {}) {
  return {
    application: {
      id: 'a1',
      orgId: 'o1',
      status: 'submitted',
      answers: ANSWERS,
      ticketChoice: 'stripe',
      webAddressName: 'nclocal',
      history: [
        { status: 'draft', at: '2026-11-01T15:00:00.000Z', by: 'ana', byEmail: 'ana@example.org', note: null },
        { status: 'submitted', at: '2026-11-03T15:00:00.000Z', by: 'ana', byEmail: 'ana@example.org', note: null },
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
    approvalDefaults: DEFAULTS,
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

beforeEach(() => serve());

describe('ReviewApplication', () => {
  it('shows the frozen answers in plain words', async () => {
    page();
    expect(await screen.findByRole('heading', { level: 1, name: 'NC Local Summit' })).toBeInTheDocument();
    expect(callApi).toHaveBeenCalledWith('getApplicationForReview', { appId: 'a1' });
    expect(screen.getByText('Waiting for review', { selector: '.tag' })).toBeInTheDocument();
    expect(screen.getByText('A day for local news')).toBeInTheDocument();
    expect(screen.getByText('2027-03-04, 09:00 to 17:00 (Day one)')).toBeInTheDocument();
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
    expect(history[1]).toHaveTextContent('Waiting for review');
    expect(history[1]).toHaveTextContent('by ana@example.org');
  });

  it('asks for a note before it requests changes, and focuses the note field', async () => {
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Request changes' }));
    const field = screen.getByLabelText('Note to the client');
    expect(field).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Send the request for changes' }));
    expect(await screen.findByText('Write a note to the client.')).toBeInTheDocument();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveFocus();
    expect(callApi).not.toHaveBeenCalledWith('requestChanges', expect.anything());
  });

  it('refuses a note over 2,000 characters', async () => {
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Request changes' }));
    fireEvent.change(screen.getByLabelText('Note to the client'), { target: { value: 'x'.repeat(2001) } });
    fireEvent.click(screen.getByRole('button', { name: 'Send the request for changes' }));
    expect(await screen.findByText('Shorten the note to 2,000 characters or fewer.')).toBeInTheDocument();
  });

  it('requests changes with the note, then shows the new status', async () => {
    let status = 'submitted';
    serve(() => request({ status }), { requestChanges: () => { status = 'changes_requested'; return { emailed: 2, mailFailed: false }; } });
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Request changes' }));
    fireEvent.change(screen.getByLabelText('Note to the client'), { target: { value: 'Add the venue address.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send the request for changes' }));
    expect(await screen.findByText('You asked for changes. We emailed the Owners.')).toBeInTheDocument();
    expect(callApi).toHaveBeenCalledWith('requestChanges', { appId: 'a1', note: 'Add the venue address.' });
    expect(await screen.findByText('Changes requested', { selector: '.tag' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeInTheDocument();
  });

  it('Cancel closes a decision and returns the focus to its button', async () => {
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Note to the client')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decline' })).toHaveFocus();
  });

  it('declines with a note', async () => {
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    fireEvent.change(screen.getByLabelText('Note to the client'), { target: { value: 'Not an event.' } });
    fireEvent.click(within(screen.getByRole('form', { name: 'Decline this request' })).getByRole('button', { name: 'Decline' }));
    expect(await screen.findByText(/You declined the request/)).toBeInTheDocument();
    expect(callApi).toHaveBeenCalledWith('declineApplication', { appId: 'a1', note: 'Not an event.' });
  });

  it('approves with the default settings, which the operator can change', async () => {
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(screen.getByLabelText('Google Cloud folder')).toHaveFocus();
    expect(screen.getByLabelText('Project id')).toHaveValue('er-nclocal');
    expect(screen.getByLabelText('Environment name')).toHaveValue('nclocal');
    fireEvent.change(screen.getByLabelText('Region'), { target: { value: 'us-east1' } });
    fireEvent.click(within(screen.getByRole('form', { name: 'Approve this request' })).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText(/You approved the request/)).toBeInTheDocument();
    expect(callApi).toHaveBeenCalledWith('approveApplication', { appId: 'a1', settings: { ...DEFAULTS, region: 'us-east1' } });
  });

  it('checks the approval settings and focuses a bad one', async () => {
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    fireEvent.change(screen.getByLabelText('Project id'), { target: { value: 'er-' } });
    fireEvent.click(within(screen.getByRole('form', { name: 'Approve this request' })).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText(/Enter a project id of 6 to 30 characters/)).toBeInTheDocument();
    expect(screen.getByLabelText('Project id')).toHaveFocus();
    expect(callApi).not.toHaveBeenCalledWith('approveApplication', expect.anything());
  });

  it('says when the Owners could not be emailed', async () => {
    serve(request(), { approveApplication: () => ({ emailed: 0, mailFailed: true }) });
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    fireEvent.click(within(screen.getByRole('form', { name: 'Approve this request' })).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText(/We could not email the Owners/)).toBeInTheDocument();
  });

  it('shows a refusal when another operator acted first', async () => {
    serve(request(), {
      approveApplication: () => { throw Object.assign(new Error('Another member of the hosting team changed this request.'), { code: 'status-changed' }); },
    });
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    fireEvent.click(within(screen.getByRole('form', { name: 'Approve this request' })).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Another member of the hosting team changed this request.');
  });

  it('asks before it deletes a request as spam, then goes back to the queue', async () => {
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

  it('offers no decision on an approved request', async () => {
    serve(request({ status: 'approved' }));
    page();
    expect(await screen.findByText('No decision is open for a request with this status.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete as spam' })).not.toBeInTheDocument();
  });

  it('says when the client has not sent the request yet', async () => {
    serve(request({ status: 'draft', answers: null, ticketChoice: null }));
    page();
    expect(await screen.findByText(/has not sent this request yet/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Request' })).toBeInTheDocument();
  });

  it('tells a client the page is for the hosting team', async () => {
    callApi.mockRejectedValue(Object.assign(new Error('x'), { code: 'not-operator' }));
    page();
    expect(await screen.findByRole('heading', { level: 1, name: 'This page is for the hosting team' })).toBeInTheDocument();
  });
});
