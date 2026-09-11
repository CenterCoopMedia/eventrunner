import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  grant: vi.fn(), sync: vi.fn(), read: vi.fn(), save: vi.fn(), clear: vi.fn(), user: { uid: 'u1' },
}));
vi.mock('../../contexts/AuthContext.jsx', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('../../lib/calendarSync.js', () => ({
  CalendarScopeRefusedError: class extends Error {},
  requestCalendarAccess: mocks.grant, syncBookmarksToCalendar: mocks.sync,
  readCalendarId: mocks.read, saveCalendarId: mocks.save, clearCalendarId: mocks.clear,
}));
import CalendarSyncCard from './CalendarSyncCard.jsx';
const eventConfig = { days: [], timezone: 'UTC' };
const result = { calendarId: 'c1', created: 0, updated: 1, deleted: 0, failed: 0 };
const session = { id: 's1', title: 'First title' };
beforeEach(() => {
  mocks.user = { uid: 'u1' };
  mocks.grant.mockReset().mockResolvedValue('token');
  mocks.sync.mockReset().mockResolvedValue(result);
  mocks.read.mockReset().mockReturnValue('c1');
  mocks.save.mockReset();
  mocks.clear.mockReset();
});
it('updates content changes and deletes the final removed bookmark without concurrent passes', async () => {
  let finish;
  mocks.sync.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const { rerender } = render(<CalendarSyncCard sessions={[session]} eventConfig={eventConfig} />);
  fireEvent.click(screen.getByRole('button', { name: /sync my sessions/i }));
  await waitFor(() => expect(mocks.sync).toHaveBeenCalledTimes(1));
  const updated = { ...session, title: 'New title' };
  rerender(<CalendarSyncCard sessions={[updated]} eventConfig={eventConfig} />);
  expect(mocks.sync).toHaveBeenCalledTimes(1);
  await act(async () => finish(result));
  await waitFor(() => expect(mocks.sync).toHaveBeenCalledTimes(2));
  expect(mocks.sync.mock.calls[1][0].sessions).toEqual([updated]);
  rerender(<CalendarSyncCard sessions={[]} eventConfig={eventConfig} />);
  await waitFor(() => expect(mocks.sync).toHaveBeenCalledTimes(3));
  expect(mocks.sync.mock.calls[2][0].sessions).toEqual([]);
});
it('uses the remembered calendar and reports partial failures accurately', async () => {
  mocks.sync.mockResolvedValue({ ...result, failed: 1 });
  render(<CalendarSyncCard sessions={[session]} eventConfig={eventConfig} />);
  fireEvent.click(screen.getByRole('button', { name: /sync my sessions/i }));
  await screen.findByText(/Some events could not be updated/);
  expect(screen.queryByText(/Your calendar is up to date/)).not.toBeInTheDocument();
  expect(mocks.sync.mock.calls[0][0].previous.calendarId).toBe('c1');
});
it('requests a fresh token after expiry', async () => {
  mocks.sync.mockRejectedValueOnce(Object.assign(new Error('expired'), { status: 401 }));
  render(<CalendarSyncCard sessions={[session]} eventConfig={eventConfig} />);
  fireEvent.click(screen.getByRole('button', { name: /sync my sessions/i }));
  await screen.findByText(/could not be updated just now/);
  fireEvent.click(screen.getByRole('button', { name: /sync my sessions/i }));
  await screen.findByText(/Your calendar is up to date/);
  expect(mocks.grant).toHaveBeenCalledTimes(2);
});
it('clears a missing remembered calendar before the next user retry', async () => {
  mocks.sync.mockImplementationOnce(async (options) => {
    options.onCalendarMissing('c1');
    throw Object.assign(new Error('create failed'), { status: 503 });
  });
  render(<CalendarSyncCard sessions={[session]} eventConfig={eventConfig} />);

  fireEvent.click(screen.getByRole('button', { name: /sync my sessions/i }));
  await screen.findByText(/could not be updated just now/);
  expect(mocks.clear).toHaveBeenCalledWith(mocks.user);

  mocks.sync.mockImplementationOnce(async (options) => {
    expect(options.previous.calendarId).toBeNull();
    options.onCalendarCreated('replacement');
    return { ...result, calendarId: 'replacement' };
  });
  fireEvent.click(screen.getByRole('button', { name: /sync my sessions/i }));
  await screen.findByText(/Your calendar is up to date/);
  expect(mocks.save).toHaveBeenCalledWith(mocks.user, 'replacement');
});
it('aborts pending requests and clears grant ownership when the account changes', async () => {
  let finish;
  mocks.sync.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const { rerender } = render(<CalendarSyncCard key="u1" sessions={[session]} eventConfig={eventConfig} />);
  fireEvent.click(screen.getByRole('button', { name: /sync my sessions/i }));
  await waitFor(() => expect(mocks.sync).toHaveBeenCalledTimes(1));
  const signal = mocks.sync.mock.calls[0][0].signal;
  mocks.user = { uid: 'u2' };
  rerender(<CalendarSyncCard key="u2" sessions={[session]} eventConfig={eventConfig} />);
  expect(signal.aborted).toBe(true);
  await act(async () => finish(result));
  expect(screen.queryByText(/Your calendar is up to date/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /sync my sessions/i }));
  await screen.findByText(/Your calendar is up to date/);
  expect(mocks.grant).toHaveBeenLastCalledWith(mocks.user);
});
