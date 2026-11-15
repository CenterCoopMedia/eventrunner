import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callApi } from '../../api.js';
import { renderPage } from '../../test/renderPage.jsx';
import Deployments from './Deployments.jsx';

vi.mock('../../api.js', () => ({ callApi: vi.fn() }));
const site = (overrides = {}) => ({ id: 'a1', eventName: 'Local Summit', environment: 'nclocal', status: 'building',
  build: { state: 'running', startedAt: '2026-11-15T12:00:00Z', runUrl: 'https://github.com/owner/repo/actions/runs/42',
    steps: [{ label: 'First deploy', state: 'running' }], error: null },
  canStop: true, canRetry: false, canRedeploy: false, runs: [], health: null, ...overrides });
const data = (rows = [site()]) => ({ sites: rows, checkedAt: '2026-11-15T12:05:00Z', nextPage: 2 });
const page = () => renderPage(<Deployments />, { path: '/review/deployments', route: '/review/deployments' });
beforeEach(() => { callApi.mockResolvedValue(data()); });
afterEach(() => { vi.useRealTimers(); });

describe('Deployments', () => {
  it('shows every site with its step, elapsed time, error, health and run links', async () => {
    callApi.mockResolvedValue(data([site(), site({ id: 'a2', eventName: 'Another event', canStop: false,
      build: { state: 'failed', error: 'Certificate could not be checked' }, health: { site: { ok: true }, admin: { ok: false }, checkedAt: '2026-11-15T12:03:00Z' } })]));
    page();
    expect(await screen.findByRole('link', { name: 'Local Summit' })).toHaveAttribute('href', '/review/a1');
    expect(screen.getByText('First deploy · 5 minutes')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open build run' })).toHaveAttribute('href', 'https://github.com/owner/repo/actions/runs/42');
    expect(screen.getByText('Certificate could not be checked')).toBeInTheDocument();
    expect(screen.getByText(/Site: Answering · Admin: Needs attention/)).toBeInTheDocument();
  });

  it('requires confirmation to stop the exact displayed build and reports its result', async () => {
    callApi.mockImplementation(async (name) => name === 'stopBuild' ? { stopped: true } : data());
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Stop the build' }));
    expect(callApi).not.toHaveBeenCalledWith('stopBuild', expect.anything());
    const confirm = screen.getByRole('group', { name: 'Stop this build' });
    expect(confirm).toHaveTextContent('Resources already created stay in place');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByRole('status')).toHaveTextContent('stopped');
    expect(callApi).toHaveBeenCalledWith('stopBuild', { appId: 'a1', runId: '42', confirm: true });
  });

  it('retries failed builds and confirms a live site redeploy with its recorded environment', async () => {
    callApi.mockImplementation(async (name) => name === 'listDeployments' ? data([site({ canRetry: true, canStop: false, canRedeploy: true })]) : { started: true });
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Retry the build' }));
    await screen.findByText(/The run was requested/);
    expect(callApi).toHaveBeenCalledWith('retryBuild', { appId: 'a1' });
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Redeploy site' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Redeploy site' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Redeploy this site' })).getByRole('button', { name: 'Confirm' }));
    await vi.waitFor(() => expect(callApi).toHaveBeenCalledWith('redeploySite', { appId: 'a1', environment: 'nclocal', confirm: true }));
  });

  it('keeps earlier deploys accessible through paginated history after launch', async () => {
    callApi.mockImplementation(async (name) => name === 'deploymentHistory' ? { runs: [{ id: '8', url: 'https://github.com/owner/repo/actions/runs/8', conclusion: 'success', startedAt: '2026-11-14T12:00:00Z' }], nextPage: null } : data([site({ status: 'launched', canStop: false })]));
    page();
    fireEvent.click(await screen.findByText('Recent deploy runs'));
    fireEvent.click(screen.getByRole('button', { name: 'Check earlier runs' }));
    expect(await screen.findByRole('link', { name: 'Run 8' })).toBeInTheDocument();
    expect(callApi).toHaveBeenCalledWith('deploymentHistory', { appId: 'a1', page: 2 });
  });

  it('stops polling on unmount and skips hidden tabs at the minute boundary', async () => {
    vi.useFakeTimers();
    const mounted = page();
    await act(async () => {});
    const before = callApi.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(59_999); });
    expect(callApi).toHaveBeenCalledTimes(before);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(callApi).toHaveBeenCalledTimes(before + 1);
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(callApi).toHaveBeenCalledTimes(before + 1);
    hidden.mockRestore();
    mounted.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(callApi).toHaveBeenCalledTimes(before + 1);
  });

  it('shows hosting-only refusals and disables stale run controls after a failed refresh', async () => {
    const mounted = page();
    await screen.findByRole('link', { name: 'Local Summit' });
    callApi.mockRejectedValue(new Error('The server could not be reached.'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh deployments' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Refresh before using the run controls');
    expect(screen.getByRole('button', { name: 'Stop the build' })).toBeDisabled();
    mounted.unmount();
    callApi.mockRejectedValue(Object.assign(new Error('Hosting team only'), { code: 'not-operator' }));
    page();
    expect(await screen.findByRole('heading', { name: 'This page is for the hosting team' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop the build' })).not.toBeInTheDocument();
  });
});
