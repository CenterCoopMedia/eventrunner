import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { application, serveApi } from '../../test/application.js';
import { renderSetup } from '../../test/setupPage.jsx';

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
    expect(screen.getByText('Thursday, 13 May 2027, 9:00 a.m. to 5:00 p.m.')).toBeInTheDocument();
    expect(screen.getByText('Sell with Stripe')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Tickets' })).getByText('NC Local')).toBeInTheDocument();
    expect(screen.getByText('NC Local <hello@nclocal.eventrunner.org>')).toBeInTheDocument();
    expect(screen.getByText('Your team has at least two owners.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit your event' })).toHaveAttribute('href', '/organizations/o1/applications/a1/event');
  });

  it('moves on with Next, and says what comes next', async () => {
    renderSetup('review');
    expect(await screen.findByRole('button', { name: 'Next' })).toBeInTheDocument();
    expect(screen.getByText(/Check your event details, then continue to the hosting agreement/)).toBeInTheDocument();
  });

  it('shows the open problems, and a missing second Owner is not one of them', async () => {
    serveApi({
      getApplication: { application: application({ errors: { 'tickets.choice': 'Choose how you sell tickets.' }, ownersNeeded: 1 }) },
    });
    renderSetup('review');
    const title = await screen.findByRole('heading', { name: 'Answers that need attention' });
    const problems = within(title.closest('section'));
    expect(problems.getByRole('link', { name: 'Tickets' })).toHaveAttribute('href', '/organizations/o1/applications/a1/tickets?check=1');
    expect(problems.getByText(/Choose how you sell tickets\./)).toBeInTheDocument();
    expect(screen.queryByText(/Add a second Owner/)).not.toBeInTheDocument();
    expect(screen.getByText(/A second owner can help manage your team/)).toBeInTheDocument();
    expect(screen.getByText('Finish the answers above first. Then you can continue.')).toBeInTheDocument();
  });
});
