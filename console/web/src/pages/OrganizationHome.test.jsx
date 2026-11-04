import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callApi } from '../api.js';
import { callsTo, serveApi, team } from '../test/application.js';
import { renderPage } from '../test/renderPage.jsx';
import OrganizationHome from './OrganizationHome.jsx';

vi.mock('../api.js', () => ({ callApi: vi.fn() }));

function list(overrides = {}) {
  return {
    applications: [
      { id: 'a1', status: 'submitted', eventName: 'NC Local News Summit', address: 'nclocal.eventrunner.org' },
      { id: 'a2', status: 'draft', eventName: '', address: null },
    ],
    myRole: 'owner',
    operator: false,
    canCreate: true,
    ...overrides,
  };
}

const page = () => renderPage(<OrganizationHome />, {
  path: '/organizations/o1',
  route: '/organizations/:orgId',
  routes: { '/organizations/:orgId/applications/:appId/:step': 'Setup page' },
});

beforeEach(() => {
  serveApi({ listApplications: list(), getTeam: team() });
});

describe('OrganizationHome', () => {
  it('lists the event sites with their status, and links to the team', async () => {
    page();
    expect(await screen.findByRole('heading', { level: 1, name: 'NC Local' })).toBeInTheDocument();
    const items = within(screen.getByRole('list', { name: 'Event sites' })).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('We are reviewing your request');
    expect(items[0]).toHaveTextContent('nclocal.eventrunner.org');
    expect(within(items[0]).getByRole('link', { name: 'NC Local News Summit' })).toHaveAttribute('href', '/organizations/o1/applications/a1');
    expect(within(items[1]).getByRole('link', { name: 'New event site' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Team' })).toHaveAttribute('href', '/organizations/o1/team');
    expect(callApi).toHaveBeenCalledWith('listApplications', { orgId: 'o1' });
  });

  it('an Owner starts a new event site, with the browser time zone, and lands on the first step', async () => {
    serveApi({ listApplications: list(), getTeam: team(), createApplication: { application: { id: 'a3', orgId: 'o1', status: 'draft' } } });
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Set up a new event site' }));
    expect(await screen.findByText('Setup page')).toBeInTheDocument();
    const [body] = callsTo('createApplication');
    expect(body.orgId).toBe('o1');
    expect(typeof body.timezone).toBe('string');
  });

  it('shows a refusal to start, for example too many open requests', async () => {
    serveApi({
      listApplications: list(),
      getTeam: team(),
      createApplication: () => { throw new Error('An organization can have 3 open requests. Finish or withdraw one first.'); },
    });
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Set up a new event site' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('An organization can have 3 open requests.');
  });

  it('an Editor sees the sites but cannot start one', async () => {
    serveApi({ listApplications: list({ myRole: 'editor', canCreate: false }), getTeam: team() });
    page();
    expect(await screen.findByText('Only an Owner can set up a new event site.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set up a new event site' })).not.toBeInTheDocument();
  });

  it('says when there are no event sites yet, and when the open limit is reached', async () => {
    serveApi({ listApplications: list({ applications: [], canCreate: false }), getTeam: team() });
    page();
    expect(await screen.findByText(/No event sites yet/)).toBeInTheDocument();
    expect(screen.getByText(/An organization can have 3 open requests/)).toBeInTheDocument();
  });
});
