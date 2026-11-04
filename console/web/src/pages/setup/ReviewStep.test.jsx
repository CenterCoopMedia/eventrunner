import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api.js';
import { application, callsTo, serveApi } from '../../test/application.js';
import { fakeAuth } from '../../test/renderPage.jsx';
import { renderPage } from '../../test/renderPage.jsx';
import { renderSetup } from '../../test/setupPage.jsx';
import ReviewStep from './ReviewStep.jsx';

vi.mock('../../api.js', async (importOriginal) => ({ ...(await importOriginal()), callApi: vi.fn() }));

beforeEach(() => {
  serveApi();
});

describe('Review step', () => {
  it('shows a summary of every step, with a link to change each one', async () => {
    renderSetup('review');
    expect(await screen.findByRole('heading', { level: 2, name: 'Your organization' })).toBeInTheDocument();
    expect(screen.getByText('NC Local News Summit')).toBeInTheDocument();
    expect(screen.getByText('nclocal.eventrunner.org')).toBeInTheDocument();
    expect(screen.getByText('2027-05-13, 09:00 to 17:00')).toBeInTheDocument();
    expect(screen.getByText('Sell with Stripe')).toBeInTheDocument();
    expect(screen.getByText('Connected: NC Local')).toBeInTheDocument();
    expect(screen.getByText('NC Local <hello@nclocal.eventrunner.org>')).toBeInTheDocument();
    expect(screen.getByText('The team has the two Owners that launch needs.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Change your event' })).toHaveAttribute('href', '/organizations/o1/applications/a1/event');
  });

  it('Create my site sends the request and opens the status page', async () => {
    serveApi({ submitApplication: { status: 'submitted' } });
    renderSetup('review');
    fireEvent.click(await screen.findByRole('button', { name: 'Create my site' }));
    expect(await screen.findByText('Status page')).toBeInTheDocument();
    expect(callsTo('submitApplication')).toEqual([{ orgId: 'o1', appId: 'a1' }]);
  });

  it('lists what needs attention, with links to each step, and focuses the list when a send is refused', async () => {
    serveApi({
      submitApplication: () => {
        throw new ApiError(400, 'incomplete', 'Some answers need attention before you send the request.', {
          'event.days': 'Add at least one day.',
          'email.replyTo': 'Enter a valid email address.',
        });
      },
    });
    renderSetup('review');
    fireEvent.click(await screen.findByRole('button', { name: 'Create my site' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Some answers need attention');
    const title = screen.getByRole('heading', { name: 'Answers that need attention' });
    await waitFor(() => expect(title).toHaveFocus());
    const problems = within(title.closest('section'));
    expect(problems.getByRole('link', { name: 'Your event' })).toHaveAttribute('href', '/organizations/o1/applications/a1/event?check=1');
    expect(problems.getByText(/Enter a valid email address\./)).toBeInTheDocument();
  });

  it('shows the open problems before a send, including a missing second Owner', async () => {
    serveApi({
      getApplication: { application: application({ errors: { 'tickets.choice': 'Choose how you sell tickets.' }, ownersNeeded: 1 }) },
    });
    renderSetup('review');
    const title = await screen.findByRole('heading', { name: 'Answers that need attention' });
    const problems = within(title.closest('section'));
    expect(problems.getByText(/Choose how you sell tickets\./)).toBeInTheDocument();
    expect(problems.getByText(/Add a second Owner to the team\./)).toBeInTheDocument();
  });

  it('does not send the request while a change is not saved', async () => {
    const app = application();
    const flush = vi.fn(async () => false);
    renderPage(
      <ReviewStep app={app} answers={app.answers} errors={{}} ownersNeeded={0} orgId="o1" appId="a1"
        flush={flush} onSubmitted={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create my site' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not save your last change. Try again.');
    expect(callsTo('submitApplication')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Create my site' })).toBeEnabled();
  });

  it('tells an Editor that only an Owner can send the request', async () => {
    serveApi({ getApplication: { application: application({ myRole: 'editor', canSubmit: false }) } });
    renderSetup('review', { auth: fakeAuth({ user: { uid: 'ben', email: 'ben@example.org', emailVerified: true } }) });
    expect(await screen.findByText(/Only an Owner can send the request/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create my site' })).not.toBeInTheDocument();
  });
});
