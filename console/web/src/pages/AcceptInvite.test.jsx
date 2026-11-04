import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { callApi } from '../api.js';
import { fakeAuth, renderPage } from '../test/renderPage.jsx';
import AcceptInvite from './AcceptInvite.jsx';

vi.mock('../api.js', () => ({ callApi: vi.fn() }));

const page = (path = '/invite/i1#token=tok123', auth = fakeAuth()) =>
  renderPage(<AcceptInvite />, { path, route: '/invite/:inviteId', auth });

describe('AcceptInvite', () => {
  it('names the signed-in address and accepts on request with the token from the link', async () => {
    callApi.mockResolvedValue({ organization: { id: 'o1', name: 'Local News Lab' }, role: 'owner' });
    page();
    expect(screen.getByRole('heading', { level: 1, name: 'Join the team' })).toBeInTheDocument();
    expect(screen.getByText(/You are signed in as ana@example\.org/)).toBeInTheDocument();
    expect(callApi).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Accept invite' }));
    expect(await screen.findByText('You joined Local News Lab as an Owner.')).toBeInTheDocument();
    expect(callApi).toHaveBeenCalledWith('acceptInvite', { inviteId: 'i1', token: 'tok123' });
    expect(screen.getByRole('link', { name: 'Go to the team' })).toHaveAttribute('href', '/organizations/o1/team');
  });

  it('explains a wrong address and offers to sign out', async () => {
    callApi.mockRejectedValue(Object.assign(
      new Error('This invite was sent to a different email address. Sign in with that address to accept it.'),
      { code: 'wrong-email' },
    ));
    const auth = fakeAuth();
    page(undefined, auth);
    fireEvent.click(screen.getByRole('button', { name: 'Accept invite' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('sent to a different email address');
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalled());
  });

  it('shows an expired invite in plain words', async () => {
    callApi.mockRejectedValue(Object.assign(new Error('This invite has expired. Ask an Owner to send a new one.'), { code: 'invite-expired' }));
    page();
    fireEvent.click(screen.getByRole('button', { name: 'Accept invite' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This invite has expired.');
  });

  it('says when the link has no token', () => {
    page('/invite/i1');
    expect(screen.getByRole('alert')).toHaveTextContent('This invite link is not complete.');
    expect(screen.queryByRole('button', { name: 'Accept invite' })).not.toBeInTheDocument();
  });
});
