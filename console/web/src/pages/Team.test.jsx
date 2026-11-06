import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callApi } from '../api.js';
import { fakeAuth, renderPage } from '../test/renderPage.jsx';
import Team from './Team.jsx';

vi.mock('../api.js', () => ({ callApi: vi.fn() }));

function team(overrides = {}) {
  return {
    organization: { id: 'o1', name: 'Local News Lab' },
    myRole: 'owner',
    operator: false,
    members: [
      { uid: 'ana', email: 'ana@example.org', role: 'owner', joinedAt: '2026-10-01T00:00:00.000Z' },
      { uid: 'ben', email: 'ben@example.org', role: 'editor', joinedAt: '2026-10-02T00:00:00.000Z' },
    ],
    invites: [{ id: 'i1', email: 'dee@example.org', role: 'editor', expiresAt: '2026-11-10T12:00:00.000Z' }],
    ownersNeeded: 1,
    ...overrides,
  };
}

/** Answer getTeam with `data`, and every other call with `{}` unless a handler is given. */
function serve(data, handlers = {}) {
  callApi.mockImplementation(async (name, body) => {
    if (name === 'getTeam') return typeof data === 'function' ? data() : data;
    if (handlers[name]) return handlers[name](body);
    return {};
  });
}

const page = (auth) => renderPage(<Team />, { path: '/organizations/o1/team', route: '/organizations/:orgId/team', auth });

beforeEach(() => {
  serve(team());
});

describe('Team', () => {
  it('lists the members, Owners first, and the open invites', async () => {
    page();
    expect(await screen.findByRole('heading', { level: 1, name: 'Team' })).toBeInTheDocument();
    expect(screen.getByText('Local News Lab')).toBeInTheDocument();
    expect(callApi).toHaveBeenCalledWith('getTeam', { orgId: 'o1' });
    const members = within(screen.getByRole('list', { name: 'Members' })).getAllByRole('listitem');
    expect(members[0]).toHaveTextContent('ana@example.org (you)');
    expect(members[1]).toHaveTextContent('ben@example.org');
    const invites = within(screen.getByRole('list', { name: 'Pending invites' })).getAllByRole('listitem');
    expect(invites[0]).toHaveTextContent('dee@example.org');
    expect(invites[0]).toHaveTextContent('Link expires 10 November 2026');
  });

  it('recommends a second owner for team access', async () => {
    page();
    const note = await screen.findByRole('note');
    expect(note).toHaveTextContent('Add a second owner');
    expect(note).toHaveTextContent('Invite another owner so the team can still sign in if someone loses access to their email.');
  });

  it('says when the team has two Owners', async () => {
    serve(team({ ownersNeeded: 0 }));
    page();
    expect(await screen.findByRole('note')).toHaveTextContent('Your team has at least two owners.');
  });

  it('lets an Owner invite a teammate as an Owner', async () => {
    serve(team(), { inviteMember: () => ({ invite: { id: 'i2' } }) });
    page();
    fireEvent.change(await screen.findByLabelText('Email address'), { target: { value: 'sam@example.org' } });
    fireEvent.click(screen.getByRole('radio', { name: /Owner/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send invite' }));
    expect(await screen.findByText('We sent an invite to sam@example.org.')).toBeInTheDocument();
    expect(callApi).toHaveBeenCalledWith('inviteMember', { orgId: 'o1', email: 'sam@example.org', role: 'owner' });
    expect(callApi.mock.calls.filter(([name]) => name === 'getTeam')).toHaveLength(2);
  });

  it('checks the invite address on submit and focuses the field', async () => {
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Send invite' }));
    const field = screen.getByLabelText('Email address');
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveFocus();
    expect(callApi).not.toHaveBeenCalledWith('inviteMember', expect.anything());
  });

  it('shows an invite refusal from the server', async () => {
    serve(team(), { inviteMember: () => { throw new Error('That person is already on the team.'); } });
    page();
    fireEvent.change(await screen.findByLabelText('Email address'), { target: { value: 'ben@example.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send invite' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That person is already on the team.');
  });

  it('lets an Owner change a role', async () => {
    serve(team(), { changeMemberRole: () => ({ uid: 'ben', role: 'owner' }) });
    page();
    fireEvent.change(await screen.findByLabelText('Role for ben@example.org'), { target: { value: 'owner' } });
    expect(await screen.findByText('ben@example.org is now an Owner.')).toBeInTheDocument();
    expect(callApi).toHaveBeenCalledWith('changeMemberRole', { orgId: 'o1', uid: 'ben', role: 'owner' });
  });

  it('asks before it removes a member, and Cancel keeps them', async () => {
    serve(team(), { removeMember: () => ({ removed: true }) });
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove ben@example.org' }));
    expect(screen.getByText('Remove ben@example.org from the team?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(callApi).not.toHaveBeenCalledWith('removeMember', expect.anything());
    expect(screen.getByRole('button', { name: 'Remove ben@example.org' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Remove ben@example.org' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('ben@example.org was removed from the team.')).toBeInTheDocument();
    expect(callApi).toHaveBeenCalledWith('removeMember', { orgId: 'o1', uid: 'ben' });
  });

  it('keeps the only owner visible without controls that cannot be used', async () => {
    page();
    expect(await screen.findByText('Add another owner to change this role or remove this member.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Role for ana@example.org')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove ana@example.org' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Role for ben@example.org')).toBeInTheDocument();
    expect(callApi).not.toHaveBeenCalledWith('changeMemberRole', expect.anything());
  });

  it('gives an Editor the list only', async () => {
    serve(team({ myRole: 'editor' }));
    page(fakeAuth({ user: { uid: 'ben', email: 'ben@example.org', emailVerified: true } }));
    expect(await screen.findByText('Only an Owner can invite people or change roles.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send invite' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Role for/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
  });

  it('gives the hosting team a read-only view', async () => {
    serve(team({ myRole: null, operator: true }));
    page(fakeAuth({ user: { uid: 'ops', email: 'ops@ccm.example', emailVerified: true } }));
    expect(await screen.findByText(/You are on the hosting team/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send invite' })).not.toBeInTheDocument();
  });

  it('shows a load error with an action to try again', async () => {
    callApi.mockRejectedValue(new Error('We could not find that organization.'));
    page();
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not find that organization.');
    serve(team());
    fireEvent.click(screen.getByRole('button', { name: 'Refresh team' }));
    expect(await screen.findByText('Local News Lab')).toBeInTheDocument();
  });

  it('keeps the invite role choice keyboard reachable as one radio group', async () => {
    page();
    const group = await screen.findByRole('group', { name: 'Role' });
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(radios.find((r) => r.checked)).toHaveAccessibleName(/Editor/);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send invite' })).toBeEnabled());
  });
});
