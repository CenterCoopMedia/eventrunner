import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { application, callsTo, serveApi, team } from '../../test/application.js';
import { renderSetup } from '../../test/setupPage.jsx';

vi.mock('../../api.js', () => ({ callApi: vi.fn() }));

const oneOwner = team({
  ownersNeeded: 1,
  members: [{ uid: 'ana', email: 'ana@example.org', role: 'owner', joinedAt: '2026-10-01T00:00:00.000Z' }],
});

beforeEach(() => {
  serveApi({
    getApplication: { application: application({ ownersNeeded: 1 }) },
    getTeam: oneOwner,
  });
});

describe('Your team step', () => {
  it('reuses the team tools: the two-Owner note, the members and the invite form', async () => {
    renderSetup('team');
    expect(await screen.findByRole('heading', { level: 1, name: 'Your team' })).toBeInTheDocument();
    expect(await screen.findByRole('note')).toHaveTextContent('You can add 1 more Owner at any time.');
    expect(within(screen.getByRole('list', { name: 'Members' })).getByText('ana@example.org (you)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send invite' })).toBeInTheDocument();
    expect(callsTo('getTeam')[0]).toEqual({ orgId: 'o1' });
  });

  it('sends an invite from the step, and the Review count follows the team', async () => {
    let current = oneOwner;
    serveApi({
      getApplication: { application: application({ ownersNeeded: 1 }) },
      getTeam: () => current,
      inviteMember: () => {
        current = team();
        return { invite: { id: 'i2' } };
      },
    });
    renderSetup('team');
    fireEvent.change(await screen.findByLabelText('Email address'), { target: { value: 'dee@example.org' } });
    fireEvent.click(screen.getByRole('radio', { name: /Owner/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send invite' }));
    expect(await screen.findByText('We sent an invite to dee@example.org.')).toBeInTheDocument();
    expect(callsTo('inviteMember')[0]).toEqual({ orgId: 'o1', email: 'dee@example.org', role: 'owner' });
    expect(callsTo('saveApplicationStep')).toHaveLength(0);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Setup steps' })).getByRole('link', { name: /Review/ }));
    expect(await screen.findByText('The team has two Owners.')).toBeInTheDocument();
  });
});
