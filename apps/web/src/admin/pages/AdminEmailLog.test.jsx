// The email log page (issue #183). Mocks adminApi directly, the convention
// AdminAccess.test.jsx and AdminAttendees.test.jsx follow: sent_emails is
// server-only, so the page has no listener, only listSentEmails and
// getSentEmail calls. A location probe beside the page reads what the router
// holds, because the search text must never reach it.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const callMock = vi.fn();
vi.mock('../adminApi.js', () => ({ useAdminApi: () => callMock }));
// The real document builder, except for one body this test marks unsafe, so
// the page's plain-text fallback can be driven without a parser quirk.
const UNSAFE_BODY = '<p>Marked unsafe by this test.</p>';
vi.mock('../emailPreview.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, buildPreviewDoc: (html) => (html === UNSAFE_BODY ? null : actual.buildPreviewDoc(html)) };
});
vi.mock('../../contexts/EventConfigContext.jsx', () => ({
  useEventConfig: () => ({ eventConfig: { timezone: 'UTC' } }),
}));

import AdminEmailLog, { figureSentence } from './AdminEmailLog.jsx';
import { PREVIEW_POLICY } from '../emailPreview.js';

const SENT_AT = Date.UTC(2023, 10, 14, 22, 13);

function message(overrides = {}) {
  return {
    id: 'm1',
    sentAt: SENT_AT,
    to: 'reader@example.test',
    from: 'desk@example.test',
    subject: 'Your speaker confirmation',
    templateId: 'speaker.confirmation',
    source: 'speaker-confirmation',
    status: 'sent',
    deliveryStatus: null,
    deliveryUpdatedAt: null,
    bounceReason: null,
    error: null,
    retries: 0,
    bodyStored: true,
    bodyTruncated: false,
    ...overrides,
  };
}

const ROWS = [
  message({ id: 'plain', to: 'plain@example.test', subject: 'Welcome' }),
  message({ id: 'code', to: 'code@example.test', subject: null, source: 'auth-otp', templateId: 'auth.otp', bodyStored: false }),
  message({ id: 'bounced', to: 'bounced@example.test', deliveryStatus: 'bounced', bounceReason: 'Mailbox <full>' }),
  message({ id: 'failed', to: null, status: 'failed', error: 'no recipient', source: 'future-sender' }),
  message({ id: 'delivered', to: 'delivered@example.test', deliveryStatus: 'delivered', source: 'feedback' }),
];

function serverError(status, code, text) {
  const error = new Error(text);
  error.status = status;
  error.code = code;
  return error;
}

/**
 * listSentEmails answers each entry of `lists` in turn (the last repeats);
 * an Error entry is thrown, and a null entry hangs. getSentEmail answers
 * from `details` by id.
 */
function serve({ lists = [{ rows: ROWS, nextCursor: null, scanned: ROWS.length }], details = {} } = {}) {
  let n = 0;
  callMock.mockImplementation((name, body) => {
    if (name === 'listSentEmails') {
      const answer = lists[Math.min(n, lists.length - 1)];
      n += 1;
      if (answer === null) return new Promise(() => {});
      if (answer instanceof Error) return Promise.reject(answer);
      return Promise.resolve(answer);
    }
    if (name === 'getSentEmail') {
      const answer = details[body.id];
      if (answer instanceof Error) return Promise.reject(answer);
      return Promise.resolve({ row: answer });
    }
    return Promise.reject(new Error(`unexpected call ${name}`));
  });
}

const listCalls = () => callMock.mock.calls.filter(([name]) => name === 'listSentEmails').map(([, body]) => body);
const getCalls = () => callMock.mock.calls.filter(([name]) => name === 'getSentEmail').map(([, body]) => body);

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{`${location.pathname}${location.search}`}</p>;
}

async function renderPage(path = '/admin/email-log', options) {
  serve(options);
  const result = render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route
          path="/admin/email-log"
          element={(
            <>
              <AdminEmailLog />
              <LocationProbe />
            </>
          )}
        />
        <Route path="/signin" element={<p>Sign-in page</p>} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.queryByLabelText('Loading the email log…')).toBeNull());
  return result;
}

const searchField = () => screen.getByRole('searchbox', { name: 'Search recipient or subject' });
const location = () => screen.getByTestId('location').textContent;
const rowOf = (text) => screen.getByText(text).closest('tr');

beforeEach(() => {
  callMock.mockReset();
});

describe('AdminEmailLog', () => {
  it('lists the messages in a ruled table with the figure sentence, and every state is a word', async () => {
    await renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Email log' })).toBeInTheDocument();
    expect(listCalls()).toEqual([{ limit: 25 }]);

    const region = screen.getByRole('region', { name: 'Sent messages' });
    expect(region).toHaveAttribute('tabindex', '0');
    const table = within(region).getByRole('table', { name: 'Sent messages, newest first' });
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      'Sent', 'To', 'Subject', 'Source', 'Status', 'Preview',
    ]);

    expect(screen.getByRole('status').textContent).toMatch(
      /^5 messages shown, newest first, read at \d{1,2}:\d{2} (AM|PM) UTC\.$/,
    );

    // The event clock and its zone, in the data face.
    const sent = within(rowOf('plain@example.test')).getByText('Nov 14, 2023, 10:13 PM UTC');
    expect(sent.tagName).toBe('TIME');
    expect(sent).toHaveAttribute('datetime', new Date(SENT_AT).toISOString());

    // A code email: its label, and its subject not stored.
    const code = rowOf('code@example.test');
    expect(within(code).getByText('Sign-in code')).toBeInTheDocument();
    expect(within(code).getByText('Not stored')).toBeInTheDocument();

    // States are words: the quiet "Sent", and badges that carry a word.
    expect(within(rowOf('plain@example.test')).getByText('Sent')).toBeInTheDocument();
    expect(within(rowOf('bounced@example.test')).getByText('Bounced')).toBeInTheDocument();
    // Markup in a stored field is text, never HTML.
    expect(within(rowOf('bounced@example.test')).getByText('Mailbox <full>')).toBeInTheDocument();
    const failed = rowOf('No recipient');
    expect(within(failed).getByText('Failed')).toBeInTheDocument();
    expect(within(failed).getByText('no recipient')).toBeInTheDocument();
    // An unknown source shows its id in the data face.
    expect(within(failed).getByText('future-sender').className).toContain('font-admin-data');
    expect(within(rowOf('delivered@example.test')).getByText('Delivered')).toBeInTheDocument();
    expect(within(rowOf('delivered@example.test')).getByText('Feedback receipt')).toBeInTheDocument();
  });

  it('sends the search and both filters, keeps the filters in the URL and the search out of it', async () => {
    await renderPage('/admin/email-log', {
      lists: [
        { rows: ROWS, nextCursor: null, scanned: 5 },
        { rows: [ROWS[0]], nextCursor: null, scanned: 5 },
      ],
    });

    fireEvent.change(searchField(), { target: { value: '  reader@example.test ' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Source' }), { target: { value: 'auth-otp' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'failed' } });
    expect(screen.getByRole('group', { name: 'Filters, 2 active' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(listCalls()).toHaveLength(2));
    expect(listCalls()[1]).toEqual({ limit: 25, q: 'reader@example.test', source: 'auth-otp', status: 'failed' });
    await waitFor(() => expect(location()).toBe('/admin/email-log?source=auth-otp&status=failed'));
    expect(location()).not.toMatch(/q=|reader|example/);
    expect(await screen.findByText(/^1 match in the 5 most recent messages, read at /)).toBeInTheDocument();
    // The search field asks the browser not to remember what was typed.
    expect(searchField()).toHaveAttribute('autocomplete', 'off');
  });

  it('sends the URL’s filters on the first request, and Clear removes them and focuses the search field', async () => {
    await renderPage('/admin/email-log?source=feedback&status=sent');
    expect(listCalls()[0]).toEqual({ limit: 25, source: 'feedback', status: 'sent' });
    expect(screen.getByRole('combobox', { name: 'Source' })).toHaveValue('feedback');
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('sent');
    expect(screen.getByRole('group', { name: 'Filters, 2 active' })).toBeInTheDocument();

    fireEvent.change(searchField(), { target: { value: 'kim' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(document.activeElement).toBe(searchField());
    expect(searchField()).toHaveValue('');
    await waitFor(() => expect(listCalls()).toHaveLength(2));
    expect(listCalls()[1]).toEqual({ limit: 25 });
    await waitFor(() => expect(location()).toBe('/admin/email-log'));
    expect(screen.getByRole('group', { name: 'Filters' })).toBeInTheDocument();
  });

  it('ignores a URL filter the server would refuse, or one that names an object key instead of a source or a status', async () => {
    for (const search of [
      '?source=Not%20A%20Source&status=bounced',
      '?status=constructor',
      '?source=constructor',
      '?source=__proto__&status=toString',
      '?source=hasOwnProperty&status=valueOf',
    ]) {
      callMock.mockReset();
      const { unmount } = await renderPage(`/admin/email-log${search}`);
      expect(listCalls()[0], search).toEqual({ limit: 25 });
      expect(screen.getByRole('combobox', { name: 'Source' })).toHaveValue('');
      expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('');
      expect(screen.getByRole('group', { name: 'Filters' })).toBeInTheDocument();
      expect(screen.queryByText(/function|native code/)).toBeNull();
      unmount();
    }
  });

  it('says what Complained and Suppressed mean under the word', async () => {
    await renderPage('/admin/email-log', {
      lists: [{
        rows: [
          message({ id: 'spam', to: 'spam@example.test', deliveryStatus: 'complained' }),
          message({ id: 'blocked', to: 'blocked@example.test', deliveryStatus: 'suppressed', bounceReason: 'Previously bounced' }),
        ],
        nextCursor: null,
        scanned: 2,
      }],
    });
    const spam = rowOf('spam@example.test');
    expect(within(spam).getByText('Complained')).toBeInTheDocument();
    expect(within(spam).getByText('The recipient marked it as spam.')).toBeInTheDocument();
    const blocked = rowOf('blocked@example.test');
    expect(within(blocked).getByText('Suppressed')).toBeInTheDocument();
    expect(within(blocked).getByText('The mail provider did not send it, because the address is on its block list.')).toBeInTheDocument();
    expect(within(blocked).getByText('Previously bounced')).toBeInTheDocument();
  });

  it('shows a source or a delivery state it does not know as data, never as an object key’s value', async () => {
    await renderPage('/admin/email-log', {
      lists: [{
        rows: [message({ id: 'odd', to: 'odd@example.test', source: 'constructor', deliveryStatus: 'toString' })],
        nextCursor: null,
        scanned: 1,
      }],
    });
    const odd = rowOf('odd@example.test');
    expect(within(odd).getByText('constructor').className).toContain('font-admin-data');
    expect(within(odd).getByText('Sent')).toBeInTheDocument();
    expect(odd.textContent).not.toMatch(/function|native code/);
  });

  it('names the query and the filters in the filtered empty state, with one action that clears and focuses the field', async () => {
    await renderPage('/admin/email-log', {
      lists: [
        { rows: ROWS, nextCursor: null, scanned: 5 },
        { rows: [], nextCursor: null, scanned: 5 },
        { rows: ROWS, nextCursor: null, scanned: 5 },
      ],
    });
    fireEvent.change(searchField(), { target: { value: 'alex' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Source' }), { target: { value: 'auth-otp' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    const heading = await screen.findByRole('heading', { name: 'No matching messages' });
    const empty = heading.parentElement;
    expect(empty.textContent).toContain('Nothing in the log matches “alex” and the source Sign-in code.');
    expect(within(empty).getAllByRole('button').map((b) => b.textContent)).toEqual(['Clear search']);
    expect(screen.getByRole('status').textContent).toMatch(/^No matches in the 5 most recent messages/);

    fireEvent.click(within(empty).getByRole('button', { name: 'Clear search' }));
    expect(document.activeElement).toBe(searchField());
    await waitFor(() => expect(listCalls()).toHaveLength(3));
    expect(listCalls()[2]).toEqual({ limit: 25 });
    expect(await screen.findByText('plain@example.test')).toBeInTheDocument();
  });

  it('says a search window came up empty and offers to search older messages', async () => {
    const cursor = { sentAt: 1000, id: 'm500' };
    await renderPage('/admin/email-log', {
      lists: [
        { rows: ROWS, nextCursor: null, scanned: 5 },
        { rows: [], nextCursor: cursor, scanned: 500 },
        { rows: [ROWS[0]], nextCursor: null, scanned: 20 },
      ],
    });
    fireEvent.change(searchField(), { target: { value: 'nobody' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByRole('heading', { name: 'No match in the 500 most recent messages' })).toBeInTheDocument();
    const older = screen.getByRole('button', { name: 'Search older messages' });
    fireEvent.click(older);
    await waitFor(() => expect(listCalls()).toHaveLength(3));
    expect(listCalls()[2]).toEqual({ limit: 25, q: 'nobody', cursor });
    expect(await screen.findByText(/^1 match in the 520 most recent messages/)).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(within(rowOf('plain@example.test')).getByRole('button', { name: 'Preview' })));
  });

  it('shows the first-run empty state when nothing was ever sent', async () => {
    await renderPage('/admin/email-log', { lists: [{ rows: [], nextCursor: null, scanned: 0 }] });
    expect(screen.getByRole('heading', { name: 'No email sent yet' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Load more|Search older/ })).toBeNull();
  });

  it('Load more sends the cursor, appends, and moves focus to the first new Preview', async () => {
    const cursor = { sentAt: SENT_AT, id: 'delivered' };
    const older = message({ id: 'older', to: 'older@example.test' });
    await renderPage('/admin/email-log', {
      lists: [
        { rows: ROWS, nextCursor: cursor, scanned: 5 },
        { rows: [older], nextCursor: null, scanned: 1 },
      ],
    });
    const more = screen.getByRole('button', { name: 'Load more' });
    more.focus();
    fireEvent.click(more);

    await waitFor(() => expect(listCalls()).toHaveLength(2));
    expect(listCalls()[1]).toEqual({ limit: 25, cursor });
    const newPreview = await waitFor(() => within(rowOf('older@example.test')).getByRole('button', { name: 'Preview' }));
    // All six rows are on screen, and the pager left: focus did not.
    expect(screen.getAllByRole('button', { name: 'Preview' })).toHaveLength(6);
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(newPreview));
    expect(screen.getByText(/^6 messages shown/)).toBeInTheDocument();
  });

  describe('while a search is running', () => {
    const FEEDBACK_ROW = message({ id: 'fb', to: 'feedback-row@example.test', source: 'feedback' });
    const OLDER_ROW = message({ id: 'older', to: 'older@example.test' });
    const cursor = { sentAt: SENT_AT, id: 'delivered' };

    /**
     * The first read answers at once with a next page. Every later read is
     * held until the test releases it, and answers by what it asked for:
     * the feedback filter gets the feedback row, a page after the cursor
     * gets the older row, and anything else gets the first rows again.
     */
    function serveHeld() {
      const held = [];
      callMock.mockImplementation((name, body) => {
        if (name !== 'listSentEmails') return Promise.reject(new Error(`unexpected call ${name}`));
        if (held.length === 0 && callMock.mock.calls.length === 1) {
          return Promise.resolve({ rows: ROWS, nextCursor: cursor, scanned: 5 });
        }
        let answer;
        if (body.source === 'feedback') answer = { rows: [FEEDBACK_ROW], nextCursor: null, scanned: 1 };
        else if (body.cursor) answer = { rows: [OLDER_ROW], nextCursor: null, scanned: 1 };
        else answer = { rows: ROWS, nextCursor: cursor, scanned: 5 };
        return new Promise((resolve) => held.push(() => resolve(answer)));
      });
      return held;
    }

    async function startFeedbackSearch() {
      const held = serveHeld();
      render(
        <MemoryRouter initialEntries={['/admin/email-log']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes>
            <Route path="/admin/email-log" element={<><AdminEmailLog /><LocationProbe /></>} />
          </Routes>
        </MemoryRouter>,
      );
      await screen.findByText('plain@example.test');
      fireEvent.change(screen.getByRole('combobox', { name: 'Source' }), { target: { value: 'feedback' } });
      fireEvent.click(screen.getByRole('button', { name: 'Search' }));
      await waitFor(() => expect(listCalls()).toHaveLength(2));
      return held;
    }

    async function releaseAll(held) {
      await act(async () => {
        for (const release of held) release();
        await Promise.resolve();
      });
    }

    it('refuses Load more until the search answers, so the new search’s rows win and match the URL', async () => {
      const held = await startFeedbackSearch();
      const more = screen.getByRole('button', { name: 'Load more' });
      expect(more).toHaveAttribute('aria-disabled', 'true');
      fireEvent.click(more);
      await releaseAll(held);

      expect(await screen.findByText('feedback-row@example.test')).toBeInTheDocument();
      expect(listCalls()).toEqual([{ limit: 25 }, { limit: 25, source: 'feedback' }]);
      expect(screen.queryByText('older@example.test')).toBeNull();
      expect(screen.queryByText('plain@example.test')).toBeNull();
      expect(location()).toBe('/admin/email-log?source=feedback');
      expect(screen.getByRole('combobox', { name: 'Source' })).toHaveValue('feedback');
      expect(screen.getByRole('status')).toHaveTextContent(/^1 message shown/);
    });

    it('refreshes the search that is running, not the rows it will replace', async () => {
      const held = await startFeedbackSearch();
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
      await waitFor(() => expect(listCalls()).toHaveLength(3));
      expect(listCalls()[2]).toEqual({ limit: 25, source: 'feedback' });
      await releaseAll(held);

      expect(await screen.findByText('feedback-row@example.test')).toBeInTheDocument();
      expect(screen.queryByText('plain@example.test')).toBeNull();
      expect(location()).toBe('/admin/email-log?source=feedback');
    });
  });

  it('opens a preview in an empty sandbox under the content policy, and reads each body once', async () => {
    await renderPage('/admin/email-log', {
      details: {
        plain: { ...message({ id: 'plain', to: 'plain@example.test' }), html: '<p>Hello there.</p>', text: 'Hello there.', providerMessageId: 'pm', providerStatus: 200 },
      },
    });
    const button = within(rowOf('plain@example.test')).getByRole('button', { name: 'Preview' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    button.focus();
    fireEvent.click(button);

    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveTextContent('Hide preview');
    expect(document.activeElement).toBe(button);
    const openRow = document.getElementById(button.getAttribute('aria-controls'));
    expect(openRow).not.toBeNull();

    const frame = await waitFor(() => {
      const found = openRow.querySelector('iframe');
      expect(found).not.toBeNull();
      return found;
    });
    expect(getCalls()).toEqual([{ id: 'plain' }]);

    // The real attributes the browser reads.
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame.getAttribute('title')).toBe('Message to plain@example.test');
    const framed = new DOMParser().parseFromString(frame.getAttribute('srcdoc'), 'text/html');
    const policy = framed.head.firstElementChild;
    expect(policy.getAttribute('http-equiv')).toBe('Content-Security-Policy');
    expect(policy.getAttribute('content')).toBe(PREVIEW_POLICY);
    expect(framed.body.innerHTML).toBe('<p>Hello there.</p>');
    expect(within(openRow).getByText('Links and remote images are turned off in this preview.')).toBeInTheDocument();
    // The plain text sits closed under the frame, as React text.
    const summary = within(openRow).getByText('Plain text version');
    expect(summary.closest('details').open).toBe(false);
    expect(summary.closest('details').querySelector('pre').textContent).toBe('Hello there.');

    // Close and reopen: no second call.
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById(button.getAttribute('aria-controls'))).toBeNull();
    fireEvent.click(button);
    expect(await within(document.getElementById(button.getAttribute('aria-controls'))).findByTitle('Message to plain@example.test')).toBeInTheDocument();
    expect(getCalls()).toHaveLength(1);
  });

  it('opens one preview at a time', async () => {
    await renderPage('/admin/email-log', {
      details: {
        plain: { ...message({ id: 'plain' }), html: '<p>One.</p>', text: null },
        bounced: { ...message({ id: 'bounced' }), html: '<p>Two.</p>', text: null },
      },
    });
    const first = within(rowOf('plain@example.test')).getByRole('button', { name: 'Preview' });
    const second = within(rowOf('bounced@example.test')).getByRole('button', { name: 'Preview' });
    fireEvent.click(first);
    fireEvent.click(second);
    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(second).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(document.querySelectorAll('iframe')).toHaveLength(1));
  });

  it('says "Loading the message…" while the body is read', async () => {
    await renderPage();
    callMock.mockImplementation(() => new Promise(() => {}));
    fireEvent.click(within(rowOf('plain@example.test')).getByRole('button', { name: 'Preview' }));
    const loading = screen.getByText('Loading the message…');
    expect(loading).toHaveAttribute('aria-busy', 'true');
  });

  it('opens a row whose body was never stored to the reason, with no frame and no call', async () => {
    await renderPage();
    const button = within(rowOf('code@example.test')).getByRole('button', { name: 'Preview' });
    fireEvent.click(button);
    const openRow = document.getElementById(button.getAttribute('aria-controls'));
    expect(within(openRow).getByText(
      'This message’s body was not stored because it held a sign-in code or an invitation link.',
    )).toBeInTheDocument();
    expect(document.querySelector('iframe')).toBeNull();
    expect(getCalls()).toEqual([]);
  });

  it('shows a text-only body open with no frame, and says when a body was cut', async () => {
    await renderPage('/admin/email-log', {
      details: { plain: { ...message({ id: 'plain' }), html: null, text: 'Only <text>.', bodyTruncated: true } },
    });
    fireEvent.click(within(rowOf('plain@example.test')).getByRole('button', { name: 'Preview' }));
    const summary = await screen.findByText('Plain text version');
    expect(summary.closest('details').open).toBe(true);
    expect(screen.getByText('Only <text>.')).toBeInTheDocument();
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.getByText('The stored body stops at 100 KB.')).toBeInTheDocument();
  });

  it('shows the plain text, and no frame, when the stored HTML cannot be shown safely', async () => {
    await renderPage('/admin/email-log', {
      details: {
        plain: { ...message({ id: 'plain' }), html: UNSAFE_BODY, text: 'The plain words.' },
        bounced: { ...message({ id: 'bounced' }), html: UNSAFE_BODY, text: null },
      },
    });
    fireEvent.click(within(rowOf('plain@example.test')).getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText('This message’s HTML cannot be shown safely, so its plain text version is shown instead.')).toBeInTheDocument();
    expect(document.querySelector('iframe')).toBeNull();
    const summary = screen.getByText('Plain text version');
    expect(summary.closest('details').open).toBe(true);
    expect(screen.getByText('The plain words.')).toBeInTheDocument();
    expect(screen.queryByText('Links and remote images are turned off in this preview.')).toBeNull();

    fireEvent.click(within(rowOf('bounced@example.test')).getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText('This message’s HTML cannot be shown safely, and it has no plain text version.')).toBeInTheDocument();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('shows a preview error inside the row', async () => {
    await renderPage('/admin/email-log', {
      details: { plain: serverError(404, 'not-found', 'This message is not in the email log.') },
    });
    const button = within(rowOf('plain@example.test')).getByRole('button', { name: 'Preview' });
    fireEvent.click(button);
    const openRow = document.getElementById(button.getAttribute('aria-controls'));
    expect(await within(openRow).findByRole('alert')).toHaveTextContent('This message is not in the email log.');
  });

  it('reads "Searching…" with aria-busy while a search runs, and never disables the button first', async () => {
    await renderPage('/admin/email-log', { lists: [{ rows: ROWS, nextCursor: null, scanned: 5 }, null] });
    const button = screen.getByRole('button', { name: 'Search' });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(button).toHaveTextContent('Searching…');
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).not.toBeDisabled();
    // The rows stay while the search runs.
    expect(screen.getByText('plain@example.test')).toBeInTheDocument();
  });

  it('refuses a 403 with the access state and no form', async () => {
    await renderPage('/admin/email-log', { lists: [serverError(403, 'forbidden', 'Admin access required.')] });
    expect(screen.getByRole('heading', { name: 'You don’t have access to the email log' })).toBeInTheDocument();
    expect(screen.queryByRole('search')).toBeNull();
  });

  it('answers a 401 with the server message and a link to sign in again', async () => {
    await renderPage('/admin/email-log', {
      lists: [serverError(401, 'unauthenticated', 'Your session has expired. Sign in again.')],
    });
    const alert = screen.getByRole('alert');
    // The instruction is said once, as the link.
    expect(alert.textContent).toBe('Your session has expired. Sign in again');
    expect(alert.textContent.match(/Sign in again/g)).toHaveLength(1);
    expect(within(alert).getByRole('link', { name: 'Sign in again' })).toHaveAttribute('href', '/signin');
  });

  it('adds the sign-in link to a server 401 that gives no instruction of its own', async () => {
    await renderPage('/admin/email-log', { lists: [serverError(401, 'unauthorized', 'Authentication required.')] });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('Authentication required. Sign in again');
    expect(within(alert).getByRole('link', { name: 'Sign in again' })).toHaveAttribute('href', '/signin');
  });

  it('shows a first-load failure as an error with the server message', async () => {
    await renderPage('/admin/email-log', { lists: [serverError(500, 'internal', 'The email log is temporarily unavailable.')] });
    expect(screen.getByRole('alert')).toHaveTextContent('The email log is temporarily unavailable.');
    expect(screen.queryByRole('region', { name: 'Sent messages' })).toBeNull();
  });

  it('keeps the rows and shows a caution notice when a refresh fails', async () => {
    await renderPage('/admin/email-log', {
      lists: [
        { rows: ROWS, nextCursor: null, scanned: 5 },
        serverError(0, 'network', 'We could not reach the server. Check your connection and try again.'),
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('We could not reach the email log; showing the last messages we received.')).toBeInTheDocument();
    expect(screen.getByText('plain@example.test')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('refreshes the first page with the search that produced the rows', async () => {
    await renderPage('/admin/email-log?status=sent');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(listCalls()).toHaveLength(2));
    expect(listCalls()[1]).toEqual({ limit: 25, status: 'sent' });
  });

  it('never renders stored markup as HTML outside the frame', async () => {
    await renderPage('/admin/email-log', {
      lists: [{ rows: [message({ id: 'x', to: '<b>bold</b>@example.test', subject: '<img src=x onerror=alert(1)>' })], nextCursor: null, scanned: 1 }],
    });
    expect(screen.getByText('<b>bold</b>@example.test')).toBeInTheDocument();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('b')).toBeNull();
    expect(document.querySelector('img')).toBeNull();
  });

  it('keeps the keyboard path in reading order: Refresh, search, Source, Status, Search, Clear, the table, each Preview, Load more', async () => {
    await renderPage('/admin/email-log', { lists: [{ rows: ROWS.slice(0, 2), nextCursor: { sentAt: 1, id: 'x' }, scanned: 2 }] });
    const order = [
      screen.getByRole('button', { name: 'Refresh' }),
      searchField(),
      screen.getByRole('combobox', { name: 'Source' }),
      screen.getByRole('combobox', { name: 'Status' }),
      screen.getByRole('button', { name: 'Search' }),
      screen.getByRole('button', { name: 'Clear' }),
      screen.getByRole('region', { name: 'Sent messages' }),
      ...screen.getAllByRole('button', { name: 'Preview' }),
      screen.getByRole('button', { name: 'Load more' }),
    ];
    for (let i = 1; i < order.length; i += 1) {
      // DOCUMENT_POSITION_FOLLOWING: each control comes after the one before it.
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    // Nothing on the path takes a positive tab index.
    for (const element of order) expect(Number(element.getAttribute('tabindex') ?? 0)).toBeLessThanOrEqual(0);
  });
});

describe('figureSentence', () => {
  it('counts rows without a search and matches over the examined window with one', () => {
    expect(figureSentence({ count: 25, scanned: 25, searched: false, readAt: '9:14 AM UTC' }))
      .toBe('25 messages shown, newest first, read at 9:14 AM UTC.');
    expect(figureSentence({ count: 1, scanned: 1, searched: false, readAt: '9:14 AM UTC' }))
      .toBe('1 message shown, newest first, read at 9:14 AM UTC.');
    expect(figureSentence({ count: 3, scanned: 200, searched: true, readAt: '9:14 AM UTC' }))
      .toBe('3 matches in the 200 most recent messages, read at 9:14 AM UTC.');
    expect(figureSentence({ count: 1, scanned: 1500, searched: true, readAt: '9:14 AM UTC' }))
      .toBe('1 match in the 1,500 most recent messages, read at 9:14 AM UTC.');
    expect(figureSentence({ count: 1, scanned: 1, searched: true, readAt: '9:14 AM UTC' }))
      .toBe('1 match in the most recent message, read at 9:14 AM UTC.');
  });
});
