import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callApi } from '../../api.js';
import { renderPage } from '../../test/renderPage.jsx';
import ConsoleSettings from './ConsoleSettings.jsx';

vi.mock('../../api.js', () => ({ callApi: vi.fn() }));

const SAVED = { gcpFolder: 'folders/123456789012', billingAccount: '012345-6789AB-CDEF01', region: 'us-central1' };

function serve(handlers = {}) {
  callApi.mockImplementation(async (name, body) => {
    if (handlers[name]) return handlers[name](body);
    if (name === 'getConsoleSettings') return { settings: SAVED };
    return {};
  });
}

const page = () => renderPage(<ConsoleSettings />, { path: '/review/settings', route: '/review/settings' });

beforeEach(() => serve());

describe('ConsoleSettings', () => {
  it('shows the saved settings in labelled fields', async () => {
    page();
    expect(await screen.findByRole('heading', { level: 1, name: 'Console settings' })).toBeInTheDocument();
    expect(screen.getByLabelText('Google Cloud folder')).toHaveValue('folders/123456789012');
    expect(screen.getByLabelText('Billing account')).toHaveValue('012345-6789AB-CDEF01');
    expect(screen.getByLabelText('Region')).toHaveValue('us-central1');
  });

  it('saves the settings and says so', async () => {
    serve({ saveConsoleSettings: (body) => ({ settings: { ...body.settings, region: 'us-east1' } }) });
    page();
    fireEvent.change(await screen.findByLabelText('Region'), { target: { value: 'us-east1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('The settings are saved. New approvals use them.')).toBeInTheDocument();
    expect(callApi).toHaveBeenCalledWith('saveConsoleSettings', { settings: { ...SAVED, region: 'us-east1' } });
  });

  it('checks each value before it saves and focuses the first bad field', async () => {
    page();
    fireEvent.change(await screen.findByLabelText('Billing account'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    const field = screen.getByLabelText('Billing account');
    expect(await screen.findByText('Enter the billing account, for example 012345-6789AB-CDEF01.')).toBeInTheDocument();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveFocus();
    expect(callApi).not.toHaveBeenCalledWith('saveConsoleSettings', expect.anything());
  });

  it('shows a refusal from the server at the field it names', async () => {
    serve({
      saveConsoleSettings: () => {
        throw Object.assign(new Error('Enter a Google Cloud region, for example us-central1.'), { field: 'region' });
      },
    });
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('Enter a Google Cloud region, for example us-central1.')).toBeInTheDocument();
    expect(screen.getByLabelText('Region')).toHaveFocus();
  });

  it('tells a client the page is for the hosting team', async () => {
    callApi.mockRejectedValue(Object.assign(new Error('x'), { code: 'not-operator' }));
    page();
    expect(await screen.findByRole('heading', { level: 1, name: 'This page is for the hosting team' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Region')).not.toBeInTheDocument();
  });

  describe('the event fee and the agreement', () => {
    const FEE = { amount: 12345, currency: 'usd' };
    const AGREEMENT = { version: 2, title: 'Test agreement', body: 'Test text.', sha256: 'h', savedAt: '2026-11-04T15:00:00.000Z' };

    it('says sign-ups are closed until both are saved', async () => {
      page();
      expect(await screen.findByRole('note')).toHaveTextContent('Sign-ups are closed');
    });

    it('does not say so when both are saved, and shows them', async () => {
      serve({ getConsoleSettings: () => ({ settings: SAVED, fee: FEE, agreement: AGREEMENT }) });
      page();
      expect(await screen.findByLabelText('Amount')).toHaveValue('12345');
      expect(screen.getByLabelText('Currency')).toHaveValue('usd');
      expect(screen.getByText('Clients pay $123.45.')).toBeInTheDocument();
      expect(screen.getByLabelText('Title')).toHaveValue('Test agreement');
      expect(screen.getByLabelText('Text')).toHaveValue('Test text.');
      expect(screen.getByText(/The current text is version 2/)).toBeInTheDocument();
      expect(screen.queryByRole('note')).not.toBeInTheDocument();
    });

    it('saves the fee as a whole number and checks it first', async () => {
      serve({ saveEventFee: (body) => ({ fee: { ...body.fee, currency: 'usd' } }) });
      page();
      const amount = await screen.findByLabelText('Amount');
      fireEvent.change(amount, { target: { value: '10.50' } });
      fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'USD' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save the fee' }));
      expect(await screen.findByText('Enter the amount as a whole number in the smallest unit of the currency.')).toBeInTheDocument();
      expect(amount).toHaveFocus();
      expect(callApi).not.toHaveBeenCalledWith('saveEventFee', expect.anything());

      fireEvent.change(amount, { target: { value: '12345' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save the fee' }));
      expect(await screen.findByText('The fee is saved. New payment pages use it.')).toBeInTheDocument();
      expect(callApi).toHaveBeenCalledWith('saveEventFee', { fee: { amount: 12345, currency: 'USD' } });
      expect(screen.getByLabelText('Currency')).toHaveValue('usd');
    });

    it('saves a changed text as a new version', async () => {
      serve({
        getConsoleSettings: () => ({ settings: SAVED, fee: FEE, agreement: AGREEMENT }),
        saveAgreement: (body) => ({ created: true, agreement: { ...AGREEMENT, ...body.agreement, version: 3 } }),
      });
      page();
      fireEvent.change(await screen.findByLabelText('Text'), { target: { value: 'A changed text.' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save as a new version' }));
      expect(await screen.findByText('Version 3 is saved. New acceptances use it.')).toBeInTheDocument();
      expect(callApi).toHaveBeenCalledWith('saveAgreement', { agreement: { title: 'Test agreement', body: 'A changed text.' } });
      expect(screen.getByText(/The current text is version 3/)).toBeInTheDocument();
    });

    it('says when the same text saved nothing', async () => {
      serve({
        getConsoleSettings: () => ({ settings: SAVED, fee: FEE, agreement: AGREEMENT }),
        saveAgreement: () => ({ created: false, agreement: AGREEMENT }),
      });
      page();
      await screen.findByLabelText('Text');
      fireEvent.click(screen.getByRole('button', { name: 'Save as a new version' }));
      expect(await screen.findByText('This is the same text as version 2, so nothing changed.')).toBeInTheDocument();
    });

    it('shows a refusal at the agreement field it names', async () => {
      serve({
        saveAgreement: () => { throw Object.assign(new Error('Enter the agreement text, up to 200,000 characters.'), { field: 'agreementBody' }); },
      });
      page();
      await screen.findByLabelText('Text');
      fireEvent.click(screen.getByRole('button', { name: 'Save as a new version' }));
      expect(await screen.findByText('Enter the agreement text, up to 200,000 characters.')).toBeInTheDocument();
      expect(screen.getByLabelText('Text')).toHaveAttribute('aria-invalid', 'true');
    });
  });
});
