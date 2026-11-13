import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { application, callsTo, emptyAnswers, serveApi } from '../../test/application.js';
import { renderSetup } from '../../test/setupPage.jsx';
import { fakeAuth, signedInUser } from '../../test/renderPage.jsx';
import { keepAnswer, readKeptAnswer } from '../../setup/keptAnswers.js';

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
    expect(screen.getByLabelText('Sender name')).toHaveValue('NC Local News Summit');
    expect(screen.getByLabelText('Reply address')).toHaveValue('ana@example.org');
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
    fireEvent.click(screen.getByRole('button', { name: 'Next: Review' }));
    await screen.findByRole('heading', { level: 1, name: 'Review' });
    expect(callsTo('saveApplicationStep').at(-1)).toMatchObject({
      step: 'email', answers: { senderName: 'NC Local', replyTo: 'ops@nclocal.org' },
    });
    const summary = screen.getByRole('region', { name: 'Email' });
    expect(summary).toHaveTextContent('NC Local <hello@nclocal.eventrunner.org>');
    expect(summary).toHaveTextContent('ops@nclocal.org');
  });

  it('prefers the short name, saves both defaults without typing, and shows them on Review', async () => {
    const answers = answersWith();
    answers.event.shortName = 'News Summit';
    serveApi({ getApplication: { application: application({ answers }) } });
    renderSetup('email');
    expect(await screen.findByLabelText('Sender name')).toHaveValue('News Summit');
    expect(screen.getByLabelText('Reply address')).toHaveValue('ana@example.org');
    fireEvent.click(screen.getByRole('button', { name: 'Next: Review' }));
    await screen.findByRole('heading', { level: 1, name: 'Review' });
    expect(callsTo('saveApplicationStep').at(-1)).toMatchObject({
      step: 'email', answers: { senderName: 'News Summit', replyTo: 'ana@example.org' },
    });
    const summary = screen.getByRole('region', { name: 'Email' });
    expect(summary).toHaveTextContent('News Summit <hello@nclocal.eventrunner.org>');
    expect(summary).toHaveTextContent('ana@example.org');
  });

  it('keeps saved custom values instead of replacing them with defaults', async () => {
    const answers = answersWith();
    answers.email = { senderName: 'The organizing team', replyTo: 'team@example.org' };
    serveApi({ getApplication: { application: application({ answers }) } });
    renderSetup('email');
    expect(await screen.findByLabelText('Sender name')).toHaveValue('The organizing team');
    expect(screen.getByLabelText('Reply address')).toHaveValue('team@example.org');
    expect(screen.queryByText('Saving.')).not.toBeInTheDocument();
    expect(callsTo('saveApplicationStep')).toHaveLength(0);
  });

  it('leaves an unverified sign-in address out of the reply field', async () => {
    renderSetup('email', { auth: fakeAuth({ user: signedInUser({ emailVerified: false }) }) });
    expect(await screen.findByLabelText('Reply address')).toHaveValue('');
    expect(screen.getByLabelText('Email preview')).toHaveTextContent('Replies go to your reply address');
  });

  it('allows clearing defaults and sends the empty values for validation', async () => {
    serveApi({ saveApplicationStep: (body) => ({ step: body.step, saved: true, answers: body.answers,
      errors: { 'email.senderName': 'Enter a sender name.', 'email.replyTo': 'Enter a reply address.' } }) });
    renderSetup('email');
    fireEvent.change(await screen.findByLabelText('Sender name'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Reply address'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next: Review' }));
    await screen.findByRole('heading', { name: 'Answers that need attention' });
    expect(screen.getByLabelText('Sender name')).toHaveAccessibleDescription('Enter a sender name.');
    expect(screen.getByLabelText('Sender name')).toHaveValue('');
    expect(screen.getByLabelText('Reply address')).toHaveValue('');
    expect(screen.getByLabelText('Email preview')).not.toHaveTextContent('NC Local News Summit');
    expect(callsTo('saveApplicationStep').at(-1)).toMatchObject({
      step: 'email', answers: { senderName: '', replyTo: '' },
    });
  });

  it('preserves a tab-kept answer until the reader explicitly chooses it', async () => {
    const scope = { userId: 'ana', orgId: 'o1', appId: 'a1' };
    const kept = { step: 'email', answers: { senderName: 'Unfinished sender', replyTo: 'kept@example.org' } };
    keepAnswer(scope, kept);
    vi.useFakeTimers();
    try {
      await act(async () => { renderSetup('email'); });
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(callsTo('saveApplicationStep')).toHaveLength(0);
      expect(readKeptAnswer(scope, 'email')).toEqual(kept);
      fireEvent.click(screen.getByRole('button', { name: 'Use kept answer' }));
      expect(screen.getByLabelText('Sender name')).toHaveValue('Unfinished sender');
      expect(screen.getByLabelText('Reply address')).toHaveValue('kept@example.org');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows defaults without autosaving and discards them when leaving without confirmation', async () => {
    vi.useFakeTimers();
    try {
      await act(async () => { renderSetup('email'); });
      expect(screen.getByLabelText('Sender name')).toHaveValue('NC Local News Summit');
      expect(screen.getByLabelText('Reply address')).toHaveValue('ana@example.org');
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(callsTo('saveApplicationStep')).toHaveLength(0);
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Back' })); });
      await act(async () => { fireEvent.click(screen.getByRole('link', { name: /Review/ })); });
      expect(screen.getByRole('heading', { level: 1, name: 'Review' })).toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'Email' })).not.toHaveTextContent('ana@example.org');
      expect(screen.getByRole('region', { name: 'Email' })).not.toHaveTextContent('NC Local News Summit');
      expect(callsTo('saveApplicationStep')).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
