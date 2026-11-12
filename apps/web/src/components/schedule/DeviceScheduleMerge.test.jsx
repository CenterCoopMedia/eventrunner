import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import DeviceScheduleMerge from './DeviceScheduleMerge.jsx';
import { DEVICE_BOOKMARK_KEY, getDeviceBookmarks, removeDeviceBookmarks,
  setDeviceBookmarked, setDeviceMergePending } from '../../lib/deviceBookmarks.js';

const state = vi.hoisted(() => ({
  user: { uid: 'account-one' }, access: true, confirmed: true,
  features: { schedule: true, sessionBookmarks: true },
  read: vi.fn(), write: vi.fn(),
}));
vi.mock('../../contexts/AuthContext.jsx', () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock('../../contexts/ProfileContext.jsx', () => ({
  useProfile: () => ({ attendeeAccess: state.access, profileConfirmed: state.confirmed }),
}));
vi.mock('../../contexts/EventConfigContext.jsx', () => ({ useEventConfig: () => ({ features: state.features }) }));
vi.mock('../../lib/bookmarksSource.js', () => ({
  readBookmarkImportVisibility: (...args) => state.read(...args),
  setSessionBookmarked: (...args) => state.write(...args),
}));

function view() { return <MemoryRouter><DeviceScheduleMerge /></MemoryRouter>; }
function saved() { return JSON.parse(localStorage.getItem(DEVICE_BOOKMARK_KEY)); }

beforeEach(() => {
  removeDeviceBookmarks(getDeviceBookmarks().ids);
  setDeviceMergePending([]);
  state.user = { uid: 'account-one' };
  state.access = true;
  state.confirmed = true;
  state.features = { schedule: true, sessionBookmarks: true };
  state.read.mockReset().mockResolvedValue('private');
  state.write.mockReset().mockResolvedValue({ bookmarked: true, count: 1 });
});

describe('browser save import consent', () => {
  it.each(['public', 'attendees_only'])('persists %s saves without a write until the reader agrees', async (visibility) => {
    state.read.mockResolvedValue(visibility);
    setDeviceBookmarked('one', true);
    setDeviceBookmarked('two', true);
    render(view());
    const agree = await screen.findByRole('button', { name: 'Add and share these sessions' });
    expect(screen.getByRole('region', { name: 'Browser-saved sessions' })).toHaveTextContent('Adding 2 sessions');
    expect(state.write).not.toHaveBeenCalled();
    expect(saved()).toEqual(['one', 'two']);
    fireEvent.click(screen.getByRole('button', { name: 'Keep in this browser' }));
    expect(saved()).toEqual(['one', 'two']);
    expect(state.write).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Review adding to my account' }));
    await screen.findByRole('button', { name: 'Add and share these sessions' });
    // The earlier button's DOM was removed by Keep; use the reviewed choice.
    expect(agree.isConnected).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Add and share these sessions' }));
    await waitFor(() => expect(saved()).toEqual([]));
    expect(state.write.mock.calls.map(([request]) => request)).toEqual([
      { user: state.user, sessionId: 'one', bookmarked: true, expectedScheduleVisibility: visibility },
      { user: state.user, sessionId: 'two', bookmarked: true, expectedScheduleVisibility: visibility },
    ]);
  });

  it('waits for confirmed eligibility and for each private import before clearing browser saves', async () => {
    state.confirmed = false;
    setDeviceBookmarked('one', true);
    setDeviceBookmarked('two', true);
    let finish;
    state.write.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { rerender } = render(view());
    expect(state.read).not.toHaveBeenCalled();
    state.confirmed = true;
    rerender(view());
    await waitFor(() => expect(state.write).toHaveBeenCalledTimes(1));
    expect(saved()).toEqual(['one', 'two']);
    expect(getDeviceBookmarks().merging).toEqual(['one', 'two']);
    await act(async () => { finish({ bookmarked: true, count: 1 }); });
    await waitFor(() => expect(saved()).toEqual([]));
    expect(state.write).toHaveBeenCalledTimes(2);
    expect(getDeviceBookmarks().merging).toEqual([]);
  });

  it('retains failed saves, drops unavailable sessions and does not treat feature-off 404 as a missing session', async () => {
    for (const id of ['one', 'gone', 'retry']) setDeviceBookmarked(id, true);
    state.write.mockResolvedValueOnce({ bookmarked: true }).mockRejectedValueOnce({ code: 'session-unavailable', status: 404 })
      .mockRejectedValue({ code: 'not-found', status: 404, message: 'Session bookmarking is not enabled for this event.' });
    render(view());
    await waitFor(() => expect(saved()).toEqual(['retry']));
    expect(await screen.findByRole('alert')).toHaveTextContent('not enabled');
    await screen.findByRole('button', { name: 'Add to my account' });
    expect(state.write).toHaveBeenCalledTimes(3);
  });

  it('asks again if private visibility changed, retaining the browser copy until the new choice', async () => {
    setDeviceBookmarked('one', true);
    state.read.mockResolvedValueOnce('private').mockResolvedValue('public');
    state.write.mockRejectedValueOnce({ status: 409, message: 'Your schedule visibility changed.' });
    render(view());
    await screen.findByRole('button', { name: 'Add and share these sessions' });
    expect(state.write).toHaveBeenCalledTimes(1);
    expect(saved()).toEqual(['one']);
    fireEvent.click(screen.getByRole('button', { name: 'Add and share these sessions' }));
    await waitFor(() => expect(saved()).toEqual([]));
    expect(state.write.mock.calls[1][0].expectedScheduleVisibility).toBe('public');
  });

  it('keeps ineligible and feature-off device lists without reading or writing account data', () => {
    setDeviceBookmarked('one', true);
    state.access = false;
    const { rerender } = render(view());
    expect(state.read).not.toHaveBeenCalled();
    expect(state.write).not.toHaveBeenCalled();
    state.access = true;
    state.features.sessionBookmarks = false;
    rerender(view());
    expect(state.read).not.toHaveBeenCalled();
    expect(state.write).not.toHaveBeenCalled();
    expect(saved()).toEqual(['one']);
  });

  it('stops the old account’s remaining writes after identity changes', async () => {
    setDeviceBookmarked('one', true);
    setDeviceBookmarked('two', true);
    let finish;
    state.write.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { rerender } = render(view());
    await waitFor(() => expect(state.write).toHaveBeenCalledTimes(1));
    state.user = { uid: 'account-two' };
    state.confirmed = false;
    rerender(view());
    await act(async () => { finish({ bookmarked: true, count: 1 }); });
    await waitFor(() => expect(saved()).toEqual(['two']));
    expect(state.write).toHaveBeenCalledTimes(1);
    expect(getDeviceBookmarks().merging).toEqual([]);
  });
});
