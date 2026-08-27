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

  it('shows an empty state when nothing matches', () => {
    render(<AdminAttendees />);
    pushRows([]);
    expect(screen.getByText('No attendees')).toBeInTheDocument();
  });
});
