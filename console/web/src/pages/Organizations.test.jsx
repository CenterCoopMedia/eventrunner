import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { callApi } from '../api.js';
import { renderPage } from '../test/renderPage.jsx';
import Organizations from './Organizations.jsx';

vi.mock('../api.js', () => ({ callApi: vi.fn() }));

describe('Organizations', () => {
  it('lists my organizations with my role and a link to each organization', async () => {
    callApi.mockResolvedValue({
      operator: false,
      organizations: [{ id: 'o1', name: 'Local News Lab', role: 'owner' }, { id: 'o2', name: 'Media Hub', role: 'editor' }],
    });
    renderPage(<Organizations />);
    expect(await screen.findByRole('link', { name: 'Local News Lab' })).toHaveAttribute('href', '/organizations/o1');
    expect(screen.getByText('Owner')).toBeInTheDocument();
    expect(screen.getByText('Editor')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add another organization' })).toHaveAttribute('href', '/organizations/new');
    expect(callApi).toHaveBeenCalledWith('listOrganizations', {});
    expect(screen.queryByRole('heading', { name: 'All organizations' })).not.toBeInTheDocument();
  });

  it('sends a reader with no organization to the create page', async () => {
    callApi.mockResolvedValue({ operator: false, organizations: [] });
    renderPage(<Organizations />, { routes: { '/organizations/new': 'Create page' } });
    expect(await screen.findByText('Create page')).toBeInTheDocument();
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
    expect(screen.getByText(/You are on the hosting team/)).toBeInTheDocument();
  });

  it('shows the server message when the list cannot load', async () => {
    callApi.mockRejectedValue(new Error('We could not reach the server. Check your connection and try again.'));
    renderPage(<Organizations />);
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not reach the server.');
  });
});
