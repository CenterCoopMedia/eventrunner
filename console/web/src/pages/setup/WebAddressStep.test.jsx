import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { application, callsTo, emptyAnswers, serveApi } from '../../test/application.js';
import { renderSetup } from '../../test/setupPage.jsx';

vi.mock('../../api.js', () => ({ callApi: vi.fn() }));

beforeEach(() => {
  serveApi({ getApplication: { application: application({ answers: emptyAnswers() }) } });
});

describe('Your web address step', () => {
  it('focuses a cold step error and shows name.eventrunner.org as the reader types', async () => {
    serveApi({ getApplication: { application: application({ answers: emptyAnswers(),
      errors: { 'webAddress.name': 'Enter a web address.' } }) } });
    renderSetup('web-address', { query: '?check=1' });
    const field = await screen.findByLabelText('Name');
    await waitFor(() => expect(field).toHaveFocus());
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Web address preview')).toHaveTextContent('your-name.eventrunner.org');
    fireEvent.change(field, { target: { value: 'NCLocal' } });
    expect(field).toHaveValue('nclocal');
    expect(field).toHaveFocus();
    expect(screen.getByLabelText('Web address preview')).toHaveTextContent('nclocal.eventrunner.org');
  });

  it('says at once that a free name is available', async () => {
    renderSetup('web-address');
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'nclocal' } });
    expect(await screen.findByText('nclocal.eventrunner.org is available.')).toBeInTheDocument();
    expect(callsTo('checkWebAddress').at(-1)).toEqual({ name: 'nclocal', appId: 'a1' });
  });

  it.each(['taken', 'reserved'])('says when a name is %s while typing, on the field', async (reason) => {
    const message = reason === 'taken' ? 'Another event already uses this name. Choose another name.' : 'This name is reserved. Choose another name.';
    serveApi({
      getApplication: { application: application({ answers: emptyAnswers() }) },
      checkWebAddress: (body) => ({
        name: body.name, address: `${body.name}.eventrunner.org`, available: false, reason, message,
      }),
      saveApplicationStep: (body) => ({
        step: body.step, saved: false, answers: body.answers, errors: { 'webAddress.name': message },
      }),
    });
    renderSetup('web-address');
    const field = await screen.findByLabelText('Name');
    fireEvent.change(field, { target: { value: reason } });
    await waitFor(() => expect(field).toHaveAccessibleDescription(new RegExp(message)));
    expect(field).toHaveAttribute('aria-invalid', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByRole('heading', { level: 1, name: 'Your event' });
  });

  it('holds a format verdict until Next, including after autosave', async () => {
    const message = 'Use 3 to 27 lowercase letters, numbers and hyphens.';
    serveApi({
      checkWebAddress: (body) => ({ name: body.name, available: false, reason: 'format', message }),
      saveApplicationStep: (body) => ({ step: body.step, saved: false, answers: body.answers, errors: { 'webAddress.name': message } }),
    });
    renderSetup('web-address');
    const field = await screen.findByLabelText('Name');
    fireEvent.change(field, { target: { value: 'x' } });
    await waitFor(() => expect(callsTo('checkWebAddress')).toHaveLength(1));
    expect(field).not.toHaveAttribute('aria-invalid');
    await screen.findByText('Not saved. Check the answer.');
    expect(field).not.toHaveAttribute('aria-invalid');
    fireEvent.click(screen.getByRole('button', { name: 'Next: Your team' }));
    await waitFor(() => expect(field).toHaveFocus());
    expect(field).toHaveAccessibleDescription(new RegExp(message));
    expect(screen.getByRole('heading', { level: 1, name: 'Your web address' })).toBeInTheDocument();
  });
});
