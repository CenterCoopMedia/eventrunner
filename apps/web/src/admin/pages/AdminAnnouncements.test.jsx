import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let report;
vi.mock('../adminSource.js', () => ({
  subscribeAdminCollection: vi.fn((_name, onNext) => { report = onNext; return () => {}; }),
}));
const call = vi.fn();
vi.mock('../adminApi.js', () => ({ useAdminApi: () => call }));
vi.mock('../../contexts/ToastContext.jsx', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
// The email composer has its own tests and its own endpoint calls.
vi.mock('../components/AnnouncementEmailComposer.jsx', () => ({
  default: () => (
    <>
      <h2>Write your email</h2>
      <label>Email draft<input defaultValue="" /></label>
    </>
  ),
}));

import AdminAnnouncements from './AdminAnnouncements.jsx';

function renderPage() {
  return render(<MemoryRouter><AdminAnnouncements /></MemoryRouter>);
}

describe('AdminAnnouncements', () => {
  beforeEach(() => call.mockReset());
  afterEach(() => vi.useRealTimers());

  it('refreshes status at the start and end boundaries', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T13:00:00Z'));
    renderPage();
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
    renderPage();
    act(() => report([]));
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Use the east entrance.' } });
    fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '2026-10-02T09:00' } });
    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2026-10-02T11:00' } });
    fireEvent.change(screen.getByLabelText('Link (optional)'), { target: { value: 'https://example.org/details' } });
    fireEvent.change(screen.getByLabelText('Link text (optional)'), { target: { value: 'Read details' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
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
    renderPage();
    act(() => report([{
      id: 'a1', message: 'Old message', level: 'urgent',
      startsAt: new Date('2026-10-02T13:00:00Z'), endsAt: new Date('2026-10-02T15:00:00Z'),
      link: null,
    }]));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Message')).toHaveValue('Old message');
    expect(screen.getByLabelText('Priority')).toHaveValue('urgent');
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('keeps both drafts mounted while switching between site banners and email', () => {
    renderPage();
    act(() => report([]));
    const banners = screen.getByRole('tab', { name: 'Site banners' });
    const email = screen.getByRole('tab', { name: 'Email' });
    expect(banners).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('heading', { name: 'Write your email' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Use the east entrance.' } });

    fireEvent.click(email);
    expect(screen.getByRole('tabpanel', { name: 'Email' })).toBeVisible();
    expect(screen.getByLabelText('Message')).not.toBeVisible();
    fireEvent.change(screen.getByLabelText('Email draft'), { target: { value: 'Your event guide' } });
    fireEvent.click(banners);
    expect(screen.getByLabelText('Message')).toHaveValue('Use the east entrance.');
    fireEvent.click(email);
    expect(screen.getByLabelText('Email draft')).toHaveValue('Your event guide');
    expect(call).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Open email log' })).toHaveAttribute('href', '/admin/email-log');
  });

  it('supports arrow keys, Home and End with one channel tab in the tab order', () => {
    renderPage();
    const banners = screen.getByRole('tab', { name: 'Site banners' });
    const email = screen.getByRole('tab', { name: 'Email' });
    banners.focus();
    fireEvent.keyDown(banners, { key: 'ArrowRight' });
    expect(email).toHaveFocus();
    expect(email).toHaveAttribute('aria-selected', 'true');
    expect(email).toHaveAttribute('tabindex', '0');
    expect(banners).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(email, { key: 'ArrowRight' });
    expect(banners).toHaveFocus();
    fireEvent.keyDown(banners, { key: 'End' });
    expect(email).toHaveFocus();
    fireEvent.keyDown(email, { key: 'Home' });
    expect(banners).toHaveFocus();
    fireEvent.keyDown(banners, { key: 'ArrowLeft' });
    expect(email).toHaveFocus();
  });

  it('requires confirmation before deletion', async () => {
    call.mockResolvedValueOnce({ id: 'a1', deleted: true });
    renderPage();
    act(() => report([{ id: 'a1', message: 'Remove me', level: 'info' }]));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(call).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove this announcement' }));
    await act(async () => Promise.resolve());
    expect(call).toHaveBeenCalledWith('deleteAnnouncement', { id: 'a1' });
  });
});
