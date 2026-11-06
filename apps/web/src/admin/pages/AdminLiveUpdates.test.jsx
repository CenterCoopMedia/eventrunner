// AdminLiveUpdates — the live-updates compose/edit/delete form (issue #28).
// Mocks adminApi and adminSource directly rather than going through the full
// router/auth stack (AdminSettings.test.jsx's style), since this page has no
// EventConfigContext dependency beyond `features` for the off-feature notice.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

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

vi.mock('../../contexts/AuthContext.jsx', () => ({ useAuth: () => ({ isOperator: false }) }));

let features = { liveUpdates: true };
vi.mock('../../contexts/EventConfigContext.jsx', () => ({ useEventConfig: () => ({ features }) }));

import AdminLiveUpdates from './AdminLiveUpdates.jsx';

function pushRows(rows) {
  act(() => rowsCallback(rows));
}

describe('AdminLiveUpdates', () => {
  it('posts a new entry via saveLiveUpdate with no id', async () => {
    callMock.mockResolvedValueOnce({ id: 'auto1' });
    render(<AdminLiveUpdates />);
    pushRows([]);

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Doors open at 9am.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post update' }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(callMock).toHaveBeenCalledWith('saveLiveUpdate', {
      update: { message: 'Doors open at 9am.', pinned: false, category: null, audience: 'everyone' },
    });
  });

  it('edits an existing entry via saveLiveUpdate with its id', async () => {
    callMock.mockResolvedValueOnce({ id: 'u1' });
    render(<AdminLiveUpdates />);
    pushRows([{ id: 'u1', message: 'Old message', pinned: false, audience: 'everyone', postedAt: new Date('2026-08-01T00:00:00Z') }]);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Fixed message' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(callMock).toHaveBeenCalledWith('saveLiveUpdate', {
      id: 'u1',
      update: { message: 'Fixed message', pinned: false, category: null, audience: 'everyone' },
    });
  });

  it('deletes an entry via deleteLiveUpdate', async () => {
    callMock.mockResolvedValueOnce({ id: 'u1', deleted: true });
    render(<AdminLiveUpdates />);
    pushRows([{ id: 'u1', message: 'Remove me', pinned: false }]);

    // Moment 3: the first press states what goes, the second does it.
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(callMock).not.toHaveBeenCalledWith('deleteLiveUpdate', { id: 'u1' });
    fireEvent.click(screen.getByRole('button', { name: 'Remove this update' }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(callMock).toHaveBeenCalledWith('deleteLiveUpdate', { id: 'u1' });
  });

  it('shows a notice when the liveUpdates feature is off', () => {
    features = { liveUpdates: false };
    render(<AdminLiveUpdates />);
    pushRows([]);
    expect(screen.getByText('Live updates: Off. Only an operator can change this setting.')).toBeInTheDocument();
    features = { liveUpdates: true };
  });

  it('sends the category and the chosen audience (issue 200)', async () => {
    callMock.mockResolvedValueOnce({ id: 'auto1' });
    render(<AdminLiveUpdates />);
    pushRows([]);

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Green room moved.' } });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: ' Rooms ' } });
    const audience = screen.getByLabelText('Who can read it');
    expect(audience).toHaveValue('everyone');
    expect(audience).toHaveAccessibleDescription(/database enforces this/);
    fireEvent.change(audience, { target: { value: 'speakers' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post update' }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(callMock).toHaveBeenCalledWith('saveLiveUpdate', {
      update: { message: 'Green room moved.', pinned: false, category: 'Rooms', audience: 'speakers' },
    });
  });

  it('opens an entry with its own category and audience', () => {
    render(<AdminLiveUpdates />);
    pushRows([{ id: 'u1', message: 'Badge desk', pinned: false, category: 'Venue', audience: 'attendees' }]);
    expect(screen.getByText('For attendees')).toBeInTheDocument();
    expect(screen.getByText('Venue')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Category')).toHaveValue('Venue');
    expect(screen.getByLabelText('Who can read it')).toHaveValue('attendees');
  });

  it('names a row with no audience, which only admins can read, and saving gives it one', async () => {
    callMock.mockResolvedValueOnce({ id: 'old' });
    render(<AdminLiveUpdates />);
    pushRows([
      { id: 'old', message: 'From before audiences', pinned: false },
      { id: 'new', message: 'Has one', pinned: false, audience: 'everyone' },
    ]);
    expect(screen.getByText('Admins only, no audience set')).toBeInTheDocument();
    expect(screen.getByText(/1 update has no audience, so only admins can read it/)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    expect(screen.getByLabelText('Who can read it')).toHaveValue('everyone');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(callMock).toHaveBeenCalledWith('saveLiveUpdate', {
      id: 'old',
      update: { message: 'From before audiences', pinned: false, category: null, audience: 'everyone' },
    });
  });
});

describe('live update action feedback', () => {
  beforeEach(() => { callMock.mockReset(); showToastMock.mockReset(); });

  it('focuses the composer on edit and locks the draft until the pending save finishes', async () => {
    let finish;
    callMock.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    render(<AdminLiveUpdates />);
    pushRows([{ id: 'a', message: 'First update', audience: 'everyone' }, { id: 'b', message: 'Second update', audience: 'everyone' }]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    const message = screen.getByLabelText('Message');
    expect(message).toHaveFocus();
    fireEvent.change(message, { target: { value: 'Submitted update' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(message).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    const otherEdit = screen.getAllByRole('button', { name: 'Edit' })[1];
    expect(otherEdit).toBeDisabled();
    fireEvent.click(otherEdit);
    expect(message).toHaveValue('Submitted update');
    await act(async () => finish({ id: 'a' }));
    expect(message).not.toBeDisabled();
    expect(message).toHaveValue('');
    expect(screen.getByRole('status')).toHaveTextContent('Live update saved.');
    expect(showToastMock).toHaveBeenLastCalledWith('Live update saved.', { announce: false });
  });

  it('focuses a save refusal and keeps the attempted message', async () => {
    callMock.mockRejectedValueOnce(new Error('The update could not be saved.'));
    render(<AdminLiveUpdates />);
    pushRows([]);
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Keep this message' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post update' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus());
    expect(screen.getByLabelText('Message')).toHaveValue('Keep this message');
  });

  it('keeps a delete failure beside its row after the toast disappears', async () => {
    callMock.mockRejectedValueOnce(new Error('Removal failed. Try again.'));
    render(<AdminLiveUpdates />);
    pushRows([{ id: 'a', message: 'Keep me', audience: 'everyone' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove this update' }));
    const row = screen.getByText('Keep me').closest('li');
    expect(await within(row).findByRole('alert')).toHaveTextContent('Removal failed. Try again.');
    expect(within(row).getByRole('button', { name: 'Remove this update' })).toBeEnabled();
  });
});
