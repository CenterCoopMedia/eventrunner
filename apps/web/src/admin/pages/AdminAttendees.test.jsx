// AdminAttendees — the registration tab (issue #32, spec §3.4). Mocks
// adminApi and adminSource directly, same convention as AdminFeedback.test.jsx.
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

let rowsCallback;
vi.mock('../adminSource.js', () => ({
  subscribeAdminCollection: (_name, onNext) => {
    rowsCallback = onNext;
    return () => {};
  },
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
    render(<AdminAttendees />);
    pushRows([row(), row({ id: 'uid-bob', displayName: 'Bob Grace', email: 'bob@example.com', registrationStatus: 'approved', approvalSource: 'ticket' })]);

    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items[0]).toContain('Ada Lovelace');
    expect(items[0]).toContain('Pending');
    expect(items[1]).toContain('Approved');
  });

  it('approves a pending account through approveUser', async () => {
    callMock.mockResolvedValueOnce({ ok: true, changed: true, registrationStatus: 'approved' });
    render(<AdminAttendees />);
    pushRows([row()]);

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await act(async () => { await Promise.resolve(); });

    expect(callMock).toHaveBeenCalledWith('approveUser', { uid: 'uid-ada' });
  });

  it('revokes an approved account through revokeUser', async () => {
    callMock.mockResolvedValueOnce({ ok: true, changed: true, registrationStatus: 'revoked' });
    render(<AdminAttendees />);
    pushRows([row({ registrationStatus: 'approved', approvalSource: 'admin' })]);

    // Moment 3: revoking access states what the person loses first.
    fireEvent.click(screen.getByRole('button', { name: 'Revoke access' }));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke this person’s access' }));
    await act(async () => { await Promise.resolve(); });

    expect(callMock).toHaveBeenCalledWith('revokeUser', { uid: 'uid-ada' });
  });

  it('offers only the actions the §3.4 table allows', () => {
    render(<AdminAttendees />);

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
    render(<AdminAttendees />);
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
    render(<AdminAttendees />);
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
    render(<AdminAttendees />);
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
    render(<AdminAttendees />);
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
    render(<AdminAttendees />);
    pushRows([]);
    expect(screen.getByText('No attendees')).toBeInTheDocument();
  });
});

// Export (issue 184): the title band's one action, over the rows on screen.
describe('AdminAttendees export', () => {
  const three = () => [
    row({ id: 'uid-cy', displayName: 'Cy Marsh', email: 'cy@example.com', registrationStatus: 'approved' }),
    row(),
    row({ id: 'uid-bo', displayName: 'Bo Reyes', email: 'bo@example.com', registrationStatus: 'approved' }),
  ];
  const exportButton = () => screen.getByRole('button', { name: /^Export \d+ attendees?$|^Exporting…$/ });

  it('renders once the list has loaded, and counts the rows on screen', () => {
    render(<AdminAttendees />);
    expect(screen.queryByRole('button', { name: /^Export/ })).toBeNull();

    pushRows(three());
    expect(exportButton()).toHaveTextContent('Export 3 attendees');

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'approved' } });
    expect(exportButton()).toHaveTextContent('Export 2 attendees');

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'bo@' } });
    expect(exportButton()).toHaveTextContent('Export 1 attendee');
  });

  it('is natively disabled at zero rows and says so', () => {
    render(<AdminAttendees />);
    pushRows([]);
    expect(exportButton()).toHaveTextContent('Export 0 attendees');
    expect(exportButton()).toBeDisabled();
  });

  it('sends the shown uids in screen order with the filter, and never the search text', async () => {
    callMock.mockClear();
    callMock.mockResolvedValueOnce({ filename: 'attendees-2026-09-23.csv', csv: 'x', rowCount: 2, skipped: 0 });
    render(<AdminAttendees />);
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
    render(<AdminAttendees />);
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
    render(<AdminAttendees />);
    pushRows(three());

    fireEvent.click(exportButton());
    const busy = screen.getByRole('button', { name: 'Exporting…' });
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
      'Exported 3 attendees to attendees-2026-09-23.csv. The export is in the admin log.',
    );
    expect(exportButton()).toHaveTextContent('Export 3 attendees');
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
    render(<AdminAttendees />);
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
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit record' })[0]);
    expect(screen.getByRole('region', { name: `Record for ${name}` })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete this account' }));
    await act(async () => { await Promise.resolve(); });
  }

  it('shows past attendance as a meta line on the row face', () => {
    render(<AdminAttendees />);
    pushRows([row({ pastAttendance: ['2024', '2025'] }), row({ id: 'uid-bo', displayName: 'Bo Reyes' })]);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Past attendance: 2024; 2025');
    expect(items[1]).not.toHaveTextContent('Past attendance');
  });

  it('opens one record at a time', () => {
    render(<AdminAttendees />);
    pushRows([row(), row({ id: 'uid-bo', displayName: 'Bo Reyes', email: 'bo@example.com' })]);
    const [adaToggle, boToggle] = screen.getAllByRole('button', { name: 'Edit record' });

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
    render(<AdminAttendees />);
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
    render(<AdminAttendees />);
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
    render(<AdminAttendees />);
    pushRows([row()]);
    await deleteFromPanel();
    pushRows([]);

    callMock.mockRejectedValueOnce(Object.assign(new Error('No such account.'), { code: 'not-found', status: 404 }));
    fireEvent.click(screen.getByRole('button', { name: 'Try the delete again' }));
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText('Deleted the account for Ada Lovelace.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try the delete again' })).toBeNull();
  });
});

