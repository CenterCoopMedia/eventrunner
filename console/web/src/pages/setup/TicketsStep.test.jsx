import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { application, callsTo, emptyAnswers, serveApi } from '../../test/application.js';
import { renderSetup } from '../../test/setupPage.jsx';

vi.mock('../../api.js', () => ({ callApi: vi.fn() }));

beforeEach(() => {
  serveApi({ getApplication: { application: application({ answers: emptyAnswers() }) } });
});

describe('Tickets step', () => {
  it('offers the four choices in plain words', async () => {
    renderSetup('tickets');
    const group = await screen.findByRole('group', { name: 'Ticket sales' });
    expect(group).toBeInTheDocument();
    for (const name of ['Sell with Stripe', 'Use Eventbrite', 'Import a spreadsheet later', 'No tickets']) {
      expect(screen.getByRole('radio', { name: new RegExp(name) })).not.toBeChecked();
    }
  });

  it('records Stripe and says the account is connected after approval', async () => {
    renderSetup('tickets');
    fireEvent.click(await screen.findByRole('radio', { name: /Sell with Stripe/ }));
    expect(screen.getByRole('note')).toHaveTextContent('You connect this account after we approve your request.');
    expect(screen.queryByRole('button', { name: /Connect/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { level: 1, name: 'Email' });
    expect(callsTo('saveApplicationStep').at(-1)).toMatchObject({ step: 'tickets', answers: { choice: 'stripe' } });
  });

  it('says the same for Eventbrite, and nothing for a spreadsheet or no tickets', async () => {
    renderSetup('tickets');
    fireEvent.click(await screen.findByRole('radio', { name: /Use Eventbrite/ }));
    expect(screen.getByRole('note')).toHaveTextContent('Use Eventbrite');
    fireEvent.click(screen.getByRole('radio', { name: /Import a spreadsheet later/ }));
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /No tickets/ }));
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });
});
