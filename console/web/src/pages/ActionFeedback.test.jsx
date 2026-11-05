import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api.js';
import { AppRoutes } from '../App.jsx';
import { callsTo, fullAnswers, serveApi, team } from '../test/application.js';
import { fakeAuth, renderPage } from '../test/renderPage.jsx';
import { renderSetup } from '../test/setupPage.jsx';
import Team from './Team.jsx';
import AgreementSettings from './review/AgreementSettings.jsx';
import ReviewApplication from './review/ReviewApplication.jsx';
import SignupLinks from './review/SignupLinks.jsx';

vi.mock('../api.js', async (original) => ({ ...(await original()), callApi: vi.fn() }));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const AGREEMENT = { version: 2, title: 'Hosting agreement', body: 'The complete agreement text.', savedAt: '2026-11-01T12:00:00.000Z' };
const TEAM_PATH = { path: '/organizations/o1/team', route: '/organizations/:orgId/team' };
const LINK = { id: 'l1', organizationName: 'Community newsroom', status: 'open', createdAt: '2026-11-01T12:00:00.000Z', expiresAt: '2026-12-01T12:00:00.000Z' };
const reviewData = (status = 'draft') => ({
  application: { id: 'a1', status, answers: fullAnswers(), revision: 2, history: [], review: null },
  organization: { name: 'Community newsroom' }, team: { members: [], invites: [] }, connection: { label: 'Not connected yet' },
});
const reviewPage = () => renderPage(<ReviewApplication />, { path: '/review/a1', route: '/review/:appId' });

beforeEach(() => serveApi());

describe('Console action feedback and recovery', () => {
  it('waits for Leave to save, retains a failed change, and leaves only after a successful retry', async () => {
    const save = deferred();
    let attempt = 0;
    serveApi({ saveApplicationStep: (body) => ++attempt === 1 ? save.promise : { ...body, saved: true, errors: {} } });
    renderSetup('organization');
    const website = await screen.findByLabelText('Website (optional)');
    fireEvent.change(website, { target: { value: 'https://edited.example.test' } });
    fireEvent.click(screen.getByRole('link', { name: 'Leave the setup' }));
    expect(website).toBeDisabled();
    expect(screen.queryByText('Status page')).not.toBeInTheDocument();
    await act(async () => save.reject(new Error('Connection interrupted. Try again.')));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not saved. Connection interrupted.');
    expect(website).toHaveValue('https://edited.example.test');
    expect(screen.getByLabelText('Save and continue')).toHaveFocus();
    fireEvent.click(screen.getByRole('link', { name: 'Leave the setup' }));
    expect(await screen.findByText('Status page')).toBeInTheDocument();
    expect(callsTo('saveApplicationStep').map((body) => body.answers.website)).toEqual(['https://edited.example.test', 'https://edited.example.test']);
  });

  it('focuses a server-invalid signer field after enabling the form again', async () => {
    serveApi({ getAgreement: { agreement: AGREEMENT }, acceptAgreement: () => {
      throw new ApiError(400, 'legalName-required', 'Enter the legal name.', {}, 'legalName');
    } });
    renderSetup('agreement');
    fireEvent.click(await screen.findByRole('button', { name: 'Accept the agreement' }));
    await screen.findByText('Enter the legal name.');
    expect(screen.getByLabelText("Your organization's legal name")).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Accept the agreement' })).toBeEnabled();
  });

  it('keeps a changed-agreement error with Accept and gives an explicit way to review the new text', async () => {
    serveApi({ getAgreement: { agreement: AGREEMENT }, acceptAgreement: () => {
      throw new ApiError(409, 'agreement-changed', 'Read the updated agreement before accepting.');
    } });
    renderSetup('agreement');
    const name = await screen.findByLabelText('Your full name');
    fireEvent.change(name, { target: { value: 'Alex Organizer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Accept the agreement' }));
    const error = await screen.findByRole('alert');
    expect(error.closest('form')).toContainElement(screen.getByRole('button', { name: 'Accept the agreement' }));
    expect(name).toHaveValue('Alex Organizer');
    fireEvent.click(within(error).getByRole('button', { name: 'Read the updated agreement' }));
    expect(screen.getByRole('heading', { name: 'Hosting agreement' })).toHaveFocus();
  });

  it('locks submitted agreement fields until the response and clears saved status on the next edit', async () => {
    const save = deferred();
    serveApi({ saveAgreement: () => save.promise });
    const onSaved = vi.fn();
    renderPage(<AgreementSettings agreement={AGREEMENT} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Updated agreement.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save as a new version' }));
    expect(screen.getByLabelText('Title')).toBeDisabled();
    expect(screen.getByLabelText('Text')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Saving agreement…' })).toBeDisabled();
    await act(async () => save.resolve({ created: true, agreement: { ...AGREEMENT, body: 'Updated agreement.', version: 3 } }));
    expect(await screen.findByRole('status')).toHaveTextContent('Version 3 is saved.');
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'A later draft.' } });
    expect(screen.queryByText(/Version 3 is saved/)).not.toBeInTheDocument();
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ body: 'Updated agreement.', version: 3 }));
  });

  it('retains a failed member removal in its row and blocks conflicting actions while pending', async () => {
    const remove = deferred();
    serveApi({ removeMember: () => remove.promise });
    renderPage(<Team />, TEAM_PATH);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove dee@example.org' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove' }));
    expect(screen.getByRole('button', { name: 'Removing…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByLabelText('Role for ana@example.org')).toBeDisabled();
    await act(async () => remove.reject(new Error('The team changed. Check this member.')));
    const confirmation = screen.getByRole('group', { name: 'Remove dee@example.org' });
    expect(confirmation).toBeInTheDocument();
    expect(within(confirmation.closest('li')).getByRole('alert')).toHaveTextContent('The team changed.');
    expect(screen.getByRole('button', { name: 'Yes, remove' })).toBeEnabled();
    expect(callsTo('removeMember')).toHaveLength(1);
  });

  it('retains and focuses a removed member result where their row was', async () => {
    let removed = false;
    serveApi({ getTeam: () => team({ members: team().members.filter((member) => !removed || member.uid !== 'dee') }),
      removeMember: () => { removed = true; return { removed: true }; } });
    renderPage(<Team />, TEAM_PATH);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove dee@example.org' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove' }));
    const result = (await screen.findByText('dee@example.org was removed from the team.')).closest('[role="status"]');
    await waitFor(() => expect(result).toHaveFocus());
    expect(result.closest('li')).toBeInTheDocument();
    expect(screen.queryByLabelText('Role for dee@example.org')).not.toBeInTheDocument();
  });

  it('recovers the team read without sending a successful invitation twice', async () => {
    let reads = 0;
    serveApi({ getTeam: () => {
      reads += 1;
      if (reads === 2) throw new Error('Team refresh unavailable.');
      return team();
    }, inviteMember: {} });
    renderPage(<Team />, TEAM_PATH);
    fireEvent.change(await screen.findByLabelText('Email address'), { target: { value: 'new@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send invite' }));
    expect(await screen.findByText('We sent an invite to new@example.test.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send invite' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh team' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send invite' })).toBeEnabled());
    expect(callsTo('inviteMember')).toHaveLength(1);
    expect(reads).toBe(3);
  });

  it('recovers a saved hosting decision after a failed read without repeating the decision', async () => {
    let reads = 0;
    let decided = false;
    serveApi({ getApplicationForReview: () => {
      reads += 1;
      if (reads === 2) throw new Error('Request refresh unavailable.');
      return reviewData(decided ? 'declined' : 'draft');
    }, declineApplication: () => { decided = true; return { emailed: 2 }; } });
    reviewPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    fireEvent.change(screen.getByLabelText('Note to the client'), { target: { value: 'This request is a duplicate.' } });
    fireEvent.click(within(screen.getByRole('form')).getByRole('button', { name: 'Decline' }));
    expect(await screen.findByText(/The decision is saved, but we could not refresh/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Note to the client')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh request' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Refresh request' })).not.toBeInTheDocument());
    expect(screen.getByText('Declined', { selector: '.tag' })).toBeInTheDocument();
    expect(callsTo('declineApplication')).toHaveLength(1);
    expect(reads).toBe(3);
  });

  it('keeps a failed destructive hosting confirmation and error together', async () => {
    const remove = deferred();
    serveApi({ getApplicationForReview: reviewData(), deleteSpamApplication: () => remove.promise });
    reviewPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete as spam' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeDisabled();
    await act(async () => remove.reject(new Error('The request could not be deleted.')));
    expect(await screen.findByRole('alert')).toHaveTextContent('The request could not be deleted.');
    expect(screen.getByRole('group', { name: 'Delete as spam' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yes, delete' })).toBeEnabled();
  });

  it('keeps a failed link revocation beside the link and leaves its confirmation open', async () => {
    const revoke = deferred();
    serveApi({ listSignupLinks: { links: [LINK] }, revokeSignupLink: () => revoke.promise });
    renderPage(<SignupLinks />);
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, revoke' }));
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await act(async () => revoke.reject(new Error('This link could not be revoked.')));
    expect(await screen.findByRole('alert')).toHaveTextContent('This link could not be revoked.');
    expect(screen.getByRole('group', { name: 'Revoke the link for Community newsroom' })).toBeInTheDocument();
    expect(screen.getByRole('alert').closest('li')).toHaveAccessibleName('Community newsroom');
  });

  it('does not offer a completed revoke again when the list refresh fails', async () => {
    let reads = 0;
    serveApi({ listSignupLinks: () => {
      if (++reads === 2) throw new Error('List refresh unavailable.');
      return { links: [{ ...LINK, status: reads > 2 ? 'revoked' : 'open' }] };
    }, revokeSignupLink: {} });
    renderPage(<SignupLinks />);
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, revoke' }));
    expect(await screen.findByText(/The link is revoked, but/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh links' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Refresh links' })).not.toBeInTheDocument());
    expect(callsTo('revokeSignupLink')).toHaveLength(1);
  });

  it('retains a failed account disconnect confirmation and leaves the account connected', async () => {
    const disconnect = deferred();
    serveApi({ disconnectAccount: () => disconnect.promise });
    renderSetup('tickets');
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, disconnect' }));
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await act(async () => disconnect.reject(new Error('Account access could not be removed.')));
    expect(await screen.findByRole('alert')).toHaveTextContent('Account access could not be removed.');
    expect(screen.getByRole('group', { name: 'Disconnect your Stripe account' })).toBeInTheDocument();
    expect(screen.getByText('Connected: NC Local')).toBeInTheDocument();
  });

  it('focuses main while a destination heading is loading and does not steal focus later', async () => {
    const destination = deferred();
    serveApi({ listOrganizations: { operator: false, organizations: [{ id: 'o1', name: 'Newsroom', role: 'owner' }] },
      listApplications: { applications: [] }, getTeam: () => destination.promise });
    renderPage(<AppRoutes />);
    fireEvent.click(await screen.findByRole('link', { name: 'Newsroom' }));
    expect(screen.getByRole('main')).toHaveFocus();
    await act(async () => destination.resolve(team()));
    expect(await screen.findByRole('heading', { name: 'NC Local' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('blocks another confirm-email request while a link is being sent', async () => {
    const send = deferred();
    const auth = fakeAuth({ user: { uid: 'owner', email: 'owner@example.test', emailVerified: false }, sendEmailLink: vi.fn(() => send.promise) });
    renderPage(<AppRoutes />, { auth });
    fireEvent.click(screen.getByRole('button', { name: 'Email me a link' }));
    const sending = screen.getByRole('button', { name: 'Sending link…' });
    expect(sending).toBeDisabled();
    fireEvent.click(sending);
    expect(auth.sendEmailLink).toHaveBeenCalledTimes(1);
    await act(async () => send.resolve());
    expect(await screen.findByRole('status')).toHaveTextContent('We sent a sign-in link');
  });
});
