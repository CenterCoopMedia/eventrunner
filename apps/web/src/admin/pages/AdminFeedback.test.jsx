vi.mock('../components/PlannerFeatureControls.jsx', () => ({ default: () => null }));
// AdminFeedback — the review tab (issue #28). Mocks adminApi and
// adminSource directly, same convention as AdminLiveUpdates.test.jsx.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

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

beforeEach(() => {
  callMock.mockReset();
  showToastMock.mockReset();
});

describe('AdminFeedback', () => {
  it('encodes reserved characters in a mailto link and keeps the @', () => {
    render(<AdminFeedback />);
    pushRows([
      { id: 'f1', message: 'Plain', status: 'new', email: 'ada@example.org', createdAt: new Date('2026-08-01T00:00:00Z') },
      { id: 'f2', message: 'Name', status: 'new', email: "o'connor@example.org", createdAt: new Date('2026-08-02T00:00:00Z') },
      { id: 'f3', message: 'Local', status: 'new', email: 'ada?bcc=other@example.org', createdAt: new Date('2026-08-03T00:00:00Z') },
      { id: 'f4', message: 'Domain', status: 'new', email: 'ada@example.org?bcc=other@example.org', createdAt: new Date('2026-08-04T00:00:00Z') },
    ]);
    expect(screen.getByRole('link', { name: 'ada@example.org' })).toHaveAttribute('href', 'mailto:ada@example.org');
    expect(screen.getByRole('link', { name: "o'connor@example.org" })).toHaveAttribute('href', "mailto:o'connor@example.org");
    expect(screen.getByRole('link', { name: 'ada?bcc=other@example.org' })).toHaveAttribute(
      'href',
      'mailto:ada%3Fbcc%3Dother@example.org',
    );
    expect(screen.getByRole('link', { name: 'ada@example.org?bcc=other@example.org' })).toHaveAttribute(
      'href',
      'mailto:ada@example.org%3Fbcc%3Dother%40example.org',
    );
  });

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

  it('states a failed status change on the row, not only in a toast', async () => {
    // A toast leaves. When it does, a row whose write failed looks exactly
    // like a row nobody touched — so the failure is stated in place, beside
    // the control that caused it, and it stays (admin story part 5).
    callMock.mockRejectedValueOnce(new Error('You are not signed in as an admin.'));
    render(<AdminFeedback />);
    pushRows([{ id: 'f1', message: 'Bug here', status: 'new', createdAt: new Date() }]);

    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await act(async () => {
      await Promise.resolve();
    });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('This did not save.');
    expect(alert.textContent).toContain('You are not signed in as an admin.');
    expect(showToastMock).toHaveBeenCalledWith(
      'You are not signed in as an admin.',
      { tone: 'error', announce: false },
    );
  });

  it('clears the failure when the next attempt starts', async () => {
    callMock.mockRejectedValueOnce(new Error('Try again.'));
    render(<AdminFeedback />);
    pushRows([{ id: 'f1', message: 'Bug here', status: 'new', createdAt: new Date() }]);
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();

    callMock.mockResolvedValueOnce({ id: 'f1', status: 'archived' });
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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
    expect(screen.getByText('No feedback here')).toBeInTheDocument();
  });

  it('serializes row writes and moves focus beside the archived row after the listener updates', async () => {
    let finish;
    callMock.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    render(<AdminFeedback />);
    const rows = [
      { id: 'f1', message: 'Newest report', status: 'new', createdAt: new Date('2026-08-10') },
      { id: 'f2', message: 'Next report', status: 'new', createdAt: new Date('2026-08-09') },
    ];
    pushRows(rows);
    const first = screen.getByText('Newest report').closest('li');
    const next = screen.getByText('Next report').closest('li');
    const archive = within(first).getByRole('button', { name: 'Archive' });
    archive.focus();
    fireEvent.click(archive);
    expect(within(first).getByRole('button', { name: 'Archiving…' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByLabelText('Show')).toBeDisabled();
    const nextArchive = within(next).getByRole('button', { name: 'Archive' });
    expect(nextArchive).toBeDisabled();
    fireEvent.click(nextArchive);
    expect(callMock).toHaveBeenCalledTimes(1);

    // The subscription can answer before the request itself. Wait until
    // controls are usable before moving the keyboard to the next report.
    pushRows([{ ...rows[0], status: 'archived' }, rows[1]]);
    await act(async () => { finish({ id: 'f1', status: 'archived' }); });
    expect(within(next).getByRole('button', { name: 'Mark reviewed' })).toHaveFocus();
    expect(within(next).getByRole('status')).toHaveTextContent('Feedback archived.');
    expect(showToastMock).toHaveBeenCalledWith('Feedback archived.', { announce: false });
    expect(nextArchive).toBeEnabled();
  });

  it('returns focus to the filter when the final visible report is archived', async () => {
    callMock.mockResolvedValueOnce({ id: 'f1', status: 'archived' });
    render(<AdminFeedback />);
    const row = { id: 'f1', message: 'Last report', status: 'new', createdAt: new Date() };
    pushRows([row]);
    const archive = screen.getByRole('button', { name: 'Archive' });
    archive.focus();
    fireEvent.click(archive);
    await act(async () => { await Promise.resolve(); });
    pushRows([{ ...row, status: 'archived' }]);
    expect(screen.getByLabelText('Show')).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('Feedback archived.');
    expect(screen.getByText('No feedback here')).toBeInTheDocument();
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
