// AdminFeedback — the review tab (issue #28). Mocks adminApi and
// adminSource directly, same convention as AdminLiveUpdates.test.jsx.
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

import AdminFeedback from './AdminFeedback.jsx';

function pushRows(rows) {
  act(() => rowsCallback(rows));
}

describe('AdminFeedback', () => {
  it('lists submissions newest first, defaulting to the open filter', () => {
    render(<AdminFeedback />);
    pushRows([
      { id: 'f1', message: 'Older', status: 'new', createdAt: new Date('2026-08-01T00:00:00Z') },
      { id: 'f2', message: 'Newer', status: 'new', createdAt: new Date('2026-08-10T00:00:00Z') },
      { id: 'f3', message: 'Archived one', status: 'archived', createdAt: new Date('2026-08-15T00:00:00Z') },
    ]);
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items[0]).toContain('Newer');
    expect(items[1]).toContain('Older');
    // 'open' filter (default) excludes archived rows.
    expect(items.some((text) => text.includes('Archived one'))).toBe(false);
  });

  it('marks a row reviewed via updateFeedbackStatus', async () => {
    callMock.mockResolvedValueOnce({ id: 'f1', status: 'reviewed' });
    render(<AdminFeedback />);
    pushRows([{ id: 'f1', message: 'Bug here', status: 'new', createdAt: new Date() }]);

    fireEvent.click(screen.getByRole('button', { name: 'Mark reviewed' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(callMock).toHaveBeenCalledWith('updateFeedbackStatus', { id: 'f1', status: 'reviewed' });
  });

  it('archives a row via updateFeedbackStatus', async () => {
    callMock.mockResolvedValueOnce({ id: 'f1', status: 'archived' });
    render(<AdminFeedback />);
    pushRows([{ id: 'f1', message: 'Bug here', status: 'new', createdAt: new Date() }]);

    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(callMock).toHaveBeenCalledWith('updateFeedbackStatus', { id: 'f1', status: 'archived' });
  });

  it('shows an empty state when nothing matches the filter', () => {
    render(<AdminFeedback />);
    pushRows([]);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });

  it('never offers "Mark reviewed" on an archived row (Codex P2: it would silently unarchive)', () => {
    render(<AdminFeedback />);
    pushRows([{ id: 'f1', message: 'Old bug', status: 'archived', createdAt: new Date() }]);
    // Switch off the default 'open' filter (which hides archived rows) so
    // the archived row is actually on screen to assert against.
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'all' } });
    expect(screen.queryByRole('button', { name: 'Mark reviewed' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument();
  });

  it('never offers "Mark reviewed" on an already-reviewed row', () => {
    render(<AdminFeedback />);
    pushRows([{ id: 'f1', message: 'Handled', status: 'reviewed', createdAt: new Date() }]);
    expect(screen.queryByRole('button', { name: 'Mark reviewed' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
  });
});
