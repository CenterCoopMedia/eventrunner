import { act, fireEvent, screen, within } from '@testing-library/react';
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

  it('does not offer deletion to an Owner', async () => {
    page();
    await screen.findByRole('heading', { level: 1, name: 'NC Local' });
    expect(screen.queryByRole('button', { name: 'Delete organization' })).not.toBeInTheDocument();
  });

  it('names the organization and the irreversible delete, and Cancel keeps it', async () => {
    serveApi({ listApplications: list({ operator: true, myRole: null }), getTeam: team() });
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete organization' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete NC Local?' });
    expect(dialog).toHaveAccessibleDescription(/NC Local.*Deletion cannot be undone/);
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(callApi.mock.calls.filter(([name]) => name === 'deleteOrganization')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Delete organization' })).toHaveFocus();
  });

  it('sends one confirmed delete and returns to the directory after success', async () => {
    let complete;
    serveApi({ listApplications: list({ operator: true }), getTeam: team(), deleteOrganization: () => new Promise((resolve) => { complete = resolve; }) });
    renderPage(<OrganizationHome />, { path: '/organizations/o1', route: '/organizations/:orgId', routes: { '/': 'Organization directory' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Delete organization' }));
    const confirm = screen.getByRole('button', { name: 'Delete this organization' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(screen.getByRole('button', { name: 'Deleting…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(callApi.mock.calls.filter(([name]) => name === 'deleteOrganization')).toEqual([['deleteOrganization', { orgId: 'o1', confirm: true }]]);
    await act(async () => complete({ deleted: true, orgId: 'o1' }));
    expect(await screen.findByText('Organization directory')).toBeInTheDocument();
  });

  it('keeps a server refusal in the confirmation and permits a retry', async () => {
    const remove = vi.fn().mockRejectedValueOnce(new Error('This organization was approved. Archive the site instead.')).mockResolvedValue({ deleted: true });
    serveApi({ listApplications: list({ operator: true }), getTeam: team(), deleteOrganization: remove });
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete organization' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete this organization' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Archive the site instead.');
    expect(screen.getByRole('dialog', { name: 'Delete NC Local?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete this organization' })).toBeEnabled();
  });
});
