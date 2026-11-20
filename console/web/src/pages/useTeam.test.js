import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('../api.js', () => ({ callApi: vi.fn() }));
const { callApi } = await import('../api.js');
const { useTeam } = await import('./useTeam.js');

afterEach(() => vi.clearAllMocks());

const TEAM = { organization: { name: 'Org' }, members: [] };

describe('useTeam', () => {
  it('lets a superseded team read change nothing when it fails late', async () => {
    const reads = [];
    callApi.mockImplementation((name) => {
      if (name === 'getTeam') return new Promise((resolve, reject) => reads.push({ resolve, reject }));
      return Promise.resolve({ ok: true });
    });
    const { result } = renderHook(() => useTeam('org1'));
    // The first load hangs; two retries follow it.
    let olderRefresh;
    act(() => { olderRefresh = result.current.refresh(); });
    act(() => { result.current.refresh(); });
    await act(async () => reads[2].resolve(TEAM));
    expect(result.current.data).toEqual(TEAM);

    // A change whose follow-up read fails leaves the team stale, with a way back.
    let changed;
    act(() => { changed = result.current.change('inviteMember', { email: 'a@example.org' }, 'Invite sent.'); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => reads[3].reject(new Error('Network down.')));
    await act(async () => changed);
    expect(result.current.stale).toBe(true);
    expect(result.current.outcome.refreshError).toMatch('Network down.');

    // The older retry fails late: the stale state and its recovery stay.
    await act(async () => reads[1].reject(new Error('Timed out.')));
    await act(async () => olderRefresh);
    await act(async () => reads[0].reject(new Error('Timed out.')));
    expect(result.current.stale).toBe(true);
    expect(result.current.outcome.refreshError).toMatch('Network down.');
    expect(result.current.error).toBe('Network down.');
  });
});
