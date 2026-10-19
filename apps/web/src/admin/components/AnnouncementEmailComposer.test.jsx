// The announcement email composer (issues #202, #203): compose, preview,
// test send, confirm with the count, chunked send, history, reuse, and the
// restore path. adminApi is mocked: the server contract is proven in
// functions/src/announcements/sends.test.cjs.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const call = vi.fn();
vi.mock('../adminApi.js', () => ({ useAdminApi: () => call }));
const showToast = vi.fn();
vi.mock('../../contexts/ToastContext.jsx', () => ({ useToast: () => ({ showToast }) }));
vi.mock('../../contexts/EventConfigContext.jsx', () => ({
  useEventConfig: () => ({ eventConfig: { timezone: 'UTC' } }),
}));

import AnnouncementEmailComposer, { countsSentence } from './AnnouncementEmailComposer.jsx';

const AUDIENCES = [
  { id: 'registered', label: 'Registered attendees', description: 'Approved attendees and people who claimed a ticket.' },
  { id: 'speakers', label: 'Speakers', description: 'Accounts linked to a speaker profile.' },
];

const SENT = {
  id: 'send-old',
  status: 'sent',
  audience: 'speakers',
  audienceLabel: 'Speakers',
  subject: 'Speaker check-in moved',
  message: 'Check in at the side door.',
  link: { url: 'https://example.org/map', label: 'Open the map' },
  total: 3,
  processed: 3,
  counts: { sent: 2, failed: 1, uncertain: 0, skipped: 0, suppressed: 0 },
  failures: [{ email: 'gone@example.org', error: '406: Inactive recipient' }],
  createdAt: Date.UTC(2026, 9, 1, 14, 0),
  createdBy: 'staff@example.org',
  busy: false,
};

const PREVIEW = {
  sendId: 'send-new-1',
  receipt: 'a'.repeat(64),
  audience: 'registered',
  audienceLabel: 'Registered attendees',
  recipientCount: 42,
  suppressedCount: 2,
  unusableCount: 0,
  subject: 'Doors open at nine',
  html: '<!doctype html><html><body><p>Doors open at nine.</p></body></html>',
  text: 'Doors open at nine.',
  from: 'Example Event <events@example.org>',
  replyTo: 'help@example.org',
  stream: 'announcements',
  unsubscribeNote: 'Each recipient gets their own unsubscribe link at the end of the message.',
  canSend: true,
  blocker: null,
};

function respond(handlers) {
  call.mockImplementation(async (name, body) => {
    const handler = handlers[name];
    if (!handler) throw new Error(`unexpected call ${name}`);
    return typeof handler === 'function' ? handler(body) : handler;
  });
}

const listResponse = (sends = [SENT], channel = { canSend: true, blocker: null, mode: 'app' }) => ({
  sends, audiences: AUDIENCES, channel,
});

async function renderLoaded() {
  render(<AnnouncementEmailComposer />);
  await screen.findByLabelText('Audience');
}

function fillDraft() {
  fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Doors open at nine' } });
  fireEvent.change(screen.getByLabelText('Email message'), { target: { value: 'Doors open at nine.' } });
}

describe('AnnouncementEmailComposer', () => {
  beforeEach(() => {
    call.mockReset();
    showToast.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('lists the audiences from the server and the send history with counts and failures', async () => {
    respond({ listAnnouncementSends: listResponse() });
    await renderLoaded();
    expect(screen.getByLabelText('Audience')).toHaveValue('registered');
    expect(screen.getByText('Approved attendees and people who claimed a ticket.')).toBeInTheDocument();

    expect(screen.getByText('Speaker check-in moved')).toBeInTheDocument();
    expect(screen.getByText('Sent', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('Sent to 2 recipients of 3 addresses. 1 message failed.')).toBeInTheDocument();
    expect(screen.getByText(/Speakers · Oct 1, 2026, 2:00 PM UTC · staff@example.org/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Failed addresses (1)'));
    expect(screen.getByText('gone@example.org')).toBeInTheDocument();
  });

  it('previews without sending, then confirms the count before the send, and sends in chunks', async () => {
    let sendCalls = 0;
    respond({
      listAnnouncementSends: listResponse([]),
      previewAnnouncementEmail: PREVIEW,
      sendAnnouncementEmail: () => {
        sendCalls += 1;
        return sendCalls === 1
          ? { send: { ...SENT, id: 'send-new-1', status: 'sending', total: 42, processed: 20, counts: { sent: 20 }, failures: [] } }
          : { send: { ...SENT, id: 'send-new-1', status: 'sent', total: 42, processed: 42, counts: { sent: 42 }, failures: [] } };
      },
    });
    await renderLoaded();
    fillDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Preview email' }));

    const heading = await screen.findByRole('heading', { name: 'Preview' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(call).toHaveBeenCalledWith('previewAnnouncementEmail', {
      draft: { subject: 'Doors open at nine', message: 'Doors open at nine.' },
      audience: 'registered',
    });
    expect(screen.getByText('42 recipients: Registered attendees')).toBeInTheDocument();
    expect(screen.getByText('2 addresses are left out because they unsubscribed.')).toBeInTheDocument();
    expect(screen.getByText('Example Event <events@example.org>')).toBeInTheDocument();
    expect(screen.getByText(/own unsubscribe link/)).toBeInTheDocument();
    const frame = screen.getByTitle('Email preview');
    expect(frame).toHaveAttribute('sandbox', '');
    expect(call.mock.calls.filter(([name]) => name === 'sendAnnouncementEmail')).toHaveLength(0);

    // The first button only opens the confirmation; nothing is sent yet.
    fireEvent.click(screen.getByRole('button', { name: 'Send to 42 recipients' }));
    const confirm = await screen.findByRole('heading', { name: 'Send this email to 42 recipients?' });
    await waitFor(() => expect(confirm).toHaveFocus());
    expect(call.mock.calls.filter(([name]) => name === 'sendAnnouncementEmail')).toHaveLength(0);

    const region = confirm.closest('section');
    await act(async () => {
      fireEvent.click(within(region).getByRole('button', { name: 'Send to 42 recipients' }));
    });
    await screen.findByText(/The send is complete\. Sent to 42 recipients of 42 addresses\./);
    const sends = call.mock.calls.filter(([name]) => name === 'sendAnnouncementEmail');
    expect(sends[0][1]).toEqual({
      sendId: 'send-new-1',
      receipt: 'a'.repeat(64),
      draft: { subject: 'Doors open at nine', message: 'Doors open at nine.' },
      audience: 'registered',
    });
    expect(sends[1][1]).toEqual({ sendId: 'send-new-1' });
    // The form is cleared and the history reloaded.
    expect(screen.getByLabelText('Subject')).toHaveValue('');
    expect(call.mock.calls.filter(([name]) => name === 'listAnnouncementSends')).toHaveLength(2);
  });

  it('drops the preview on any edit, and Go back returns focus to the send button', async () => {
    respond({ listAnnouncementSends: listResponse([]), previewAnnouncementEmail: PREVIEW });
    await renderLoaded();
    fillDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Preview email' }));
    await screen.findByRole('heading', { name: 'Preview' });

    fireEvent.click(screen.getByRole('button', { name: 'Send to 42 recipients' }));
    await screen.findByRole('heading', { name: 'Send this email to 42 recipients?' });
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send to 42 recipients' })).toHaveFocus());

    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Changed' } });
    expect(screen.queryByRole('heading', { name: 'Preview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Send to/ })).not.toBeInTheDocument();
  });

  it('sends a test to the signed-in address', async () => {
    respond({
      listAnnouncementSends: listResponse([]),
      previewAnnouncementEmail: PREVIEW,
      sendAnnouncementTest: { sentTo: 'staff@example.org' },
    });
    await renderLoaded();
    fillDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Preview email' }));
    await screen.findByRole('heading', { name: 'Preview' });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send a test to me' })); });
    expect(call).toHaveBeenCalledWith('sendAnnouncementTest', { draft: { subject: 'Doors open at nine', message: 'Doors open at nine.' } });
    expect(showToast).toHaveBeenCalledWith('Test email sent to staff@example.org.');
  });

  it('shows the blocker and offers no send when the channel cannot send', async () => {
    const blocker = 'Announcement email needs the Postmark or console email provider.';
    respond({
      listAnnouncementSends: listResponse([], { canSend: false, blocker, mode: null }),
      previewAnnouncementEmail: { ...PREVIEW, canSend: false, blocker, receipt: null },
    });
    await renderLoaded();
    expect(screen.getByText(blocker)).toBeInTheDocument();
    fillDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Preview email' }));
    await screen.findByRole('heading', { name: 'Preview' });
    expect(screen.queryByRole('button', { name: /Send to/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send a test to me' })).not.toBeInTheDocument();
  });

  it('shows a stale-preview refusal, focuses it, and drops the preview', async () => {
    const stale = Object.assign(new Error('The audience or the email changed after the preview. Preview the email again.'), {
      code: 'preview-stale', fieldErrors: [],
    });
    respond({
      listAnnouncementSends: listResponse([]),
      previewAnnouncementEmail: PREVIEW,
      sendAnnouncementEmail: () => { throw stale; },
    });
    await renderLoaded();
    fillDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Preview email' }));
    await screen.findByRole('heading', { name: 'Preview' });
    fireEvent.click(screen.getByRole('button', { name: 'Send to 42 recipients' }));
    const confirm = await screen.findByRole('heading', { name: 'Send this email to 42 recipients?' });
    await act(async () => {
      fireEvent.click(within(confirm.closest('section')).getByRole('button', { name: 'Send to 42 recipients' }));
    });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Preview the email again.');
    await waitFor(() => expect(alert).toHaveFocus());
    expect(screen.queryByRole('heading', { name: 'Preview' })).not.toBeInTheDocument();
  });

  it('loads a past send into the form with Use this message', async () => {
    respond({ listAnnouncementSends: listResponse() });
    await renderLoaded();
    fireEvent.click(screen.getByRole('button', { name: 'Use this message' }));
    expect(screen.getByLabelText('Audience')).toHaveValue('speakers');
    expect(screen.getByLabelText('Subject')).toHaveValue('Speaker check-in moved');
    expect(screen.getByLabelText('Subject')).toHaveFocus();
    expect(screen.getByLabelText('Email message')).toHaveValue('Check in at the side door.');
    expect(screen.getByLabelText('Button link (optional)')).toHaveValue('https://example.org/map');
    expect(screen.getByLabelText('Button label (optional)')).toHaveValue('Open the map');
  });

  it('says when the failed address list is cut short, and where the rest are', async () => {
    const many = { ...SENT, total: 400, counts: { sent: 100, failed: 280, uncertain: 20 }, failures: Array.from({ length: 50 }, (_, n) => ({ email: `f${n}@example.org`, error: '503: Unavailable' })) };
    respond({ listAnnouncementSends: listResponse([many]) });
    await renderLoaded();
    fireEvent.click(screen.getByText('Failed addresses (first 50 of 300)'));
    expect(screen.getByText(/The Email log, filtered by the source Announcement, lists every one\./)).toBeInTheDocument();
  });

  it('retries the failed addresses of a send as a new previewed send, once', async () => {
    const failed = { ...SENT, retryCount: 2, retriedBy: null };
    respond({
      listAnnouncementSends: listResponse([failed, { ...SENT, id: 'send-done', subject: 'Already retried', retryCount: 1, retriedBy: 'send-later' }]),
      previewAnnouncementEmail: { ...PREVIEW, audience: 'speakers', audienceLabel: 'Speakers', recipientCount: 2, retryOf: 'send-old' },
      sendAnnouncementEmail: { send: { ...SENT, id: 'send-new-1', total: 2, processed: 2, counts: { sent: 2 }, failures: [], retryOf: 'send-old' } },
    });
    await renderLoaded();
    // One retry per send: the row that was retried offers none.
    expect(screen.getAllByRole('button', { name: /Retry .* failed addresses?/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry 2 failed addresses' }));
    expect(screen.getByLabelText('Subject')).toHaveValue('Speaker check-in moved');
    expect(screen.getByLabelText('Subject')).toHaveFocus();
    expect(screen.getByText('This email goes only to the 2 addresses that failed in "Speaker check-in moved".')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Preview email' }));
    await screen.findByRole('heading', { name: 'Preview' });
    expect(call).toHaveBeenCalledWith('previewAnnouncementEmail', {
      draft: { subject: 'Speaker check-in moved', message: 'Check in at the side door.', linkUrl: 'https://example.org/map', linkLabel: 'Open the map' },
      audience: 'speakers',
      retryOf: 'send-old',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send to 2 recipients' }));
    const confirm = await screen.findByRole('heading', { name: 'Send this email to 2 recipients?' });
    await act(async () => {
      fireEvent.click(within(confirm.closest('section')).getByRole('button', { name: 'Send to 2 recipients' }));
    });
    await screen.findByText(/The send is complete/);
    const [, body] = call.mock.calls.find(([name]) => name === 'sendAnnouncementEmail');
    expect(body).toMatchObject({ sendId: 'send-new-1', audience: 'speakers', retryOf: 'send-old' });
    expect(screen.queryByText(/This email goes only to/)).not.toBeInTheDocument();
  });

  it('drops a retry when staff pick another audience or cancel it', async () => {
    respond({ listAnnouncementSends: listResponse([{ ...SENT, retryCount: 1, retriedBy: null }]), previewAnnouncementEmail: PREVIEW });
    await renderLoaded();
    fireEvent.click(screen.getByRole('button', { name: 'Retry 1 failed address' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send to the whole audience instead' }));
    expect(screen.queryByText(/This email goes only to/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry 1 failed address' }));
    fireEvent.change(screen.getByLabelText('Audience'), { target: { value: 'registered' } });
    expect(screen.queryByText(/This email goes only to/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Preview email' }));
    await screen.findByRole('heading', { name: 'Preview' });
    expect(call.mock.calls.find(([name]) => name === 'previewAnnouncementEmail')[1]).not.toHaveProperty('retryOf');
  });

  it('continues a send that stopped part way', async () => {
    const partial = { ...SENT, id: 'send-part', status: 'sending', total: 400, processed: 200, counts: { sent: 200 }, failures: [] };
    let calls = 0;
    respond({
      listAnnouncementSends: () => listResponse(calls === 0 ? [partial] : [{ ...partial, status: 'sent', processed: 400, counts: { sent: 400 } }]),
      sendAnnouncementEmail: () => {
        calls += 1;
        return { send: { ...partial, status: 'sent', processed: 400, counts: { sent: 400 } } };
      },
    });
    await renderLoaded();
    expect(screen.getByText('Sent to 200 recipients of 400 addresses. 200 addresses are still to send.')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Continue sending' })); });
    expect(call).toHaveBeenCalledWith('sendAnnouncementEmail', { sendId: 'send-part' });
    await screen.findByText(/The send is complete/);
  });

  it('restores an unsubscribed address on request', async () => {
    respond({ listAnnouncementSends: listResponse([]), removeEmailSuppression: { removed: true } });
    await renderLoaded();
    fireEvent.change(screen.getByLabelText('Restore an unsubscribed address'), { target: { value: 'back@example.org' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Restore address' })); });
    expect(call).toHaveBeenCalledWith('removeEmailSuppression', { email: 'back@example.org' });
    expect(showToast).toHaveBeenCalledWith('This address gets announcement email again.');
  });

  it('says a restore also needs Postmark when Postmark handles unsubscribes', async () => {
    respond({
      listAnnouncementSends: listResponse([], { canSend: true, blocker: null, mode: 'provider' }),
      removeEmailSuppression: { removed: true },
    });
    await renderLoaded();
    expect(screen.getByText(/Postmark keeps its own list of addresses that unsubscribed/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Restore an unsubscribed address/), { target: { value: 'back@example.org' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Restore address' })); });
    expect(showToast).toHaveBeenCalledWith('This site no longer leaves the address out. Reactivate it on the broadcast stream in Postmark too.');
  });

  it('states every count it has and nothing it does not', () => {
    expect(countsSentence({ status: 'sent', total: 1, processed: 1, counts: { sent: 1 } }))
      .toBe('Sent to 1 recipient of 1 address.');
    expect(countsSentence({ status: 'sent', total: 5, processed: 5, counts: { sent: 1, uncertain: 1, skipped: 2, suppressed: 1 } }))
      .toBe('Sent to 1 recipient of 5 addresses. 1 message has an unknown result. 2 recipients were already handled by an earlier call. 1 address unsubscribed during the send.');
  });
});
