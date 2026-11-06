import { MemoryRouter } from 'react-router';
// AdminAttendees — the registration tab (issue #32, spec §3.4). Mocks
// adminApi and adminSource directly, same convention as AdminFeedback.test.jsx.
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

let rowsCallback;
// One callback per collection: `users` drives the rows, `ticket_answers`
// the registration answers (ADR 0008 §4).
const collectionCallbacks = {};
vi.mock('../adminSource.js', () => ({
  subscribeAdminCollection: (name, onNext) => {
    collectionCallbacks[name] = onNext;
    if (name === 'users') rowsCallback = onNext;
    return () => {};
  },
}));
let formCallback;
vi.mock('../../lib/registrationFormSource.js', () => ({
  subscribeRegistrationForm: (onNext) => { formCallback = onNext; return () => {}; },
}));

const callMock = vi.fn();
vi.mock('../adminApi.js', () => ({ useAdminApi: () => callMock }));

const showToastMock = vi.fn();
vi.mock('../../contexts/ToastContext.jsx', () => ({ useToast: () => ({ showToast: showToastMock }) }));

const saveTextFileMock = vi.fn();
vi.mock('../downloadFile.js', () => ({ saveTextFile: (...args) => saveTextFileMock(...args) }));

import AdminAttendees from './AdminAttendees.jsx';

function pushRows(rows) {
  act(() => rowsCallback(rows));
}

const row = (overrides = {}) => ({
  id: 'uid-ada',
  displayName: 'Ada Lovelace',
  email: 'ada@example.com',
  registrationStatus: 'pending',
  approvalSource: null,
  ...overrides,
});

describe('AdminAttendees', () => {
  it('lists accounts with their registration status', () => {
    render(<MemoryRouter><AdminAttendees /></MemoryRouter>);
    pushRows([row(), row({ id: 'uid-bob', displayName: 'Bob Grace', email: 'bob@example.com', registrationStatus: 'approved', approvalSource: 'ticket' })]);

    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items[0]).toContain('Ada Lovelace');
    expect(items[0]).toContain('Pending');
    expect(items[1]).toContain('Approved');
  });

  it('approves a pending account through approveUser', async () => {
    callMock.mockResolvedValueOnce({ ok: true, changed: true, registrationStatus: 'approved' });
    render(<MemoryRouter><AdminAttendees /></MemoryRouter>);
    pushRows([row()]);

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await act(async () => { await Promise.resolve(); });

    expect(callMock).toHaveBeenCalledWith('approveUser', { uid: 'uid-ada' });
  });

  it('revokes an approved account through revokeUser', async () => {
    callMock.mockResolvedValueOnce({ ok: true, changed: true, registrationStatus: 'revoked' });
    render(<MemoryRouter><AdminAttendees /></MemoryRouter>);
    pushRows([row({ registrationStatus: 'approved', approvalSource: 'admin' })]);

    // Moment 3: revoking access states what the person loses first.
    fireEvent.click(screen.getByRole('button', { name: 'Revoke access' }));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke this person’s access' }));
    await act(async () => { await Promise.resolve(); });

    expect(callMock).toHaveBeenCalledWith('revokeUser', { uid: 'uid-ada' });
  });

  it('offers only the actions the §3.4 table allows', () => {
    render(<MemoryRouter><AdminAttendees /></MemoryRouter>);

    // pending: approve only — there is no pending → revoked edge.
    pushRows([row()]);
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke access' })).toBeNull();

    // admin-approved: revoke only — approving again would change nothing.
    pushRows([row({ registrationStatus: 'approved', approvalSource: 'admin' })]);
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Revoke access' })).toBeInTheDocument();

    // ticket-approved: approve is still offered, because it re-pins the
    // grant to 'admin' so a later refund cannot reverse it.
    pushRows([row({ registrationStatus: 'approved', approvalSource: 'ticket' })]);
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();

    // revoked: re-approval is the only way out.
    pushRows([row({ registrationStatus: 'revoked' })]);
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke access' })).toBeNull();
  });

  it('filters by status and searches by name or email', () => {
    render(<MemoryRouter><AdminAttendees /></MemoryRouter>);
    pushRows([
      row(),
      row({ id: 'uid-bob', displayName: 'Bob Grace', email: 'bob@example.com', registrationStatus: 'approved' }),
    ]);

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'approved' } });
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('Bob Grace')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'ada@' } });
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
  });

  it('surfaces a rejected transition instead of pretending it worked', async () => {
    callMock.mockRejectedValueOnce(new Error('An account with registration status "pending" cannot be revoked.'));
    render(<MemoryRouter><AdminAttendees /></MemoryRouter>);
    pushRows([row({ registrationStatus: 'ticketed' })]);

    // Moment 3: revoking access states what the person loses first.
    fireEvent.click(screen.getByRole('button', { name: 'Revoke access' }));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke this person’s access' }));
    await act(async () => { await Promise.resolve(); });

    expect(showToastMock).toHaveBeenCalledWith(
      'An account with registration status "pending" cannot be revoked.',
      { tone: 'error' },
    );
  });

  it('removes one custom badge through the admin endpoint and shows its pending state', async () => {
    let finish;
    callMock.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    render(<MemoryRouter><AdminAttendees /></MemoryRouter>);
    pushRows([row({ customBadges: ['News nerd'] })]);

    fireEvent.click(screen.getByRole('button', { name: 'Remove “News nerd”' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove “News nerd”' }));

    expect(callMock).toHaveBeenCalledWith('removeUserCustomBadge', {
      uid: 'uid-ada',
      badge: 'News nerd',
    });
    expect(screen.getByRole('button', { name: 'Removing…' })).toBeDisabled();

    await act(async () => { finish({ ok: true }); });
    expect(showToastMock).toHaveBeenCalledWith('Custom badge removed.');
  });

  it('reports a custom badge removal error', async () => {
    callMock.mockRejectedValueOnce(new Error('The custom badge could not be removed.'));
    render(<MemoryRouter><AdminAttendees /></MemoryRouter>);
    pushRows([row({ customBadges: ['News nerd'] })]);

    fireEvent.click(screen.getByRole('button', { name: 'Remove “News nerd”' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove “News nerd”' }));
    await act(async () => { await Promise.resolve(); });

    expect(showToastMock).toHaveBeenCalledWith(
      'The custom badge could not be removed.',
      { tone: 'error' },
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The custom badge could not be removed.',
    );
  });

  it('shows an empty state when nothing matches', () => {
    render(<MemoryRouter><AdminAttendees /></MemoryRouter>);
    pushRows([]);
    expect(screen.getByText('No attendees yet')).toBeInTheDocument();
  });
});

// Export (issue 184): the title band's one action, over the rows on screen.
describe('AdminAttendees export', () => {
  const three = () => [
    row({ id: 'uid-cy', displayName: 'Cy Marsh', email: 'cy@example.com', registrationStatus: 'approved' }),
    row(),
    row({ id: 'uid-bo', displayName: 'Bo Reyes', email: 'bo@example.com', registrationStatus: 'approved' }),
  ];
  const exportButton = () => screen.getByRole('button', { name: /^Download \d+ attendees?$|^Download$/ });

  it('renders once the list has loaded, and counts the rows on screen', () => {
    render(<MemoryRouter><AdminAttendees /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: /^Export/ })).toBeNull();

    pushRows(three());
    expect(exportButton()).toHaveAccessibleName('Download 3 attendees');

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'approved' } });
    expect(exportButton()).toHaveAccessibleName('Download 2 attendees');

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'bo@' } });
    expect(exportButton()).toHaveAccessibleName('Download 1 attendee');
  });

  it('is natively disabled at zero rows and says so', () => {
    render(<MemoryRouter><AdminAttendees /></MemoryRouter>);
    pushRows([]);
    expect(exportButton()).toHaveAccessibleName('Download 0 attendees');
    expect(exportButton()).toBeDisabled();
  });

  it('sends the shown uids in screen order with the filter, and never the search text', async () => {
    callMock.mockClear();
    callMock.mockResolvedValueOnce({ filename: 'attendees-2026-09-23.csv', csv: 'x', rowCount: 2, skipped: 0 });
    render(<MemoryRouter><AdminAttendees /></MemoryRouter>);
    pushRows(three());

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'approved' } });
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: '  example  ' } });
    fireEvent.click(exportButton());
    await act(async () => { await Promise.resolve(); });

    expect(callMock).toHaveBeenCalledTimes(1);
    const [name, body] = callMock.mock.calls[0];
    expect(name).toBe('exportAttendees');
    // Sorted by name, as the page lists them.
    expect(body).toEqual({ uids: ['uid-bo', 'uid-cy'], filter: { status: 'approved', searched: true } });
    expect(JSON.stringify(body)).not.toContain('example');
  });

  it('reports a blank search as no search', async () => {
    callMock.mockClear();
    callMock.mockResolvedValueOnce({ filename: 'attendees-2026-09-23.csv', csv: 'x', rowCount: 3, skipped: 0 });
    render(<MemoryRouter><AdminAttendees /></MemoryRouter>);
    pushRows(three());
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: '   ' } });
    fireEvent.click(exportButton());
    await act(async () => { await Promise.resolve(); });
    expect(callMock.mock.calls[0][1].filter).toEqual({ status: 'all', searched: false });
  });

  it('is busy and disabled in flight, saves the file, and states the result in place', async () => {
    callMock.mockClear();
    saveTextFileMock.mockClear();
    let finish;
    callMock.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    render(<MemoryRouter><AdminAttendees /></MemoryRouter>);
    pushRows(three());

    fireEvent.click(exportButton());
    const busy = exportButton();
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    // A second press while the first is in flight writes no second row.
    fireEvent.click(busy);
    expect(callMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish({ filename: 'attendees-2026-09-23.csv', csv: '\uFEFF"Name"\r\n', rowCount: 3, skipped: 0 });
    });

    expect(saveTextFileMock).toHaveBeenCalledWith('attendees-2026-09-23.csv', '\uFEFF"Name"\r\n');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Exported 3 attendees to attendees-2026-09-23.csv.',
    );
    expect(exportButton()).toHaveAccessibleName('Download 3 attendees');
    expect(exportButton()).toBeEnabled();
    expect(exportButton()).not.toHaveAttribute('aria-busy');

    // The result stays while the list moves under it.
    pushRows(three().slice(0, 2));
    expect(screen.getByRole('status')).toHaveTextContent('Exported 3 attendees');
  });

  it('shows a refusal in the server’s words and saves nothing', async () => {
    callMock.mockClear();
    saveTextFileMock.mockClear();
    callMock.mockRejectedValueOnce(new Error('uids: at most 10,000 attendees per export. Narrow the filter.'));
    render(<MemoryRouter><AdminAttendees /></MemoryRouter>);
    pushRows(three());

    fireEvent.click(exportButton());
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'uids: at most 10,000 attendees per export. Narrow the filter.',
    );
    expect(saveTextFileMock).not.toHaveBeenCalled();
    expect(exportButton()).toBeEnabled();
  });
});

// The organizer record (issue 185): the panel under a row, and a delete's
// result stated at page level, where it outlives the row.
describe('AdminAttendees record and delete', () => {
  const INCOMPLETE = 'The account is out of the directory. Some of its data could not be cleared. Try again.';

  function incompleteError() {
    return Object.assign(new Error(INCOMPLETE), { code: 'delete-incomplete', status: 500 });
  }

  async function deleteFromPanel(name = 'Ada Lovelace') {
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit attendee record' })[0]);
    expect(screen.getByRole('region', { name: `Record for ${name}` })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete this account' }));
    await act(async () => { await Promise.resolve(); });
  }

  it('summarizes diet, access and photo answers, and shows each attendee their own answers', () => {
    render(<MemoryRouter><AdminAttendees /></MemoryRouter>);
    pushRows([row(), row({ id: 'uid-bo', displayName: 'Bo Reyes', email: 'bo@example.com' })]);
    expect(screen.queryByRole('heading', { name: 'Registration answers' })).toBeNull();
    act(() => {
      formCallback({ revision: 1, standard: { dietary: { enabled: true }, accessNeeds: { enabled: true }, photoConsent: { enabled: true } }, custom: [] });
      collectionCallbacks.ticket_answers([
        { id: 't-ada', uid: row().id, answers: { dietary: { choices: ['Vegan'], other: null }, accessNeeds: 'Step-free stage.', photoConsent: true } },
        { id: 't-bo', uid: 'uid-bo', answers: { dietary: { choices: ['Vegan', 'Other'], other: 'Low sodium' }, photoConsent: false } },
        // Refunded: kept on record, left out of the counts.
        { id: 't-cy', uid: 'uid-cy', ticketStatus: 'refunded', answers: { dietary: { choices: ['Vegan'], other: null }, photoConsent: true } },
      ]);
    });
    const summary = within(screen.getByRole('heading', { level: 2, name: 'Registration answers' }).closest('section'));
    expect(summary.getByText('Vegan: 2')).toBeInTheDocument();
    expect(summary.getByText('Other: Low sodium')).toBeInTheDocument();
    expect(summary.getByText(/1 attendee told you about access needs/)).toBeInTheDocument();
    expect(summary.queryByText('Step-free stage.')).toBeNull();
    expect(summary.getByText('Yes: 1. No: 1.')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit attendee record' })[0]);
    const answers = within(screen.getByRole('region', { name: 'Registration answers' }));
    expect(answers.getByText('Step-free stage.')).toBeInTheDocument();
    expect(answers.getByText('Access needs (private)')).toBeInTheDocument();
  });

  it('shows past attendance as a meta line on the row face', () => {
    render(<MemoryRouter><AdminAttendees /></MemoryRouter>);
    pushRows([row({ pastAttendance: ['2024', '2025'] }), row({ id: 'uid-bo', displayName: 'Bo Reyes' })]);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Past attendance: 2024; 2025');
    expect(items[1]).not.toHaveTextContent('Past attendance');
  });

  it('opens one record at a time', () => {
    render(<MemoryRouter><AdminAttendees /></MemoryRouter>);
    pushRows([row(), row({ id: 'uid-bo', displayName: 'Bo Reyes', email: 'bo@example.com' })]);
    const [adaToggle, boToggle] = screen.getAllByRole('button', { name: 'Edit attendee record' });

    fireEvent.click(adaToggle);
    expect(adaToggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: 'Record for Ada Lovelace' })).toBeInTheDocument();

    fireEvent.click(boToggle);
    expect(adaToggle).toHaveAttribute('aria-expanded', 'false');
    expect(boToggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByRole('region', { name: 'Record for Ada Lovelace' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Record for Bo Reyes' })).toBeInTheDocument();
  });

  it('states a completed delete at page level and moves focus to it once the row has left', async () => {
    callMock.mockReset();
    callMock.mockResolvedValueOnce({ ok: true, uid: 'uid-ada', removed: {} });
    render(<MemoryRouter><AdminAttendees /></MemoryRouter>);
    pushRows([row(), row({ id: 'uid-bo', displayName: 'Bo Reyes', email: 'bo@example.com' })]);

    await deleteFromPanel();
    expect(callMock).toHaveBeenCalledWith('deleteAttendee', { uid: 'uid-ada' });

    // The listener drops the row.
    pushRows([row({ id: 'uid-bo', displayName: 'Bo Reyes', email: 'bo@example.com' })]);
    const done = screen.getByText('Deleted the account for Ada Lovelace.');
    expect(done).toHaveAttribute('role', 'status');
    expect(document.activeElement).toBe(done);
    expect(screen.queryByText('Ada Lovelace')).toBeNull();
  });

  it('keeps a delete-incomplete notice and a retry after the row leaves; the retry deletes the kept uid', async () => {
    callMock.mockReset();
    callMock.mockRejectedValueOnce(incompleteError());
    render(<MemoryRouter><AdminAttendees /></MemoryRouter>);
    pushRows([row(), row({ id: 'uid-bo', displayName: 'Bo Reyes', email: 'bo@example.com' })]);

    await deleteFromPanel();
    // The account left the directory, so the listener drops the row.
    pushRows([row({ id: 'uid-bo', displayName: 'Bo Reyes', email: 'bo@example.com' })]);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(`Ada Lovelace: ${INCOMPLETE}`);
    expect(document.activeElement).toBe(alert.parentElement);
    const retry = screen.getByRole('button', { name: 'Try the delete again' });

    // A retry that fails again keeps the notice and the retry.
    callMock.mockRejectedValueOnce(incompleteError());
    fireEvent.click(retry);
    await act(async () => { await Promise.resolve(); });
    expect(callMock).toHaveBeenLastCalledWith('deleteAttendee', { uid: 'uid-ada' });
    expect(screen.getByRole('button', { name: 'Try the delete again' })).toBeInTheDocument();

    // A retry that succeeds replaces it with the stated result.
    let finish;
    callMock.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Try the delete again' }));
    const busy = screen.getByRole('button', { name: 'Deleting…' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    await act(async () => { finish({ ok: true, uid: 'uid-ada', removed: {} }); });

    expect(callMock).toHaveBeenCalledTimes(3);
    expect(callMock.mock.calls.every(([name, body]) => name === 'deleteAttendee' && body.uid === 'uid-ada')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Try the delete again' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.activeElement).toBe(screen.getByText('Deleted the account for Ada Lovelace.'));
  });

  it('treats a 404 on the retry as done: nothing of the account remains', async () => {
    callMock.mockReset();
    callMock.mockRejectedValueOnce(incompleteError());
    render(<MemoryRouter><AdminAttendees /></MemoryRouter>);
    pushRows([row()]);
    await deleteFromPanel();
    pushRows([]);

    callMock.mockRejectedValueOnce(Object.assign(new Error('No such account.'), { code: 'not-found', status: 404 }));
    fireEvent.click(screen.getByRole('button', { name: 'Try the delete again' }));
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText('Deleted the account for Ada Lovelace.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try the delete again' })).toBeNull();
  });

  // Review finding: phase 1 deletes users/{uid} before the sweep runs, so
  // the listener drops the row, and the panel with it, while the call is
  // still running. A failure the server did not shape (a gateway timeout,
  // a dropped connection) must still leave the retry on the page.
  for (const [label, error] of [
    ['a gateway timeout', { code: 'unknown', status: 504, message: 'Something went wrong. Try again.' }],
    ['a dropped connection', {
      code: 'network', status: 0, message: 'We could not reach the server. Check your connection and try again.',
    }],
  ]) {
    it(`keeps the retry when the call fails with ${label} after the row has left`, async () => {
      callMock.mockReset();
      let fail;
      callMock.mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject; }));
      render(<MemoryRouter><AdminAttendees /></MemoryRouter>);
      pushRows([row(), row({ id: 'uid-bo', displayName: 'Bo Reyes', email: 'bo@example.com' })]);

      await deleteFromPanel();
      // Phase 1 committed: the listener drops the row while the call runs.
      pushRows([row({ id: 'uid-bo', displayName: 'Bo Reyes', email: 'bo@example.com' })]);
      await act(async () => { fail(Object.assign(new Error(error.message), error)); });

      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('Ada Lovelace');
      expect(alert).toHaveTextContent(error.message);
      expect(document.activeElement).toBe(alert.parentElement);

      callMock.mockResolvedValueOnce({ ok: true, uid: 'uid-ada', removed: {} });
      fireEvent.click(screen.getByRole('button', { name: 'Try the delete again' }));
      await act(async () => { await Promise.resolve(); });

      expect(callMock).toHaveBeenLastCalledWith('deleteAttendee', { uid: 'uid-ada' });
      expect(screen.getByText('Deleted the account for Ada Lovelace.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Try the delete again' })).toBeNull();
    });
  }

  it('states a refusal made before anything was deleted in the row’s own panel, with focus', async () => {
    callMock.mockReset();
    callMock.mockRejectedValueOnce(Object.assign(
      new Error('This account is linked to a speaker. Delete the speaker record first.'),
      { code: 'speaker-linked', status: 409 },
    ));
    render(<MemoryRouter><AdminAttendees /></MemoryRouter>);
    pushRows([row()]);

    await deleteFromPanel();

    const panel = screen.getByRole('region', { name: 'Record for Ada Lovelace' });
    const alert = within(panel).getByRole('alert');
    expect(alert).toHaveTextContent('This account is linked to a speaker.');
    expect(document.activeElement).toBe(alert.parentElement);
    expect(screen.queryByRole('button', { name: 'Try the delete again' })).toBeNull();
  });

  it('a pre-commit refusal for a row that is no longer listed still reaches the page with a retry', async () => {
    callMock.mockReset();
    let fail;
    callMock.mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject; }));
    render(<MemoryRouter><AdminAttendees /></MemoryRouter>);
    pushRows([row()]);
    await deleteFromPanel();
    pushRows([]);
    await act(async () => {
      fail(Object.assign(new Error('Admin access could not be checked. Try again.'), { code: 'internal', status: 500 }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Admin access could not be checked. Try again.');
    expect(screen.getByRole('button', { name: 'Try the delete again' })).toBeInTheDocument();
  });
});

