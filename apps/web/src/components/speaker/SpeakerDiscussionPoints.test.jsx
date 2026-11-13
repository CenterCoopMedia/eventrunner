import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ContentContext from '../../contexts/ContentContext.jsx';
import SpeakerSessionHub from './SpeakerSessionHub.jsx';

const OWNER = { uid: 'owner', getIdToken: async () => 'owner-token' };
const OTHER = { uid: 'other', getIdToken: async () => 'other-token' };
const EVENT = { timezone: 'UTC', days: [{ id: 'day-1', date: '2026-11-13' }] };
const SESSIONS = [
  { id: 'first', title: 'First session', visible: true, speakerIds: ['speaker-own', 'speaker-other'] },
  { id: 'second', title: 'Second session', visible: true, speakerIds: ['speaker-own', 'speaker-other'] },
];
const STORED = {
  text: 'Previously saved question.', revision: 4, requestId: 'request_existing_123',
  submittedAt: '2026-11-13T15:00:00.000Z', notification: { state: 'omitted' },
};
const response = (body, status = 200) => ({ ok: status === 200, status, json: async () => body });
const failure = (status) => response({ error: { code: 'refused', message: 'Request refused.' } }, status);
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function hub(user = OWNER, speakerId = 'speaker-own') {
  return (
    <ContentContext.Provider value={{ speakers: [] }}>
      <SpeakerSessionHub user={user} speakerId={speakerId} eventConfig={EVENT} scheduleData={SESSIONS} />
    </ContentContext.Provider>
  );
}
function openDiscussion() { fireEvent.click(screen.getByRole('tab', { name: 'Discussion points' })); }
function edit(text) { fireEvent.change(screen.getByRole('textbox', { name: 'Discussion points' }), { target: { value: text } }); }
function submit() { fireEvent.submit(screen.getByRole('form', { name: 'Speaker discussion points' })); }
function savedFor(request, state = 'accepted') {
  return { text: request.text, revision: request.expectedRevision + 1, requestId: request.requestId,
    submittedAt: '2026-11-13T15:01:00.000Z', notification: { state } };
}

beforeEach(() => { globalThis.fetch = vi.fn(); });

describe('speaker-wide private discussion draft', () => {
  it('restores the owner submission and keeps an unsaved draft across tabs and sessions', async () => {
    fetch.mockResolvedValue(response({ submission: STORED }));
    render(hub());
    openDiscussion();
    expect(await screen.findByDisplayValue(STORED.text)).toBeEnabled();
    edit('My unsaved question.');
    fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: 'Session' }), { target: { value: 'second' } });
    openDiscussion();
    expect(screen.getByRole('textbox', { name: 'Discussion points' })).toHaveValue('My unsaved question.');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['accepted', /provider accepted.*receipt is unconfirmed/],
    ['omitted', /No organizer email was sent for this update/],
    ['failed', /organizer email failed/],
    ['unknown', /email outcome is unconfirmed/],
  ])('shows durable save separately from the %s email result', async (state, message) => {
    fetch.mockResolvedValueOnce(response({ submission: null })).mockImplementationOnce(async (_url, init) =>
      response({ submission: savedFor(JSON.parse(init.body), state) }));
    render(hub()); openDiscussion();
    await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled());
    edit('  First question.\r\nSecond question.  '); submit();
    expect(await screen.findByText(message)).toBeInTheDocument();
    const request = JSON.parse(fetch.mock.calls[1][1].body);
    expect(request).toMatchObject({ speakerId: 'speaker-own', text: 'First question.\nSecond question.', expectedRevision: 0 });
    expect(request.requestId).toMatch(/^[A-Za-z0-9_-]{16,80}$/);
    expect(screen.getByRole('button', { name: 'Replace saved discussion points' })).toBeEnabled();
  });

  it.each(['network', 'malformed'])('retries the exact previous request after %s uncertainty and preserves newer edits', async (kind) => {
    const pending = deferred();
    fetch.mockResolvedValueOnce(response({ submission: null })).mockReturnValueOnce(pending.promise);
    render(hub()); openDiscussion();
    await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled());
    edit('First question.'); submit();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const original = JSON.parse(fetch.mock.calls[1][1].body);
    edit('A newer unsaved question.');
    await act(async () => {
      if (kind === 'network') pending.reject(new Error('connection closed'));
      else pending.resolve(response({}));
    });
    fetch.mockResolvedValueOnce(response({ submission: savedFor(original, 'unknown'), replay: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry previous save' }));
    expect(await screen.findByText(/email outcome is unconfirmed/)).toBeInTheDocument();
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual(original);
    expect(screen.getByRole('textbox')).toHaveValue('A newer unsaved question.');
    expect(screen.getByText('Your current changes have not been saved.')).toBeInTheDocument();
  });

  it('keeps edits made while a successful save is in flight', async () => {
    const pending = deferred();
    fetch.mockResolvedValueOnce(response({ submission: null })).mockReturnValueOnce(pending.promise);
    render(hub()); openDiscussion();
    await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled());
    edit('First question.'); submit();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const request = JSON.parse(fetch.mock.calls[1][1].body);
    edit('Still editing.');
    await act(async () => { pending.resolve(response({ submission: savedFor(request) })); });
    expect(screen.getByRole('textbox')).toHaveValue('Still editing.');
    expect(screen.getByText('Your current changes have not been saved.')).toBeInTheDocument();
  });

  it('reconciles a conflict without replacing the local draft, then requires an explicit replacement', async () => {
    fetch.mockResolvedValueOnce(response({ submission: STORED })).mockResolvedValueOnce(failure(409));
    render(hub()); openDiscussion();
    await screen.findByDisplayValue(STORED.text);
    edit('Keep my text.'); submit();
    expect(await screen.findByText(/may already have saved/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replace saved discussion points' })).toBeDisabled();
    const current = { ...STORED, text: 'A newer saved question.', revision: 6 };
    fetch.mockResolvedValueOnce(response({ submission: current }));
    fireEvent.click(screen.getByRole('button', { name: 'Load current submission' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Replace saved discussion points' })).toBeEnabled());
    expect(screen.getByRole('textbox')).toHaveValue('Keep my text.');
    expect(fetch).toHaveBeenCalledTimes(3);
    fetch.mockImplementationOnce(async (_url, init) => response({ submission: savedFor(JSON.parse(init.body), 'omitted') }));
    submit();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
    expect(JSON.parse(fetch.mock.calls[3][1].body)).toMatchObject({ text: 'Keep my text.', expectedRevision: 6 });
    await screen.findByText(/No organizer email was sent for this update/);
  });

  it.each([401, 403])('hides private text after HTTP %s and waits for an explicit access check', async (status) => {
    fetch.mockResolvedValueOnce(response({ submission: STORED })).mockResolvedValueOnce(failure(status));
    render(hub()); openDiscussion(); await screen.findByDisplayValue(STORED.text);
    edit('Unsaved private text.'); submit();
    await screen.findByRole('button', { name: 'Check access' });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByText(STORED.text)).toBeNull();
    expect(screen.queryByText('Unsaved private text.')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
    fetch.mockResolvedValueOnce(response({ submission: STORED }));
    fireEvent.click(screen.getByRole('button', { name: 'Check access' }));
    await screen.findByDisplayValue('Unsaved private text.');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('explains a read-only demo refusal without hiding the owner draft or offering an access loop', async () => {
    fetch.mockResolvedValueOnce(response({ submission: STORED })).mockResolvedValueOnce(response({
      error: { code: 'read-only-demo', message: 'This historical demo is read-only.' },
    }, 403));
    render(hub()); openDiscussion(); await screen.findByDisplayValue(STORED.text);
    edit('Keep my local text.'); submit();
    await screen.findByText(/historical demo is read-only/);
    expect(screen.getByRole('textbox')).toHaveValue('Keep my local text.');
    expect(screen.getByRole('button', { name: 'Replace saved discussion points' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Check access' })).toBeNull();
    submit();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(['account', 'speaker'])('discards private state and ignores a late read after a %s switch', async (scope) => {
    const oldRead = deferred();
    fetch.mockReturnValueOnce(oldRead.promise).mockResolvedValueOnce(response({ submission: null }));
    const mounted = render(hub()); openDiscussion();
    mounted.rerender(hub(scope === 'account' ? OTHER : OWNER, scope === 'speaker' ? 'speaker-other' : 'speaker-own'));
    openDiscussion();
    await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled());
    await act(async () => { oldRead.resolve(response({ submission: STORED })); });
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.queryByText(STORED.text)).toBeNull();
    expect(screen.queryByText(/No organizer email/)).toBeNull();
  });

  it.each(['account', 'speaker'])('discards private state and ignores a late save after a %s switch', async (scope) => {
    const oldSave = deferred();
    fetch.mockResolvedValueOnce(response({ submission: STORED })).mockReturnValueOnce(oldSave.promise)
      .mockResolvedValueOnce(response({ submission: null }));
    const mounted = render(hub()); openDiscussion(); await screen.findByDisplayValue(STORED.text);
    edit('Old owner private edit.'); submit();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const request = JSON.parse(fetch.mock.calls[1][1].body);
    mounted.rerender(hub(scope === 'account' ? OTHER : OWNER, scope === 'speaker' ? 'speaker-other' : 'speaker-own'));
    openDiscussion();
    expect(screen.queryByText(STORED.text)).toBeNull();
    expect(screen.queryByDisplayValue('Old owner private edit.')).toBeNull();
    await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled());
    await act(async () => { oldSave.resolve(response({ submission: savedFor(request) })); });
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.queryByText(/provider accepted/)).toBeNull();
    edit('New owner question.');
    fetch.mockImplementationOnce(async (_url, init) => response({ submission: savedFor(JSON.parse(init.body)) }));
    submit();
    await screen.findByText(/provider accepted/);
    expect(JSON.parse(fetch.mock.calls[3][1].body).expectedRevision).toBe(0);
  });

  it('keeps save unavailable until a valid read, including after malformed success', async () => {
    fetch.mockResolvedValueOnce(response({}));
    render(hub()); openDiscussion();
    await screen.findByText(/could not be loaded/);
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save discussion points' })).toBeDisabled();
    fetch.mockResolvedValueOnce(response({ submission: null }));
    fireEvent.click(screen.getByRole('button', { name: 'Load current submission' }));
    await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled());
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['empty', ' \n\t '], ['over limit', 'a'.repeat(10001)], ['control character', 'Question\u0000with control'],
    ['over limit with control character', `${'a'.repeat(10001)}\u0000`],
  ])('rejects %s text before a save and focuses the field', async (_name, text) => {
    fetch.mockResolvedValueOnce(response({ submission: null }));
    render(hub()); openDiscussion();
    await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled());
    edit(text); submit();
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveFocus());
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('textbox').parentElement).not.toHaveTextContent('text:');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('accepts the normalized 10,000 UTF-16-character boundary with tabs and line breaks', async () => {
    fetch.mockResolvedValueOnce(response({ submission: null }))
      .mockImplementationOnce(async (_url, init) => response({ submission: savedFor(JSON.parse(init.body)) }));
    render(hub()); openDiscussion();
    await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled());
    edit(`  ${'😀'.repeat(4998)}\tA\nB  `); submit();
    await screen.findByText(/provider accepted/);
    expect(JSON.parse(fetch.mock.calls[1][1].body).text.length).toBe(10000);
  });
});
