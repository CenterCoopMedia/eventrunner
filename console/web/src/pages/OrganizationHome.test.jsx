import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callApi } from '../api.js';
import { serveApi, team } from '../test/application.js';
import { renderPage } from '../test/renderPage.jsx';
import OrganizationHome from './OrganizationHome.jsx';

vi.mock('../api.js', () => ({ callApi: vi.fn() }));

function list(overrides = {}) {
  return {
    applications: [
      { id: 'a1', status: 'approved', eventName: 'NC Local News Summit', address: 'nclocal.eventrunner.org' },
      { id: 'a2', status: 'draft', eventName: '', address: null },
    ],
    myRole: 'owner',
    operator: false,
    ...overrides,
  };
}

const page = () => renderPage(<OrganizationHome />, { path: '/organizations/o1', route: '/organizations/:orgId' });

beforeEach(() => {
  serveApi({ listApplications: list(), getTeam: team() });
});

describe('OrganizationHome', () => {
  it('lists the event sites with their status, and links to the team', async () => {
    page();
    expect(await screen.findByRole('heading', { level: 1, name: 'NC Local' })).toBeInTheDocument();
    const items = within(screen.getByRole('list', { name: 'Event sites' })).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('We are building your site');
    expect(items[0]).not.toHaveTextContent('nclocal.eventrunner.org');
    expect(within(items[0]).getByRole('link', { name: 'NC Local News Summit' })).toHaveAttribute('href', '/organizations/o1/applications/a1');
    expect(within(items[1]).getByRole('link', { name: 'New event site' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Team' })).toHaveAttribute('href', '/organizations/o1/team');
    expect(callApi).toHaveBeenCalledWith('listApplications', { orgId: 'o1' });
  });

  it('says how a new event site starts, and offers no way to start one here', async () => {
    serveApi({ listApplications: list({ applications: [] }), getTeam: team() });
    page();
    expect(await screen.findByText(/Open your signup link to start an event site/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh event sites' })).toBeInTheDocument();
  });
});
