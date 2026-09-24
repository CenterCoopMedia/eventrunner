// AttendeeRecordPanel — one attendee's organizer record (issue 185).
import { useState } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { AdminApiError } from '../adminApi.js';

const callMock = vi.fn();
vi.mock('../adminApi.js', async (importOriginal) => ({
  ...(await importOriginal()),
  useAdminApi: () => callMock,
}));

import AttendeeRecordPanel, {
  AttendeeRecordToggle,
  SPEAKER_LINKED_REASON,
  recordPanelId,
  refusedBeforeDelete,
} from './AttendeeRecordPanel.jsx';

const row = (overrides = {}) => ({
  id: 'uid-ada',
  displayName: 'Ada Quill',
  email: 'ada@example.com',
  registrationStatus: 'approved',
  pastAttendance: ['2024', '2025'],
  speakerId: null,
  ...overrides,
});

/**
 * The row face's toggle and the panel. The page owns a delete's outcome;
 * this stand-in hands a failure back to the panel as `deleteError`, the
 * way the page does for a refusal on a row that is still listed.
 */
function Harness({ account = row(), onDeleted = () => {}, onDeleteFailed = () => {}, onDeleteStart = () => {} }) {
  const [open, setOpen] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  return (
    <div>
      <AttendeeRecordToggle uid={account.id} open={open} onToggle={() => setOpen((value) => !value)} />
      {open ? (
        <AttendeeRecordPanel
          row={account}
          deleteError={deleteError}
          onDeleteStart={onDeleteStart}
          onDeleted={onDeleted}
          onDeleteFailed={(result) => { onDeleteFailed(result); setDeleteError(result.error); }}
        />
      ) : null}
    </div>
  );
}

function openPanel(props) {
  render(<Harness {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit record' }));
}

const flush = () => act(async () => { await Promise.resolve(); });

describe('AttendeeRecordPanel', () => {
  beforeEach(() => {
    callMock.mockReset();
  });

  it('opens and closes from the row face, and says so with aria-expanded', () => {
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: 'Edit record' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', recordPanelId('uid-ada'));
    expect(screen.queryByLabelText('Past attendance')).toBeNull();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const panel = screen.getByRole('region', { name: 'Record for Ada Quill' });
    expect(panel).toHaveAttribute('id', recordPanelId('uid-ada'));

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'Record for Ada Quill' })).toBeNull();
  });

  it('prefills one edition per line, with the hint that says who owns the list', () => {
    openPanel();
    const field = screen.getByLabelText('Past attendance');
    expect(field).toHaveValue('2024\n2025');
    expect(screen.getByText(
      'One edition per line, such as a year. Attendees cannot change this list. It is part of the export.',
    )).toBeInTheDocument();
  });

  it('saves trimmed lines with no blanks through updateAttendee, and the result stays', async () => {
    callMock.mockResolvedValueOnce({ ok: true, uid: 'uid-ada', pastAttendance: ['2023', '2024', 'Spring 2025'] });
    openPanel();

    fireEvent.change(screen.getByLabelText('Past attendance'), {
      target: { value: '  2023 \n\n2024\r\n   \nSpring 2025  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save record' }));
    await flush();

    expect(callMock).toHaveBeenCalledWith('updateAttendee', {
      uid: 'uid-ada',
      pastAttendance: ['2023', '2024', 'Spring 2025'],
    });
    expect(screen.getByRole('status')).toHaveTextContent('Past attendance saved.');
    expect(screen.getByLabelText('Past attendance')).toHaveValue('2023\n2024\nSpring 2025');
  });

  it('is busy while the save is in flight', async () => {
    let finish;
    callMock.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Save record' }));
    const busy = screen.getByRole('button', { name: 'Saving…' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    await act(async () => { finish({ ok: true, pastAttendance: [] }); });
    expect(screen.getByRole('button', { name: 'Save record' })).toBeEnabled();
  });

  it('marks the field and moves focus to the summary when the server refuses the list', async () => {
    callMock.mockRejectedValueOnce(new AdminApiError({
      code: 'bad-request',
      status: 400,
      message: 'pastAttendance: "2024" is listed twice.',
    }));
    openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Save record' }));
    await flush();

    const summary = screen.getByRole('alert');
    expect(summary).toHaveTextContent('pastAttendance: "2024" is listed twice.');
    expect(document.activeElement).toBe(summary);
    expect(screen.getByLabelText('Past attendance')).toHaveAttribute('aria-invalid', 'true');
    // The rejected value is kept for the fix.
    expect(screen.getByLabelText('Past attendance')).toHaveValue('2024\n2025');
  });

  it('deletes through deleteAttendee only after the confirm step, and reports the result up', async () => {
    const onDeleted = vi.fn();
    callMock.mockResolvedValueOnce({ ok: true, uid: 'uid-ada', removed: {} });
    openPanel({ onDeleted });

    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    expect(callMock).not.toHaveBeenCalled();
    // The still surface states what goes, what stays, and that it is final.
    expect(screen.getByRole('heading', { name: 'Delete the account for Ada Quill' })).toBeInTheDocument();
    expect(screen.getByText(/its sign-in, its saved sessions, its private notes, its profile photo, its change requests, and its ticket claim/))
      .toHaveTextContent('The ticket record, sent email records, feedback, session reactions, and the admin log stay. This cannot be undone.');

    fireEvent.click(screen.getByRole('button', { name: 'Delete this account' }));
    expect(screen.getByRole('button', { name: 'Deleting…' })).toBeDisabled();
    await flush();

    expect(callMock).toHaveBeenCalledWith('deleteAttendee', { uid: 'uid-ada' });
    expect(onDeleted).toHaveBeenCalledWith({ uid: 'uid-ada', name: 'Ada Quill' });
  });

  it('hands every failure to the page, whatever its shape, because the row may already be gone', async () => {
    for (const shape of [
      { code: 'delete-incomplete', status: 500, message: 'The account is out of the directory. Some of its data could not be cleared. Try again.' },
      { code: 'unknown', status: 504, message: 'Something went wrong. Try again.' },
      { code: 'network', status: 0, message: 'We could not reach the server. Check your connection and try again.' },
    ]) {
      const onDeleteFailed = vi.fn();
      const onDeleteStart = vi.fn();
      const error = new AdminApiError(shape);
      callMock.mockRejectedValueOnce(error);
      const { unmount } = render(<Harness onDeleteFailed={onDeleteFailed} onDeleteStart={onDeleteStart} />);
      fireEvent.click(screen.getByRole('button', { name: 'Edit record' }));

      fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
      fireEvent.click(screen.getByRole('button', { name: 'Delete this account' }));
      await flush();

      expect(onDeleteStart).toHaveBeenCalledWith('uid-ada');
      expect(onDeleteFailed).toHaveBeenCalledWith({ uid: 'uid-ada', name: 'Ada Quill', error });
      unmount();
    }
  });

  it('knows which failures came before anything was deleted', () => {
    for (const shape of [
      { status: 409, code: 'own-account' },
      { status: 409, code: 'admin-account' },
      { status: 409, code: 'speaker-linked' },
      { status: 409, code: 'too-many-claims' },
      { status: 400, code: 'bad-request' },
      { status: 401, code: 'unauthorized' },
      { status: 403, code: 'forbidden' },
      { status: 500, code: 'internal' },
    ]) {
      expect(refusedBeforeDelete(shape), JSON.stringify(shape)).toBe(true);
    }
    for (const shape of [
      { status: 500, code: 'delete-incomplete' },
      { status: 504, code: 'unknown' },
      { status: 500, code: 'unknown' },
      { status: 0, code: 'network' },
      { status: 409, code: 'something-else' },
      null,
    ]) {
      expect(refusedBeforeDelete(shape), JSON.stringify(shape)).toBe(false);
    }
  });

  it('states a refusal the page hands back in place, in the server’s words, and moves focus to it', async () => {
    callMock.mockRejectedValueOnce(new AdminApiError({
      code: 'admin-account',
      status: 409,
      message: 'This account has admin access. An operator must remove that access before the account can be deleted.',
    }));
    openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete this account' }));
    await flush();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('This account has admin access.');
    expect(document.activeElement).toBe(alert.parentElement);
  });

  it('a speaker-linked account shows the reason and a natively disabled delete', () => {
    openPanel({ account: row({ speakerId: 'spk-1' }) });
    expect(screen.getByText(SPEAKER_LINKED_REASON)).toBeInTheDocument();
    expect(SPEAKER_LINKED_REASON).toBe('This account is linked to a speaker. Delete the speaker record first.');
    expect(screen.getByRole('button', { name: 'Delete account' })).toBeDisabled();
  });
});
