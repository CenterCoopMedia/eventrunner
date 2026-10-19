// Airtable refresh on the Session pitches page: the status staff read, the
// refresh action, the operator settings form, and the queue markers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

let collections = {};
let listeners = {};
let operator = false;
const call = vi.fn();
vi.mock('../../lib/pitchSource.js', () => ({
  subscribePitchCall: (onNext) => { onNext({ enabled: false, closesAt: '2027-01-31T23:59:59Z', externalFormUrl: null }); return () => {}; },
}));
vi.mock('../adminSource.js', () => ({
  subscribeAdminCollection: (name, onNext) => { listeners[name] = onNext; onNext(collections[name] || []); return () => {}; },
}));
vi.mock('../../contexts/AuthContext.jsx', () => ({ useAuth: () => ({ isOperator: operator }) }));
vi.mock('../../contexts/EventConfigContext.jsx', () => ({ useEventConfig: () => ({ eventConfig: { days: [], timezone: 'UTC' } }) }));
vi.mock('../adminApi.js', () => ({ useAdminApi: () => call }));

import AdminSessionPitches from './AdminSessionPitches.jsx';

const at = (iso) => new Date(iso);
const lastRun = {
  trigger: 'manual', by: 'staff@example.test', outcome: 'completed',
  startedAt: at('2026-10-20T14:00:00Z'), finishedAt: at('2026-10-20T14:00:05Z'),
  counts: { fetched: 6, created: 3, updated: 1, unchanged: 1, restored: 0, skipped: 1, removed: 0 },
  skippedReasons: { 'no-consent': 1 },
  skippedRecords: [{ recordId: 'rec00000000000004', reason: 'no-consent', field: 'consent' }],
  error: null,
};

function open() {
  render(<MemoryRouter><AdminSessionPitches /></MemoryRouter>);
  fireEvent.click(screen.getByText('Refresh pitches from Airtable'));
}

beforeEach(() => {
  collections = {};
  listeners = {};
  operator = false;
  call.mockReset();
});
afterEach(cleanup);

describe('Airtable refresh status and action', () => {
  it('shows staff the last run, its counts and why records were skipped, without the settings', () => {
    collections.session_pitch_sync = [{ id: 'airtable', running: null, lastRun }];
    open();
    const status = screen.getByLabelText('Airtable refresh status');
    expect(within(status).getByText('Completed')).toBeInTheDocument();
    expect(within(status).getByText(/Last refresh Oct 20, 2026, 2:00 PM UTC, by staff@example.test/)).toBeInTheDocument();
    const created = within(status).getByText('Created').closest('div');
    expect(within(created).getByText('3')).toBeInTheDocument();
    fireEvent.click(within(status).getByText('Why records were skipped'));
    expect(within(status).getByText('Consent box not ticked: 1')).toBeInTheDocument();
    expect(within(status).getByText(/rec00000000000004 · Consent box not ticked · consent/)).toBeInTheDocument();
    expect(screen.queryByText('Connection settings')).toBeNull();
  });

  it('states a failed run and a partial run in words', () => {
    collections.session_pitch_sync = [{ id: 'airtable', lastRun: { ...lastRun, outcome: 'failed', error: { code: 'token-rejected', message: 'Airtable refused the access token.' } } }];
    open();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Last error: Airtable refused the access token.')).toBeInTheDocument();
    cleanup();
    collections.session_pitch_sync = [{ id: 'airtable', lastRun: { ...lastRun, outcome: 'partial' } }];
    open();
    expect(screen.getByText('Completed in part')).toBeInTheDocument();
    expect(screen.getByText(/more records than one refresh reads/)).toBeInTheDocument();
  });

  it('says when no refresh has run', () => {
    open();
    expect(screen.getByText('No refresh has run yet.')).toBeInTheDocument();
  });

  it('refreshes once per press, reports the counts, and ignores a second press while busy', async () => {
    let resolve;
    call.mockImplementation(() => new Promise((r) => { resolve = r; }));
    open();
    const button = screen.getByRole('button', { name: 'Refresh from Airtable' });
    fireEvent.click(button);
    expect(screen.getByRole('button', { name: 'Refreshing…' })).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Refreshing…' }));
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith('refreshAirtablePitches', {});
    resolve({ outcome: 'completed', counts: { created: 2, updated: 1, unchanged: 4, restored: 0, skipped: 1, removed: 1 } });
    expect(await screen.findByText(/Refresh complete: created 2, updated 1, unchanged 4, back in airtable 0, skipped 1, flagged as removed 1\. No decision was changed and no email was sent\./)).toBeInTheDocument();
  });

  it('moves focus to the refusal when a refresh fails', async () => {
    call.mockRejectedValue(Object.assign(new Error('Airtable cannot find this base, table or view.'), { code: 'not-found' }));
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh from Airtable' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The refresh did not finish');
    expect(alert).toHaveTextContent('Airtable cannot find this base, table or view.');
    await waitFor(() => expect(alert).toHaveFocus());
  });
});

describe('Airtable connection settings', () => {
  it('lets an operator save a connection with the default field names', async () => {
    operator = true;
    call.mockResolvedValue({});
    collections.session_pitch_sources = [];
    open();
    fireEvent.click(screen.getByText('Connection settings'));
    expect(screen.getByLabelText('Email field')).toHaveValue('email');
    expect(screen.getByLabelText('Consent checkbox field')).toHaveValue('consent');
    fireEvent.change(screen.getByLabelText('Base ID'), { target: { value: ' appAAAAAAAAAAAAAA ' } });
    fireEvent.change(screen.getByLabelText('Table ID or name'), { target: { value: 'tblBBBBBBBBBBBBBB' } });
    fireEvent.change(screen.getByLabelText('Automatic refresh'), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Airtable settings' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('updateAirtablePitchSource', {
      enabled: true, baseId: 'appAAAAAAAAAAAAAA', table: 'tblBBBBBBBBBBBBBB', view: null, scheduleMinutes: 60,
      fieldMap: { email: 'email', title: 'title', description: 'description', consent: 'consent', organization: 'organization', format: 'format', externalId: null },
    }));
    expect(await screen.findByText('Airtable settings saved. Refresh to check the connection.')).toBeInTheDocument();
    // The saved document arrives through the live listener. The form stays
    // open with its result, as the browser run showed it must.
    act(() => listeners.session_pitch_sources([{ id: 'airtable', enabled: true, baseId: 'appAAAAAAAAAAAAAA', table: 'tblBBBBBBBBBBBBBB', scheduleMinutes: 60, fieldMap: {}, updatedAt: { toMillis: () => 1 } }]));
    expect(screen.getByText('Airtable settings saved. Refresh to check the connection.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Airtable settings' })).toBeVisible();
  });

  it('opens on the saved settings and refuses a malformed base ID in place', () => {
    operator = true;
    collections.session_pitch_sources = [{ id: 'airtable', enabled: false, baseId: 'appAAAAAAAAAAAAAA', table: 'Pitches', view: 'Approved', scheduleMinutes: 15, fieldMap: { email: 'Email', title: 'Title', description: 'Summary', consent: 'OK', organization: null, format: null, externalId: 'Ref' } }];
    open();
    fireEvent.click(screen.getByText('Connection settings'));
    expect(screen.getByLabelText('Use this Airtable connection')).not.toBeChecked();
    expect(screen.getByLabelText('Description field')).toHaveValue('Summary');
    expect(screen.getByLabelText('External ID field (optional)')).toHaveValue('Ref');
    expect(screen.getByLabelText('Automatic refresh')).toHaveValue('15');
    fireEvent.change(screen.getByLabelText('Base ID'), { target: { value: 'https://airtable' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Save Airtable settings' }).closest('form'));
    expect(call).not.toHaveBeenCalled();
    const field = screen.getByLabelText('Base ID');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveFocus();
    expect(screen.getByText('Enter the base ID: app followed by 14 letters or numbers.')).toBeInTheDocument();
  });
});

describe('Airtable markers in the review queue', () => {
  const base = { email: 'presenter@example.test', organization: 'Example newsroom', description: 'A practical session.', source: 'airtable', status: 'accepted', reviewRevision: 2, createdAt: at('2026-10-01T10:00:00Z') };

  it('marks a changed, a removed and an unconsented record in words, in the list and in the review', () => {
    collections.session_pitches = [
      { ...base, id: 'changed', title: 'Changed pitch', reviewedAt: at('2026-10-10T10:00:00Z'), sourceUpdatedAt: at('2026-10-12T10:00:00Z'), sourceChangedFields: ['title', 'description'] },
      { ...base, id: 'reviewed-after', title: 'Reviewed after change', reviewedAt: at('2026-10-13T10:00:00Z'), sourceUpdatedAt: at('2026-10-12T10:00:00Z') },
      { ...base, id: 'removed', title: 'Removed pitch', sourceRemovedAt: at('2026-10-12T10:00:00Z') },
      { ...base, id: 'consent', title: 'Unconsented pitch', sourceConsentMissingAt: at('2026-10-12T10:00:00Z') },
    ];
    render(<MemoryRouter><AdminSessionPitches /></MemoryRouter>);
    const item = (title) => screen.getByRole('button', { name: title }).closest('li');
    expect(within(item('Changed pitch')).getByText('Updated in Airtable')).toBeInTheDocument();
    expect(within(item('Reviewed after change')).queryByText('Updated in Airtable')).toBeNull();
    expect(within(item('Removed pitch')).getByText('Removed from Airtable')).toBeInTheDocument();
    expect(within(item('Unconsented pitch')).getByText('Consent unchecked in Airtable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Changed pitch' }));
    const changes = screen.getByRole('list', { name: 'Airtable changes' });
    expect(changes).toHaveTextContent('The submitter changed title, description on Oct 12, 2026, 10:00 AM UTC.');
  });
});
