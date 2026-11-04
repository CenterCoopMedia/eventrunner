import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { application, callsTo, emptyAnswers, serveApi } from '../../test/application.js';
import { renderSetup } from '../../test/setupPage.jsx';

vi.mock('../../api.js', () => ({ callApi: vi.fn() }));

function answersWith() {
  const answers = emptyAnswers();
  answers.event.name = 'NC Local News Summit';
  answers.webAddress.name = 'nclocal';
  return answers;
}

beforeEach(() => {
  serveApi({ getApplication: { application: application({ answers: answersWith() }) } });
});

describe('Email step', () => {
  it('shows a preview of the sender with the web address, and where replies go', async () => {
    renderSetup('email');
    const preview = await screen.findByLabelText('Email preview');
    expect(preview).toHaveTextContent('NC Local News Summit <hello@nclocal.eventrunner.org>');
    fireEvent.change(screen.getByLabelText('Sender name'), { target: { value: 'NC Local' } });
    fireEvent.change(screen.getByLabelText('Reply address'), { target: { value: 'ops@nclocal.org' } });
    expect(preview).toHaveTextContent('NC Local <hello@nclocal.eventrunner.org>');
    expect(preview).toHaveTextContent('Replies go to ops@nclocal.org');
  });

  it('saves the sender name and the reply address', async () => {
    renderSetup('email');
    fireEvent.change(await screen.findByLabelText('Sender name'), { target: { value: 'NC Local' } });
    fireEvent.change(screen.getByLabelText('Reply address'), { target: { value: 'ops@nclocal.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { level: 1, name: 'Review' });
    expect(callsTo('saveApplicationStep').at(-1)).toMatchObject({
      step: 'email', answers: { senderName: 'NC Local', replyTo: 'ops@nclocal.org' },
    });
  });
});
