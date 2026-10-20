// The announcement email composer (issues #202, #203, #496, #497): compose,
// preview, test send, confirm with the count, chunked send, the paged
// history and its audited detail, reuse, saved messages, and the restore
// path. adminApi is mocked: the server contract is proven in
// functions/src/announcements/sends.test.cjs and messages.test.cjs.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

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

// A history row: a summary with no address and no message (issue #497).
const SENT = {
  id: 'send-old',
  status: 'sent',
  audience: 'speakers',
  audienceLabel: 'Speakers',
  subject: 'Speaker check-in moved',
  total: 3,
  processed: 3,
  counts: { sent: 2, failed: 1, uncertain: 0, skipped: 0, suppressed: 0 },
  auditGaps: 0,
  recipientRowsLinked: true,
  createdAt: Date.UTC(2026, 9, 1, 14, 0),
  createdBy: 'staff@example.org',
  busy: false,
};

// The same send from getAnnouncementSend: the frozen composition and the failures.
const DETAIL = {
  ...SENT,
  draft: {
    subject: 'Speaker check-in moved',
    message: 'Check in at the side door.',
    linkUrl: 'https://example.org/map',
    linkLabel: 'Open the map',
  },
  renderedSubject: 'Speaker check-in moved',
  html: '<!doctype html><html><body><p>Check in at the side door.</p></body></html>',
  text: 'Check in at the side door.\n\nUnsubscribe from announcements: https://site.example.org/unsubscribe?test=1',
  unsubscribeNote: 'Each recipient gets their own unsubscribe link at the end of the message.',
  failures: [{ email: 'gone@example.org', error: '406: Inactive recipient' }],
  failuresKept: 50,
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

function respond(given) {
  // Every composer lists its saved messages; a test that is not about them
  // gets an empty store.
  const handlers = { announcementMessages: { messages: [], max: 100 }, ...given };
  call.mockImplementation(async (name, body) => {
    const handler = handlers[name];
    if (!handler) throw new Error(`unexpected call ${name}`);
    return typeof handler === 'function' ? handler(body) : handler;
  });
}

const listResponse = (sends = [SENT], channel = { canSend: true, blocker: null, mode: 'app' }, nextCursor = null) => ({
  sends, nextCursor, audiences: AUDIENCES, channel,
});

async function renderLoaded() {
  render(<MemoryRouter><AnnouncementEmailComposer /></MemoryRouter>);
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

  it('lists the audiences from the server and the send history with counts, and no address', async () => {
    respond({ listAnnouncementSends: listResponse() });
    await renderLoaded();
    expect(screen.getByLabelText('Audience')).toHaveValue('registered');
    expect(screen.getByText('Approved attendees and people who claimed a ticket.')).toBeInTheDocument();

    expect(screen.getByText('Speaker check-in moved')).toBeInTheDocument();
    expect(screen.getByText('Sent', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('Sent to 2 recipients of 3 addresses. 1 message failed.')).toBeInTheDocument();
    expect(screen.getByText(/Speakers · Oct 1, 2026, 2:00 PM UTC · staff@example.org/)).toBeInTheDocument();
    expect(screen.queryByText('gone@example.org')).toBeNull();
    expect(screen.getByText(/keeps each send for 90 days/)).toBeInTheDocument();
  });

  it('opens the frozen content of a send and failures on request, with a link to its recipient rows', async () => {
    respond({ listAnnouncementSends: listResponse(), getAnnouncementSend: { send: DETAIL } });
    await renderLoaded();
    expect(call.mock.calls.filter(([name]) => name === 'getAnnouncementSend')).toHaveLength(0);
    const toggle = screen.getByRole('button', { name: 'Show details' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await act(async () => { fireEvent.click(toggle); });
    expect(call).toHaveBeenCalledWith('getAnnouncementSend', { id: 'send-old' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const region = screen.getByRole('region', { name: 'Speaker check-in moved: details' });
    expect(within(region).getByText(/the message as the send started it/i)).toBeInTheDocument();
    expect(within(region).getByTitle('Email preview')).toHaveAttribute('sandbox', '');
    expect(within(region).getByText('gone@example.org')).toBeInTheDocument();
    expect(within(region).getByText(/406: Inactive recipient/)).toBeInTheDocument();
    expect(within(region).getByRole('link', { name: 'Open the recipient messages in the email log' }))
      .toHaveAttribute('href', '/admin/email-log?send=send-old');

    // Closing and opening again reads once: the content is kept.
    fireEvent.click(toggle);
    expect(screen.queryByRole('region', { name: 'Speaker check-in moved: details' })).toBeNull();
    await act(async () => { fireEvent.click(toggle); });
    expect(call.mock.calls.filter(([name]) => name === 'getAnnouncementSend')).toHaveLength(1);
  });

  it('for a send from before rows carried the send id, says where its messages are and offers no filtered link', async () => {
    const legacy = { ...SENT, recipientRowsLinked: false };
    respond({ listAnnouncementSends: listResponse([legacy]), getAnnouncementSend: { send: { ...DETAIL, recipientRowsLinked: false } } });
    await renderLoaded();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show details' })); });
    const region = screen.getByRole('region', { name: 'Speaker check-in moved: details' });
    expect(within(region).queryByRole('link', { name: /email log/ })).toBeNull();
    expect(within(region).getByText('This send is older than the email log filter for one send. Its messages are in the email log under the source Announcement.')).toBeInTheDocument();
  });

  it('says when the email log could not record part of a send', async () => {
    respond({ listAnnouncementSends: listResponse([{ ...SENT, auditGaps: 2 }]) });
    await renderLoaded();
    expect(screen.getByText('The email log could not record 2 messages of this send. The counts come from the email provider, and nobody gets a second copy.')).toBeInTheDocument();
  });

  it('pages the history: Show older sends adds the next page and moves focus to it', async () => {
    const older = { ...SENT, id: 'send-older', subject: 'An older note' };
    respond({
      listAnnouncementSends: (body) => (body.cursor
        ? listResponse([older], undefined, null)
        : listResponse([SENT], undefined, { createdAt: SENT.createdAt, id: 'send-old' })),
    });
    await renderLoaded();
    expect(screen.queryByText('An older note')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show older sends' })); });
    expect(call).toHaveBeenCalledWith('listAnnouncementSends', { cursor: { createdAt: SENT.createdAt, id: 'send-old' } });
    expect(screen.getByText('Speaker check-in moved')).toBeInTheDocument();
    const added = screen.getByText('An older note').closest('li');
    await waitFor(() => expect(added).toHaveFocus());
    expect(screen.queryByRole('button', { name: 'Show older sends' })).toBeNull();
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

  it('loads a past send into the form with Use this message, through the audited detail', async () => {
    respond({ listAnnouncementSends: listResponse(), getAnnouncementSend: { send: DETAIL } });
    await renderLoaded();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Use this message' })); });
    expect(call).toHaveBeenCalledWith('getAnnouncementSend', { id: 'send-old' });
    expect(screen.getByLabelText('Audience')).toHaveValue('speakers');
    expect(screen.getByLabelText('Subject')).toHaveValue('Speaker check-in moved');
    expect(screen.getByLabelText('Subject')).toHaveFocus();
    expect(screen.getByLabelText('Email message')).toHaveValue('Check in at the side door.');
    expect(screen.getByLabelText('Button link (optional)')).toHaveValue('https://example.org/map');
    expect(screen.getByLabelText('Button label (optional)')).toHaveValue('Open the map');
  });

  it('says when the failed address list is cut short, and where the rest are', async () => {
    const counts = { sent: 100, failed: 280, uncertain: 20 };
    const many = { ...SENT, total: 400, counts };
    const failures = Array.from({ length: 50 }, (_, n) => ({ email: `f${n}@example.org`, error: '503: Unavailable' }));
    respond({ listAnnouncementSends: listResponse([many]), getAnnouncementSend: { send: { ...DETAIL, total: 400, counts, failures } } });
    await renderLoaded();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show details' })); });
    expect(screen.getByText('Failed addresses (first 50 of 300)')).toBeInTheDocument();
    expect(screen.getByText(/The email log has every recipient message of this send\./)).toBeInTheDocument();
  });

  it('retries the failed addresses of a send as a new previewed send, once', async () => {
    const failed = { ...SENT, retryCount: 2, retriedBy: null };
    respond({
      listAnnouncementSends: listResponse([failed, { ...SENT, id: 'send-done', subject: 'Already retried', retryCount: 1, retriedBy: 'send-later' }]),
      getAnnouncementSend: { send: { ...DETAIL, retryCount: 2, retriedBy: null } },
      previewAnnouncementEmail: { ...PREVIEW, audience: 'speakers', audienceLabel: 'Speakers', recipientCount: 2, retryOf: 'send-old' },
      sendAnnouncementEmail: { send: { ...SENT, id: 'send-new-1', total: 2, processed: 2, counts: { sent: 2 }, failures: [], retryOf: 'send-old' } },
    });
    await renderLoaded();
    // One retry per send: the row that was retried offers none.
    expect(screen.getAllByRole('button', { name: /Retry .* failed addresses?/ })).toHaveLength(1);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry 2 failed addresses' })); });
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
    respond({
      listAnnouncementSends: listResponse([{ ...SENT, retryCount: 1, retriedBy: null }]),
      getAnnouncementSend: { send: DETAIL },
      previewAnnouncementEmail: PREVIEW,
    });
    await renderLoaded();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry 1 failed address' })); });
    fireEvent.click(screen.getByRole('button', { name: 'Send to the whole audience instead' }));
    expect(screen.queryByText(/This email goes only to/)).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry 1 failed address' })); });
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

  it('marks a scheduled reminder send, offers no continue for it, and names a stopped send', async () => {
    const scheduled = {
      ...SENT,
      id: 'reminder-attendees-2026-12-01-7d',
      status: 'sending',
      audience: 'registered',
      audienceLabel: 'Registered attendees',
      subject: 'Your event is 7 days away',
      total: 400,
      processed: 200,
      counts: { sent: 200 },
      failures: [],
      createdBy: null,
      scheduled: true,
    };
    const stopped = { ...scheduled, id: 'reminder-attendees-2026-12-01-1d', status: 'stopped', subject: 'Your event is 1 day away' };
    respond({ listAnnouncementSends: listResponse([scheduled, stopped]) });
    await renderLoaded();
    const rows = screen.getAllByRole('listitem').filter((row) => within(row).queryByText(/Your event is/));
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText(/Scheduled attendee reminder/)).toBeInTheDocument();
    expect(within(rows[0]).getByText(/The schedule sends the rest in its next hourly run\./)).toBeInTheDocument();
    expect(within(rows[0]).queryByRole('button', { name: 'Continue sending' })).toBeNull();
    expect(within(rows[1]).getByText('Stopped')).toBeInTheDocument();
    expect(within(rows[1]).getByText(/200 addresses were not sent\./)).toBeInTheDocument();
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

// --- Saved messages (issue #496) ---------------------------------------------

const SAVED = [
  { id: 'msg-aaaa-1111', name: 'Weekly note', subject: 'This week', updatedAt: Date.UTC(2026, 9, 2, 9, 0) },
  { id: 'msg-bbbb-2222', name: 'Weekly note', subject: 'Last week', updatedAt: Date.UTC(2026, 9, 1, 9, 0) },
];
const LOADED = {
  id: 'msg-aaaa-1111',
  name: 'Weekly note',
  updatedAt: SAVED[0].updatedAt,
  draft: { subject: 'This week', message: 'Doors open at nine.', linkUrl: 'https://example.org/schedule', linkLabel: 'Read the schedule' },
};

/** A store the mocked endpoint keeps, so a save or rename shows in the list. */
function savedStore(initial = SAVED) {
  let messages = initial.map((m) => ({ ...m }));
  return (body) => {
    if (body.action === 'list') return { messages, max: 100 };
    if (body.action === 'load') return { message: { ...LOADED, id: body.id } };
    if (body.action === 'save') {
      const saved = { id: body.id ?? 'msg-new-0001', name: body.name, subject: body.draft.subject, updatedAt: Date.UTC(2026, 9, 3, 9, 0) };
      messages = [saved, ...messages.filter((m) => m.id !== saved.id)];
      return { message: saved };
    }
    if (body.action === 'rename') {
      messages = messages.map((m) => (m.id === body.id ? { ...m, name: body.name } : m));
      return { message: messages.find((m) => m.id === body.id) };
    }
    if (body.action === 'remove') {
      messages = messages.filter((m) => m.id !== body.id);
      return { removed: body.id };
    }
    throw new Error(`unexpected action ${body.action}`);
  };
}

const savedPanel = () => screen.getByRole('heading', { level: 2, name: 'Saved messages' }).closest('section');
const savedRow = (subject) => within(savedPanel()).getByText(subject).closest('li');
const actionsOf = (name) => call.mock.calls.filter(([n, body]) => n === 'announcementMessages' && body.action === name);

describe('AnnouncementEmailComposer saved messages', () => {
  beforeEach(() => {
    call.mockReset();
    showToast.mockReset();
  });

  it('lists saved messages with their names and when each changed, and says when there are none', async () => {
    respond({ listAnnouncementSends: listResponse([]), announcementMessages: savedStore() });
    await renderLoaded();
    await within(savedPanel()).findByText('This week');
    // Two messages may share a name; the time tells them apart.
    expect(within(savedPanel()).getAllByText('Weekly note')).toHaveLength(2);
    expect(within(savedRow('This week')).getByText(/Changed Oct 2, 2026, 9:00 AM UTC/)).toBeInTheDocument();
    expect(within(savedRow('Last week')).getByText(/Changed Oct 1, 2026, 9:00 AM UTC/)).toBeInTheDocument();
  });

  it('shows the empty state with no saved messages', async () => {
    respond({ listAnnouncementSends: listResponse([]), announcementMessages: savedStore([]) });
    await renderLoaded();
    expect(await within(savedPanel()).findByText('No saved messages yet. Write a message, name it, then save it.')).toBeInTheDocument();
  });

  it('saves the draft as a new message under a name, and sends nothing', async () => {
    respond({ listAnnouncementSends: listResponse([]), announcementMessages: savedStore([]) });
    await renderLoaded();
    fillDraft();
    fireEvent.change(screen.getByLabelText('Name for this message'), { target: { value: 'Doors note' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save as a new message' })); });
    expect(actionsOf('save')[0][1]).toEqual({
      action: 'save',
      name: 'Doors note',
      draft: { subject: 'Doors open at nine', message: 'Doors open at nine.' },
    });
    expect(await within(savedPanel()).findByText('Doors note')).toBeInTheDocument();
    expect(showToast).toHaveBeenCalledWith('Saved "Doors note".');
    expect(call.mock.calls.some(([name]) => /^(previewAnnouncementEmail|sendAnnouncement)/.test(name))).toBe(false);
  });

  it('loads a saved message into an empty draft, keeps the audience, and focuses the subject', async () => {
    respond({ listAnnouncementSends: listResponse([]), announcementMessages: savedStore() });
    await renderLoaded();
    fireEvent.change(screen.getByLabelText('Audience'), { target: { value: 'speakers' } });
    await within(savedPanel()).findByText('This week');
    await act(async () => { fireEvent.click(within(savedRow('This week')).getByRole('button', { name: 'Load' })); });
    expect(actionsOf('load')[0][1]).toEqual({ action: 'load', id: 'msg-aaaa-1111' });
    expect(screen.getByLabelText('Subject')).toHaveValue('This week');
    expect(screen.getByLabelText('Email message')).toHaveValue('Doors open at nine.');
    expect(screen.getByLabelText('Button link (optional)')).toHaveValue('https://example.org/schedule');
    expect(screen.getByLabelText('Audience')).toHaveValue('speakers');
    await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveFocus());
    expect(screen.getByText('Loaded from "Weekly note". Changes here do not change the saved message until you update it.')).toBeInTheDocument();
  });

  it('asks before it replaces a draft with edits; cancel keeps the draft, replace drops the preview', async () => {
    respond({ listAnnouncementSends: listResponse([]), previewAnnouncementEmail: PREVIEW, announcementMessages: savedStore() });
    await renderLoaded();
    await within(savedPanel()).findByText('This week');
    fillDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Preview email' }));
    await screen.findByRole('heading', { name: 'Preview' });

    const load = within(savedRow('This week')).getByRole('button', { name: 'Load' });
    fireEvent.click(load);
    const ask = await screen.findByRole('heading', { name: 'Replace your draft with "Weekly note"?' });
    await waitFor(() => expect(ask).toHaveFocus());
    expect(actionsOf('load')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Keep my draft' }));
    expect(screen.queryByRole('heading', { name: /Replace your draft/ })).toBeNull();
    expect(screen.getByLabelText('Subject')).toHaveValue('Doors open at nine');
    expect(screen.getByRole('heading', { name: 'Preview' })).toBeInTheDocument();
    await waitFor(() => expect(within(savedRow('This week')).getByRole('button', { name: 'Load' })).toHaveFocus());

    fireEvent.click(within(savedRow('This week')).getByRole('button', { name: 'Load' }));
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Replace draft' })); });
    expect(screen.getByLabelText('Subject')).toHaveValue('This week');
    // The old preview and its confirmation are gone; nothing was sent.
    expect(screen.queryByRole('heading', { name: 'Preview' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Send to/ })).toBeNull();
    expect(call.mock.calls.filter(([name]) => name === 'sendAnnouncementEmail')).toHaveLength(0);
  });

  it('asks before a load when a loaded message was cleared: an empty form is still a change', async () => {
    respond({ listAnnouncementSends: listResponse([]), announcementMessages: savedStore() });
    await renderLoaded();
    await within(savedPanel()).findByText('This week');
    await act(async () => { fireEvent.click(within(savedRow('This week')).getByRole('button', { name: 'Load' })); });
    for (const label of ['Subject', 'Email message', 'Button link (optional)', 'Button label (optional)']) {
      fireEvent.change(screen.getByLabelText(label), { target: { value: '' } });
    }
    fireEvent.click(within(savedRow('Last week')).getByRole('button', { name: 'Load' }));
    expect(await screen.findByRole('heading', { name: 'Replace your draft with "Weekly note"?' })).toBeInTheDocument();
    expect(actionsOf('load')).toHaveLength(1);
  });

  it('updates the loaded message by its id, and renames one of two with the same name', async () => {
    respond({ listAnnouncementSends: listResponse([]), announcementMessages: savedStore() });
    await renderLoaded();
    await within(savedPanel()).findByText('This week');
    await act(async () => { fireEvent.click(within(savedRow('This week')).getByRole('button', { name: 'Load' })); });
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'This week, changed' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Update "Weekly note"' })); });
    expect(actionsOf('save')[0][1]).toMatchObject({ action: 'save', id: 'msg-aaaa-1111', name: 'Weekly note' });
    expect(actionsOf('save')[0][1].draft.subject).toBe('This week, changed');

    const other = savedRow('Last week');
    fireEvent.click(within(other).getByRole('button', { name: 'Rename' }));
    const field = within(savedRow('Last week')).getByLabelText('New name');
    await waitFor(() => expect(field).toHaveFocus());
    expect(field).toHaveValue('Weekly note');
    fireEvent.change(field, { target: { value: 'Old weekly note' } });
    await act(async () => { fireEvent.click(within(savedRow('Last week')).getByRole('button', { name: 'Save name' })); });
    expect(actionsOf('rename')[0][1]).toEqual({ action: 'rename', id: 'msg-bbbb-2222', name: 'Old weekly note' });
    expect(within(savedRow('Last week')).getByText('Old weekly note')).toBeInTheDocument();
    await waitFor(() => expect(within(savedRow('Last week')).getByRole('button', { name: 'Rename' })).toHaveFocus());
  });

  it('removes a saved message after a confirmation, and the loaded copy stays in the form', async () => {
    respond({ listAnnouncementSends: listResponse([]), announcementMessages: savedStore() });
    await renderLoaded();
    await within(savedPanel()).findByText('This week');
    await act(async () => { fireEvent.click(within(savedRow('This week')).getByRole('button', { name: 'Load' })); });
    fireEvent.click(within(savedRow('This week')).getByRole('button', { name: 'Remove' }));
    await act(async () => { fireEvent.click(within(savedPanel()).getByRole('button', { name: 'Remove "Weekly note"' })); });
    expect(actionsOf('remove')[0][1]).toEqual({ action: 'remove', id: 'msg-aaaa-1111' });
    expect(within(savedPanel()).queryByText('This week')).toBeNull();
    expect(screen.getByLabelText('Subject')).toHaveValue('This week');
    // The copy has no saved message to update any more.
    expect(screen.queryByRole('button', { name: /^Update "/ })).toBeNull();
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Saved messages' })).toHaveFocus());
  });

  it('shows a refusal from the server next to the save', async () => {
    const refused = Object.assign(new Error('Invalid message: name: must contain text'), {
      code: 'bad-request', fieldErrors: [{ field: 'name', message: 'must contain text' }],
    });
    respond({
      listAnnouncementSends: listResponse([]),
      announcementMessages: (body) => { if (body.action === 'save') throw refused; return savedStore([])(body); },
    });
    await renderLoaded();
    fillDraft();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save as a new message' })); });
    const alert = within(savedPanel()).getByRole('alert');
    expect(alert).toHaveTextContent('Invalid message: name: must contain text');
  });
});
