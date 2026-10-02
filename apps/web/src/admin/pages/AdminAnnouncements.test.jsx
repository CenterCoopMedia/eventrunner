import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let report;
vi.mock('../adminSource.js', () => ({
  subscribeAdminCollection: vi.fn((_name, onNext) => { report = onNext; return () => {}; }),
}));
const call = vi.fn();
vi.mock('../adminApi.js', () => ({ useAdminApi: () => call }));
vi.mock('../../contexts/ToastContext.jsx', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

import AdminAnnouncements from './AdminAnnouncements.jsx';

describe('AdminAnnouncements', () => {
  beforeEach(() => call.mockReset());
  afterEach(() => vi.useRealTimers());

  it('refreshes status at the start and end boundaries', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T13:00:00Z'));
    render(<AdminAnnouncements />);
    act(() => report([{
      id: 'a1', message: 'Doors are open.', level: 'info',
      startsAt: new Date('2026-10-02T13:00:01Z'), endsAt: new Date('2026-10-02T13:00:02Z'),
      link: null,
    }]));

    expect(screen.getByText('Scheduled')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByText('Active')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByText('Ended')).toBeInTheDocument();
  });

  it('creates a bounded announcement through the admin endpoint', async () => {
    call.mockResolvedValueOnce({ id: 'a1' });
    render(<AdminAnnouncements />);
    act(() => report([]));
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Use the east entrance.' } });
    fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '2026-10-02T09:00' } });
    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2026-10-02T11:00' } });
    fireEvent.change(screen.getByLabelText('Link URL (optional)'), { target: { value: 'https://example.org/details' } });
    fireEvent.change(screen.getByLabelText('Link label (optional)'), { target: { value: 'Read details' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create announcement' }));
    await act(async () => Promise.resolve());
    expect(call).toHaveBeenCalledWith('saveAnnouncement', {
      announcement: {
        message: 'Use the east entrance.',
        level: 'info',
        startsAt: new Date('2026-10-02T09:00').toISOString(),
        endsAt: new Date('2026-10-02T11:00').toISOString(),
        link: { url: 'https://example.org/details', label: 'Read details' },
      },
    });
  });

  it('loads an existing row for editing', () => {
    render(<AdminAnnouncements />);
    act(() => report([{
      id: 'a1', message: 'Old message', level: 'urgent',
      startsAt: new Date('2026-10-02T13:00:00Z'), endsAt: new Date('2026-10-02T15:00:00Z'),
      link: null,
    }]));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Message')).toHaveValue('Old message');
    expect(screen.getByLabelText('Level')).toHaveValue('urgent');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
  });

  it('requires confirmation before deletion', async () => {
    call.mockResolvedValueOnce({ id: 'a1', deleted: true });
    render(<AdminAnnouncements />);
    act(() => report([{ id: 'a1', message: 'Remove me', level: 'info' }]));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(call).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove this announcement' }));
    await act(async () => Promise.resolve());
    expect(call).toHaveBeenCalledWith('deleteAnnouncement', { id: 'a1' });
  });
});
