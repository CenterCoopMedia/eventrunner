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
    expect(await screen.findByText('Settings saved. New sites will use them.')).toBeInTheDocument();
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

  describe('the agreement', () => {
    const AGREEMENT = { version: 2, title: 'Test agreement', body: 'Test text.', sha256: 'h', savedAt: '2026-11-04T15:00:00.000Z' };

    it('says sign-ups are closed until the agreement is saved', async () => {
      page();
      expect(await screen.findByRole('note')).toHaveTextContent('Sign-ups are closed');
    });

    it('says sign-ups are closed until the build settings are saved', async () => {
      serve({ getConsoleSettings: () => ({ settings: { ...SAVED, region: '' }, agreement: AGREEMENT }) });
      page();
      expect(await screen.findByRole('note')).toHaveTextContent('Save hosting settings and an agreement');
    });

    it('does not say so when all are saved, and shows the agreement', async () => {
      serve({ getConsoleSettings: () => ({ settings: SAVED, agreement: AGREEMENT }) });
      page();
      expect(await screen.findByLabelText('Title')).toHaveValue('Test agreement');
      expect(screen.getByLabelText('Text')).toHaveValue('Test text.');
      expect(screen.getByText(/The current text is version 2/)).toBeInTheDocument();
      expect(screen.queryByRole('note')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Amount')).not.toBeInTheDocument();
    });

    it('saves a changed text as a new version', async () => {
      serve({
        getConsoleSettings: () => ({ settings: SAVED, agreement: AGREEMENT }),
        saveAgreement: (body) => ({ created: true, agreement: { ...AGREEMENT, ...body.agreement, version: 3 } }),
      });
      page();
      fireEvent.change(await screen.findByLabelText('Text'), { target: { value: 'A changed text.' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save agreement' }));
      expect(await screen.findByText('Version 3 saved. New clients will see this text.')).toBeInTheDocument();
      expect(callApi).toHaveBeenCalledWith('saveAgreement', { agreement: { title: 'Test agreement', body: 'A changed text.' } });
      expect(screen.getByText(/The current text is version 3/)).toBeInTheDocument();
    });

    it('says when the same text saved nothing', async () => {
      serve({
        getConsoleSettings: () => ({ settings: SAVED, agreement: AGREEMENT }),
        saveAgreement: () => ({ created: false, agreement: AGREEMENT }),
      });
      page();
      await screen.findByLabelText('Text');
      fireEvent.click(screen.getByRole('button', { name: 'Save agreement' }));
      expect(await screen.findByText('No changes to save. Version 2 is current.')).toBeInTheDocument();
    });

    it('shows a refusal at the agreement field it names', async () => {
      serve({
        saveAgreement: () => { throw Object.assign(new Error('Enter the agreement text, up to 200,000 characters.'), { field: 'agreementBody' }); },
      });
      page();
      await screen.findByLabelText('Text');
      fireEvent.click(screen.getByRole('button', { name: 'Save agreement' }));
      expect(await screen.findByText('Enter the agreement text, up to 200,000 characters.')).toBeInTheDocument();
      expect(screen.getByLabelText('Text')).toHaveAttribute('aria-invalid', 'true');
    });
  });
});
