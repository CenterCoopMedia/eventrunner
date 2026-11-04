import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { application, callsTo, emptyAnswers, serveApi } from '../../test/application.js';
import { renderSetup } from '../../test/setupPage.jsx';

vi.mock('../../api.js', () => ({ callApi: vi.fn() }));

beforeEach(() => {
  serveApi({ getApplication: { application: application({ answers: emptyAnswers() }) } });
});

describe('Your web address step', () => {
  it('shows name.eventrunner.org as the reader types', async () => {
    renderSetup('web-address');
    const field = await screen.findByLabelText('Name');
    expect(screen.getByLabelText('Web address preview')).toHaveTextContent('your-name.eventrunner.org');
    fireEvent.change(field, { target: { value: 'NCLocal' } });
    expect(field).toHaveValue('nclocal');
    expect(screen.getByLabelText('Web address preview')).toHaveTextContent('nclocal.eventrunner.org');
  });

  it('says at once that a free name is available', async () => {
    renderSetup('web-address');
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'nclocal' } });
    expect(await screen.findByText('nclocal.eventrunner.org is available. We keep it for you while you finish.')).toBeInTheDocument();
    expect(callsTo('checkWebAddress').at(-1)).toEqual({ name: 'nclocal', appId: 'a1' });
  });

  it('says when a name is taken, on the field', async () => {
    serveApi({
      getApplication: { application: application({ answers: emptyAnswers() }) },
      checkWebAddress: (body) => ({
        name: body.name, address: `${body.name}.eventrunner.org`, available: false, reason: 'taken',
        message: 'Another event already uses this name. Choose another name.',
      }),
      saveApplicationStep: (body) => ({
        step: body.step, saved: false, answers: body.answers, errors: { 'webAddress.name': 'Another event already uses this name. Choose another name.' },
      }),
    });
    renderSetup('web-address');
    const field = await screen.findByLabelText('Name');
    fireEvent.change(field, { target: { value: 'taken' } });
    await waitFor(() => expect(field).toHaveAccessibleDescription(/Another event already uses this name/));
    expect(field).toHaveAttribute('aria-invalid', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByRole('heading', { level: 1, name: 'Your event' });
  });
});
