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

  it('shows the first team to answer at once, even while a newer read is out', async () => {
    const reads = [];
    callApi.mockImplementation(() => new Promise((resolve) => reads.push(resolve)));
    const { result } = renderHook(() => useTeam('org1'));
    act(() => { result.current.refresh(); });
    await act(async () => reads[0](TEAM));
    expect(result.current.data).toEqual(TEAM);
    const later = { ...TEAM, members: [{ uid: 'u1' }] };
    await act(async () => reads[1](later));
    expect(result.current.data).toEqual(later);
    expect(result.current.refreshing).toBe(false);
  });

  it('ends the refresh state when a change read lands ahead of the refresh', async () => {
    const reads = [];
    callApi.mockImplementation((name) => (name === 'getTeam'
      ? new Promise((resolve) => reads.push(resolve))
      : Promise.resolve({ ok: true })));
    const { result } = renderHook(() => useTeam('org1'));
    await act(async () => reads[0](TEAM));
    let refreshed;
    act(() => { refreshed = result.current.refresh(); });
    expect(result.current.refreshing).toBe(true);
    let changed;
    act(() => { changed = result.current.change('inviteMember', { email: 'a@example.org' }, 'Invite sent.'); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => reads[2](TEAM));
    await act(async () => changed);
    // The refresh's own read answers last, after the change's read landed.
    await act(async () => reads[1](TEAM));
    await act(async () => refreshed);
    expect(result.current.refreshing).toBe(false);
  });

  it('drops an older team that answers after a newer read failed', async () => {
    const reads = [];
    callApi.mockImplementation(() => new Promise((resolve, reject) => reads.push({ resolve, reject })));
    const { result } = renderHook(() => useTeam('org1'));
    act(() => { result.current.refresh(); });
    await act(async () => reads[1].reject(new Error('Network down.')));
    expect(result.current.error).toBe('Network down.');
    await act(async () => reads[0].resolve(TEAM));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe('Network down.');
  });

  it('never shows the previous organization\'s team', async () => {
    const reads = [];
    callApi.mockImplementation((name, body) => new Promise((resolve) => reads.push({ orgId: body.orgId, resolve })));
    const { result, rerender } = renderHook(({ orgId }) => useTeam(orgId), { initialProps: { orgId: 'orgA' } });
    rerender({ orgId: 'orgB' });
    const teamB = { ...TEAM, organization: { name: 'Org B' } };
    await act(async () => reads.find((read) => read.orgId === 'orgA').resolve({ ...TEAM, organization: { name: 'Org A' } }));
    expect(result.current.data).toBeNull();
    await act(async () => reads.find((read) => read.orgId === 'orgB').resolve(teamB));
    expect(result.current.data).toEqual(teamB);
  });

  it('lets a mutation that finishes after leaving its organization leave the new one alone', async () => {
    const reads = [];
    let finishInvite;
    callApi.mockImplementation((name, body) => (name === 'getTeam'
      ? new Promise((resolve) => reads.push({ orgId: body.orgId, resolve }))
      : new Promise((resolve) => { finishInvite = resolve; })));
    const { result, rerender } = renderHook(({ orgId }) => useTeam(orgId), { initialProps: { orgId: 'orgA' } });
    const teamA = { ...TEAM, organization: { name: 'Org A' } };
    await act(async () => reads[0].resolve(teamA));
    let changed;
    act(() => { changed = result.current.change('inviteMember', { email: 'a@example.org' }, 'Invite sent.'); });
    rerender({ orgId: 'orgB' });
    await act(async () => finishInvite({ ok: true }));
    await act(async () => changed);
    // No follow-up read for A starts, and B's own read still lands.
    expect(reads.filter((read) => read.orgId === 'orgA')).toHaveLength(1);
    const teamB = { ...TEAM, organization: { name: 'Org B' } };
    await act(async () => reads.find((read) => read.orgId === 'orgB').resolve(teamB));
    expect(result.current.data).toEqual(teamB);
    expect(result.current.outcome).toBeNull();
  });
});
