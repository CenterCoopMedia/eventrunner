import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { callApi } from '../api.js';
import { renderPage } from '../test/renderPage.jsx';
import Organizations from './Organizations.jsx';

vi.mock('../api.js', () => ({ callApi: vi.fn() }));

describe('Organizations', () => {
  it('keeps a readable status while the organization directory loads', () => {
    callApi.mockReturnValue(new Promise(() => {}));
    renderPage(<Organizations />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading your organizations.');
  });

  it('lists my organizations with my role and a link to each organization', async () => {
    callApi.mockResolvedValue({
      operator: false,
      organizations: [{ id: 'o1', name: 'Local News Lab', role: 'owner' }, { id: 'o2', name: 'Media Hub', role: 'editor' }],
    });
    renderPage(<Organizations />);
    expect(await screen.findByRole('link', { name: 'Local News Lab' })).toHaveAttribute('href', '/organizations/o1');
    expect(screen.getByText('Owner')).toBeInTheDocument();
    expect(screen.getByText('Editor')).toBeInTheDocument();
    expect(callApi).toHaveBeenCalledWith('listOrganizations', {});
    expect(screen.queryByRole('heading', { name: 'All organizations' })).not.toBeInTheDocument();
  });

  it('tells a reader with no organization how to start, and offers no way to make one', async () => {
    callApi.mockResolvedValue({ operator: false, organizations: [] });
    renderPage(<Organizations />);
    expect(await screen.findByText(/Open an invite email to join your team, or use a signup link to start an event site\./)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /organization/i })).not.toBeInTheDocument();
  });

  it('shows the hosting team every organization', async () => {
    callApi.mockResolvedValue({
      operator: true,
      organizations: [],
      allOrganizations: [{ id: 'o9', name: 'Far Away Org', createdAt: '2026-10-05T00:00:00.000Z' }],
    });
    renderPage(<Organizations />);
    expect(await screen.findByRole('heading', { name: 'All organizations' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Far Away Org' })).toHaveAttribute('href', '/organizations/o9');
    expect(screen.getByRole('link', { name: 'Review requests' })).toHaveAttribute('href', '/review');
    expect(screen.queryByText(/Open your signup link/)).not.toBeInTheDocument();
  });

  it('keeps membership and hosting directory links distinct when an organization appears in both', async () => {
    const org = { id: 'same-org', name: 'Community Newsroom', role: 'owner', createdAt: '2026-10-05T12:00:00.000Z' };
    callApi.mockResolvedValue({ operator: true, organizations: [org], allOrganizations: [org] });
    renderPage(<Organizations />);
    const mine = await screen.findByRole('list', { name: 'Your organizations' });
    const all = screen.getByRole('list', { name: 'All organizations' });
    expect(within(mine).getByRole('link', { name: org.name })).toHaveAccessibleDescription('Owner');
    expect(within(all).getByRole('link', { name: org.name })).toHaveAccessibleDescription('Created 5 October 2026');
    expect(within(all).getByRole('link', { name: org.name })).toHaveAttribute('href', '/organizations/same-org');
  });

  it('shows the server message when the list cannot load', async () => {
    callApi.mockRejectedValue(new Error('We could not reach the server. Check your connection and try again.'));
    renderPage(<Organizations />);
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not reach the server.');
  });
});
