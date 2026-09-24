// AdminChangeRequests — the change request list and form (issue #188). Mocks
// adminApi, adminSource, and the event config, the same convention as
// AdminFeedback.test.jsx, and renders inside a router so the status filter
// can be read from and written to the address.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

let rowsCallback;
let errorCallback;
const subscribedTo = [];
vi.mock('../adminSource.js', () => ({
  subscribeAdminCollection: (name, onNext, onError) => {
    subscribedTo.push(name);
    rowsCallback = onNext;
    errorCallback = onError;
    return () => {};
  },
}));

const callMock = vi.fn();
vi.mock('../adminApi.js', () => ({ useAdminApi: () => callMock }));

let features = { changeRequests: true };
vi.mock('../../contexts/EventConfigContext.jsx', () => ({
  useEventConfig: () => ({ features }),
}));

import AdminChangeRequests, { countLine, readFilter } from './AdminChangeRequests.jsx';

let currentSearch = '';
function LocationProbe() {
  currentSearch = useLocation().search;
  return null;
}

function renderPage(path = '/admin/change-requests') {
  return render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AdminChangeRequests />
      <LocationProbe />
    </MemoryRouter>,
  );
}

function pushRows(rows) {
  act(() => rowsCallback(rows));
}

const request = (id, overrides = {}) => ({
  id,
  message: `Message ${id}`,
  page: '/travel',
  status: 'new',
  uid: `uid-${id}`,
  email: `${id}@example.org`,
  createdAt: new Date('2026-09-01T10:00:00Z'),
  ...overrides,
});

const ROWS = [
  request('older', { createdAt: new Date('2026-09-01T10:00:00Z') }),
  request('newer', { createdAt: new Date('2026-09-10T10:00:00Z'), status: 'in_progress' }),
  request('finished', { createdAt: new Date('2026-09-12T10:00:00Z'), status: 'done' }),
  request('refused', { createdAt: new Date('2026-09-13T10:00:00Z'), status: 'declined' }),
];

const items = () => screen.queryAllByRole('listitem');
const rowFor = (id) => items().find((li) => li.textContent.includes(`Message ${id}`));

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  callMock.mockReset();
  subscribedTo.length = 0;
  features = { changeRequests: true };
  currentSearch = '';
});

describe('AdminChangeRequests: the list', () => {
  it('reads change_requests and lists the open ones newest first by default', () => {
    renderPage();
    expect(subscribedTo).toEqual(['change_requests']);
    pushRows(ROWS);
    const texts = items().map((li) => li.textContent);
    expect(texts).toHaveLength(2);
    expect(texts[0]).toContain('Message newer');
    expect(texts[1]).toContain('Message older');
    expect(screen.getByText('Showing 2 of 4 requests.')).toHaveAttribute('role', 'status');
  });

  it('reads the filter from ?status= and writes it back when the reader changes it', () => {
    renderPage('/admin/change-requests?status=done');
    pushRows(ROWS);
    const select = screen.getByLabelText('Show');
    expect(select).toHaveValue('done');
    expect(items().map((li) => li.textContent).join()).toContain('Message finished');
    expect(items()).toHaveLength(1);

    fireEvent.change(select, { target: { value: 'all' } });
    expect(currentSearch).toBe('?status=all');
    expect(items()).toHaveLength(4);
    expect(items()[0].textContent).toContain('Message refused');

    // Open is the default and leaves the address clean.
    fireEvent.change(select, { target: { value: 'open' } });
    expect(currentSearch).toBe('');
  });

  it('reads an unknown ?status= as Open', () => {
    expect(readFilter('nope')).toBe('open');
    expect(readFilter(null)).toBe('open');
    renderPage('/admin/change-requests?status=nope');
    pushRows(ROWS);
    expect(screen.getByLabelText('Show')).toHaveValue('open');
    expect(items()).toHaveLength(2);
  });

  it('states each status as a word', () => {
    renderPage('/admin/change-requests?status=all');
    pushRows(ROWS);
    for (const [id, word] of [['older', 'New'], ['newer', 'In progress'], ['finished', 'Done'], ['refused', 'Declined']]) {
      expect(within(rowFor(id)).getByText(word)).toBeInTheDocument();
    }
  });

  it('shows the time, the requester as a mail link, and the page as text, never a link', () => {
    renderPage();
    pushRows([request('one', { page: 'https://elsewhere.example.org/' })]);
    const row = rowFor('one');
    expect(within(row).getByRole('link', { name: 'one@example.org' })).toHaveAttribute('href', 'mailto:one@example.org');
    expect(within(row).getAllByRole('link')).toHaveLength(1);
    expect(row.textContent).toContain('https://elsewhere.example.org/');
    expect(row.querySelector('time')).toHaveAttribute('dateTime', '2026-09-01T10:00:00.000Z');
  });

  it('renders a message that looks like markup as text', () => {
    renderPage();
    pushRows([request('xss', { message: '<img src=x onerror="alert(1)"> and <b>bold</b>' })]);
    const [row] = items();
    expect(row.textContent).toContain('<img src=x onerror="alert(1)"> and <b>bold</b>');
    expect(row.querySelector('img')).toBeNull();
    expect(row.querySelector('b')).toBeNull();
  });

  it('counts in the singular for one request', () => {
    expect(countLine(1, 1)).toBe('Showing 1 of 1 request.');
    expect(countLine(0, 3)).toBe('Showing 0 of 3 requests.');
  });

  it('states loading, then an empty store, then an empty filter with one way out', () => {
    renderPage('/admin/change-requests?status=done');
    expect(screen.getByRole('status', { name: 'Loading change requests…' })).toBeInTheDocument();

    pushRows([]);
    expect(screen.getByRole('heading', { name: 'No change requests' })).toBeInTheDocument();
    expect(screen.getByText('No one has sent a change request yet.')).toBeInTheDocument();

    pushRows([request('open-one')]);
    expect(screen.getByRole('heading', { name: 'No done requests' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show all requests' }));
    expect(currentSearch).toBe('?status=all');
    expect(items()).toHaveLength(1);
  });

  it('keeps the last rows when the listener fails, and says so', () => {
    renderPage();
    pushRows([request('kept')]);
    act(() => errorCallback(new Error('offline')));
    expect(screen.getByText(/lost the connection to the change requests/)).toBeInTheDocument();
    expect(rowFor('kept')).toBeTruthy();
  });
});

describe('AdminChangeRequests: status changes', () => {
  it('offers the next step as the row action, and Decline on open rows only', () => {
    renderPage('/admin/change-requests?status=all');
    pushRows(ROWS);
    expect(within(rowFor('older')).getByRole('button', { name: 'Mark in progress' })).toBeInTheDocument();
    expect(within(rowFor('newer')).getByRole('button', { name: 'Mark done' })).toBeInTheDocument();
    expect(within(rowFor('finished')).getByRole('button', { name: 'Reopen' })).toBeInTheDocument();
    expect(within(rowFor('refused')).getByRole('button', { name: 'Reopen' })).toBeInTheDocument();
    expect(within(rowFor('older')).getByRole('button', { name: 'Decline' })).toBeInTheDocument();
    expect(within(rowFor('newer')).getByRole('button', { name: 'Decline' })).toBeInTheDocument();
    expect(within(rowFor('finished')).queryByRole('button', { name: 'Decline' })).toBeNull();
    expect(within(rowFor('refused')).queryByRole('button', { name: 'Decline' })).toBeNull();
  });

  it('calls updateChangeRequestStatus for every action', async () => {
    callMock.mockResolvedValue({});
    renderPage('/admin/change-requests?status=all');
    pushRows(ROWS);
    for (const [id, name, status] of [
      ['older', 'Mark in progress', 'in_progress'],
      ['newer', 'Mark done', 'done'],
      ['finished', 'Reopen', 'new'],
      ['refused', 'Reopen', 'new'],
      ['older', 'Decline', 'declined'],
    ]) {
      fireEvent.click(within(rowFor(id)).getByRole('button', { name }));
      await flush();
      expect(callMock).toHaveBeenLastCalledWith('updateChangeRequestStatus', { id, status });
    }
    expect(callMock).toHaveBeenCalledTimes(5);
  });

  it('shows Saving… with aria-busy on the pressed control and disables the row’s others', async () => {
    let settle;
    callMock.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve; }));
    renderPage();
    pushRows([request('one')]);
    fireEvent.click(screen.getByRole('button', { name: 'Mark in progress' }));

    const saving = screen.getByRole('button', { name: 'Saving…' });
    expect(saving).toHaveAttribute('aria-busy', 'true');
    expect(saving).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
    // A second press while it saves sends nothing more.
    fireEvent.click(saving);
    expect(callMock).toHaveBeenCalledTimes(1);

    await act(async () => { settle({}); });
    expect(screen.getByRole('button', { name: 'Mark in progress' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeEnabled();
  });

  // Review finding 4: the listener can deliver the committed status before
  // the HTTP answer. The pressed control must stay the pressed control,
  // "Saving…" and aria-busy, until the call settles.
  it('keeps Saving… on the pressed control when the new status arrives before the answer', async () => {
    let settle;
    callMock.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve; }));
    renderPage();
    pushRows([request('one', { status: 'in_progress' })]);
    const pressed = screen.getByRole('button', { name: 'Mark done' });
    pressed.focus();
    fireEvent.click(pressed);

    // The snapshot lands first: under Open, a done row would leave the list.
    pushRows([request('one', { status: 'done' })]);
    const saving = screen.getByRole('button', { name: 'Saving…' });
    expect(saving).toBe(pressed);
    expect(saving).toHaveAttribute('aria-busy', 'true');
    expect(saving).toBeEnabled();
    expect(saving).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull();

    await act(async () => { settle({}); });
    expect(screen.queryByRole('button', { name: 'Saving…' })).toBeNull();
  });

  it('keeps a pressed Decline in place, saving, when the declined status arrives first', async () => {
    let settle;
    callMock.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve; }));
    renderPage('/admin/change-requests?status=all');
    pushRows([request('one')]);
    const pressed = screen.getByRole('button', { name: 'Decline' });
    pressed.focus();
    fireEvent.click(pressed);

    pushRows([request('one', { status: 'declined' })]);
    expect(pressed).toBeInTheDocument();
    expect(pressed).toHaveTextContent('Saving…');
    expect(pressed).toHaveAttribute('aria-busy', 'true');
    expect(pressed).toHaveFocus();
    // The following step is drawn, but it is not the pressed control.
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reopen' })).not.toHaveAttribute('aria-busy');

    await act(async () => { settle({}); });
  });

  // Review finding 1: a status change states its result, and when the
  // row leaves the filter or the pressed control goes, the keyboard lands on
  // the list heading, never on the page body.
  const heading = () => screen.getByRole('heading', { level: 2, name: 'Requests' });

  async function press(rowId, name) {
    const control = within(rowFor(rowId)).getByRole('button', { name });
    control.focus();
    fireEvent.click(control);
    await flush();
    return control;
  }

  for (const [label, path, stored, name, status, result] of [
    ['Mark done under Open', '/admin/change-requests', 'in_progress', 'Mark done', 'done', 'Request marked done.'],
    ['Decline under Open', '/admin/change-requests', 'new', 'Decline', 'declined', 'Request declined.'],
    ['Mark in progress under New', '/admin/change-requests?status=new', 'new', 'Mark in progress', 'in_progress', 'Request marked in progress.'],
    ['Reopen under Done', '/admin/change-requests?status=done', 'done', 'Reopen', 'new', 'Request reopened.'],
    ['Decline under All', '/admin/change-requests?status=all', 'in_progress', 'Decline', 'declined', 'Request declined.'],
  ]) {
    it(`${label}: states the result and moves focus to the list heading`, async () => {
      callMock.mockResolvedValueOnce({ id: 'one', status });
      renderPage(path);
      pushRows([request('one', { status: stored }), request('two', { status: stored, createdAt: new Date('2026-08-01T00:00:00Z') })]);

      await press('one', name);

      expect(callMock).toHaveBeenCalledWith('updateChangeRequestStatus', { id: 'one', status });
      expect(heading()).toHaveFocus();
      expect(screen.getByText(result)).toHaveAttribute('role', 'status');
      // And the snapshot that follows leaves the keyboard there.
      pushRows([request('one', { status }), request('two', { status: stored, createdAt: new Date('2026-08-01T00:00:00Z') })]);
      expect(heading()).toHaveFocus();
    });
  }

  it('the same, when the new status arrives before the answer', async () => {
    let settle;
    callMock.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve; }));
    renderPage();
    pushRows([request('one', { status: 'in_progress' })]);
    within(rowFor('one')).getByRole('button', { name: 'Mark done' }).focus();
    fireEvent.click(within(rowFor('one')).getByRole('button', { name: 'Mark done' }));
    pushRows([request('one', { status: 'done' })]);

    await act(async () => { settle({}); });

    expect(rowFor('one')).toBeUndefined();
    expect(heading()).toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.getByText('Request marked done.')).toBeInTheDocument();
  });

  it('keeps focus on the pressed control when the row and the control stay', async () => {
    callMock.mockResolvedValueOnce({ id: 'one', status: 'in_progress' });
    renderPage('/admin/change-requests?status=all');
    pushRows([request('one')]);

    const pressed = await press('one', 'Mark in progress');
    pushRows([request('one', { status: 'in_progress' })]);

    expect(pressed).toHaveFocus();
    expect(pressed).toHaveTextContent('Mark done');
    expect(screen.getByText('Request marked in progress.')).toHaveAttribute('role', 'status');
  });

  it('states nothing and moves nothing when the change fails', async () => {
    callMock.mockRejectedValueOnce(new Error('Admin access required.'));
    renderPage();
    pushRows([request('one')]);
    const pressed = await press('one', 'Decline');
    expect(pressed).toHaveFocus();
    expect(screen.queryByText('Request declined.')).toBeNull();
  });

  it('states a failed change on its row until the next try', async () => {
    callMock.mockRejectedValueOnce(new Error('Admin access required.'));
    renderPage();
    pushRows([request('one')]);
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    await flush();
    const alert = within(rowFor('one')).getByRole('alert');
    expect(alert).toHaveTextContent('This did not save. Admin access required.');

    callMock.mockResolvedValueOnce({});
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(within(rowFor('one')).queryByRole('alert')).toBeNull();
    await flush();
  });
});

describe('AdminChangeRequests: removal', () => {
  it('asks first, then calls deleteChangeRequest, says so, and puts focus on the list heading', async () => {
    callMock.mockResolvedValueOnce({ id: 'one', deleted: true });
    renderPage();
    pushRows([request('one'), request('two')]);

    fireEvent.click(within(rowFor('one')).getByRole('button', { name: 'Remove' }));
    expect(callMock).not.toHaveBeenCalled();
    expect(within(rowFor('one')).getByText(/The request and its text are deleted\. The audit log keeps who sent it and when\. This cannot be undone\./)).toBeInTheDocument();
    expect(within(rowFor('one')).getByRole('button', { name: 'Keep it' })).toBeInTheDocument();

    fireEvent.click(within(rowFor('one')).getByRole('button', { name: 'Remove this request' }));
    expect(within(rowFor('one')).getByRole('button', { name: 'Removing…' })).toBeInTheDocument();
    await flush();

    expect(callMock).toHaveBeenCalledWith('deleteChangeRequest', { id: 'one' });
    expect(screen.getByText('Request removed.')).toHaveAttribute('role', 'status');
    expect(screen.getByRole('heading', { level: 2, name: 'Requests' })).toHaveFocus();

    // The listener takes the row away.
    pushRows([request('two')]);
    expect(rowFor('one')).toBeUndefined();
    expect(screen.getByRole('heading', { level: 2, name: 'Requests' })).toHaveFocus();
  });

  // Review finding 2: an open confirm on one row must not be a live control
  // that silently does nothing while another row's action runs.
  it('an open Remove confirm cannot be pressed while another row saves, and says nothing false', async () => {
    let settle;
    renderPage();
    pushRows([request('a', { createdAt: new Date('2026-09-02T00:00:00Z') }), request('b')]);
    fireEvent.click(within(rowFor('a')).getByRole('button', { name: 'Remove' }));
    const confirm = within(rowFor('a')).getByRole('button', { name: 'Remove this request' });

    callMock.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve; }));
    fireEvent.click(within(rowFor('b')).getByRole('button', { name: 'Mark in progress' }));

    expect(confirm).toBeDisabled();
    // Only the row being removed ever reads "Removing…".
    expect(confirm).toHaveTextContent('Remove this request');
    fireEvent.click(confirm);
    expect(callMock).toHaveBeenCalledTimes(1);
    expect(callMock).not.toHaveBeenCalledWith('deleteChangeRequest', expect.anything());

    await act(async () => { settle({}); });
    expect(confirm).toBeEnabled();
    callMock.mockResolvedValueOnce({ id: 'a', deleted: true });
    fireEvent.click(confirm);
    await flush();
    expect(callMock).toHaveBeenLastCalledWith('deleteChangeRequest', { id: 'a' });
  });

  it('Keep it closes the moment and removes nothing', () => {
    renderPage();
    pushRows([request('one')]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
    expect(callMock).not.toHaveBeenCalled();
  });

  it('states a failed removal on its row', async () => {
    callMock.mockRejectedValueOnce(new Error('No such change request.'));
    renderPage();
    pushRows([request('one')]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove this request' }));
    await flush();
    expect(within(rowFor('one')).getByRole('alert')).toHaveTextContent('The request was not removed. No such change request.');
    expect(screen.queryByText('Request removed.')).toBeNull();
  });
});

describe('AdminChangeRequests: the form and the flag', () => {
  it('with the flag off, there is no form: a notice says who can turn it on, and the list still works', async () => {
    features = { changeRequests: false };
    callMock.mockResolvedValue({});
    renderPage();
    pushRows([request('one')]);
    expect(screen.queryByRole('button', { name: 'Send request' })).toBeNull();
    expect(screen.queryByLabelText('What should change?')).toBeNull();
    expect(screen.getByText('Change requests are off. An operator can turn them on under Features.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    await flush();
    expect(callMock).toHaveBeenCalledWith('updateChangeRequestStatus', { id: 'one', status: 'declined' });
  });

  it('with the flag missing, there is no form either', () => {
    features = {};
    renderPage();
    expect(screen.queryByRole('button', { name: 'Send request' })).toBeNull();
  });

  it('with the flag on, the form sends through submitChangeRequest with a key, then a new key', async () => {
    callMock.mockResolvedValue({ id: 'k', ok: true });
    renderPage();
    pushRows([]);
    fireEvent.change(screen.getByLabelText('What should change?'), { target: { value: '  Add the quiet room.  ' } });
    fireEvent.change(screen.getByLabelText(/Page \(optional\)/), { target: { value: '/travel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await flush();

    expect(callMock).toHaveBeenCalledTimes(1);
    const [name, payload] = callMock.mock.calls[0];
    expect(name).toBe('submitChangeRequest');
    expect(payload.message).toBe('Add the quiet room.');
    expect(payload.page).toBe('/travel');
    expect(payload.submissionKey).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    expect(screen.getByText('Request sent.')).toHaveAttribute('role', 'status');
    expect(screen.getByLabelText('What should change?')).toHaveValue('');

    fireEvent.change(screen.getByLabelText('What should change?'), { target: { value: 'A second one.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await flush();
    expect(callMock.mock.calls[1][1].submissionKey).not.toBe(payload.submissionKey);
    expect(callMock.mock.calls[1][1].page).toBeNull();
  });

  it('keeps the same key on a retry after a failure, and states the failure in place', async () => {
    const failure = Object.assign(new Error('Too many change requests. Try again later.'), { fieldErrors: [] });
    callMock.mockRejectedValueOnce(failure);
    callMock.mockResolvedValueOnce({ id: 'k', ok: true });
    renderPage();
    pushRows([]);
    fireEvent.change(screen.getByLabelText('What should change?'), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await flush();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Too many change requests. Try again later.');
    expect(alert).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await flush();
    expect(callMock.mock.calls[1][1].submissionKey).toBe(callMock.mock.calls[0][1].submissionKey);
  });

  it('marks an empty message on the field and sends nothing', () => {
    vi.useFakeTimers();
    try {
      renderPage();
      pushRows([]);
      const send = screen.getByRole('button', { name: 'Send request' });
      fireEvent.click(send);
      act(() => { vi.runOnlyPendingTimers(); });
      const field = screen.getByLabelText('What should change?');
      expect(field).toHaveAttribute('aria-invalid', 'true');
      expect(field).toHaveFocus();
      expect(screen.getByText('Say what should change.')).toBeInTheDocument();
      expect(send).toBeEnabled();
      expect(callMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
