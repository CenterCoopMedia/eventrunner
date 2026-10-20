// MyChangeRequests — the requester's own change requests at
// /profile/change-requests (issue #330). No Firebase, no network: the auth
// and event config contexts and lib/changeRequestApi.js are mocked, and the
// rows here are the requester-safe shape listMyChangeRequests answers.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const listMock = vi.fn();
vi.mock('../lib/changeRequestApi.js', () => ({
  listMyChangeRequests: (...args) => listMock(...args),
}));

let auth;
vi.mock('../contexts/AuthContext.jsx', () => ({ useAuth: () => auth }));

let eventConfig;
let features;
vi.mock('../contexts/EventConfigContext.jsx', () => ({
  useEventConfig: () => ({ eventConfig, features }),
}));

vi.mock('../components/SignInPanel.jsx', () => ({ default: () => <p>Sign-in panel</p> }));

import MyChangeRequests, { statusWord } from './MyChangeRequests.jsx';

const USER = { uid: 'uid-ada', emailVerified: true, getIdToken: async () => 'id-token' };
const ORIGIN = window.location.origin;

const DONE = {
  id: 'k-done',
  message: 'The travel page lists the <b>wrong</b> hotel.',
  page: '/travel',
  status: 'done',
  createdAt: '2026-10-19T10:00:00.000Z',
  history: [
    { status: 'new', at: '2026-10-19T10:00:00.000Z' },
    { status: 'in_progress', at: '2026-10-19T11:00:00.000Z' },
    { status: 'done', at: '2026-10-19T12:00:00.000Z' },
  ],
  outcome: { status: 'done', reply: 'We fixed the hotel name.\nThanks.', resultUrl: `${ORIGIN}/travel#hotel`, recordedAt: '2026-10-19T12:00:00.000Z' },
};
const OPEN = {
  id: 'k-open',
  message: 'Add the parking map.',
  page: null,
  status: 'new',
  createdAt: '2026-10-20T09:00:00.000Z',
  history: [
    { status: 'new', at: '2026-10-18T09:00:00.000Z' },
    { status: 'declined', at: '2026-10-18T10:00:00.000Z' },
    { status: 'new', at: '2026-10-20T09:00:00.000Z' },
  ],
  outcome: null,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/profile/change-requests']}>
      <MyChangeRequests />
    </MemoryRouter>,
  );
}

async function flush() {
  await act(async () => { await Promise.resolve(); });
}

const item = (text) => screen.getAllByRole('listitem').find((li) => li.querySelector('h2')?.textContent && li.textContent.includes(text));

beforeEach(() => {
  listMock.mockReset();
  auth = { user: USER, loading: false };
  eventConfig = { name: 'Example Summit', historicalDemo: false };
  features = { changeRequests: true };
});

describe('MyChangeRequests', () => {
  it('lists the reader’s requests with their status, their own words as text, and the history', async () => {
    listMock.mockResolvedValueOnce({ ok: true, requests: [OPEN, DONE] });
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Your change requests' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading your change requests…');
    await flush();

    expect(listMock).toHaveBeenCalledWith({ user: USER });
    const done = item('wrong');
    const statusLine = (li, word) => within(li).getByText((_, el) => el?.tagName === 'P' && el.textContent === `Status: ${word}`);
    expect(statusLine(done, 'Done')).toBeInTheDocument();
    // The requester's text renders as text, never as markup.
    expect(within(done).getByText('The travel page lists the <b>wrong</b> hotel.')).toBeInTheDocument();
    expect(done.querySelector('b')).toBeNull();
    expect(within(done).getByText('/travel')).toBeInTheDocument();
    const history = within(done).getByRole('list', { name: 'History' });
    expect(within(history).getAllByRole('listitem').map((li) => li.querySelector('span').textContent)).toEqual(['Received', 'In progress', 'Done']);
    expect(history.querySelector('time')).toHaveAttribute('dateTime', '2026-10-19T10:00:00.000Z');

    const open = item('parking');
    expect(statusLine(open, 'Received')).toBeInTheDocument();
    // A request opened again after an outcome reads "Reopened" in its history.
    const openHistory = within(open).getByRole('list', { name: 'History' });
    expect(within(openHistory).getAllByRole('listitem').map((li) => li.querySelector('span').textContent)).toEqual(['Received', 'Declined', 'Reopened']);
    expect(within(open).queryByText('Reply from the event team')).toBeNull();
  });

  it('shows the event team’s reply as text and the result link on this site', async () => {
    listMock.mockResolvedValueOnce({ ok: true, requests: [DONE] });
    renderPage();
    await flush();
    const done = item('wrong');
    expect(within(done).getByText('Reply from the event team')).toBeInTheDocument();
    expect(within(done).getByText(/We fixed the hotel name\./)).toHaveClass('whitespace-pre-wrap');
    expect(within(done).getByRole('link', { name: 'See the result' })).toHaveAttribute('href', `${ORIGIN}/travel#hotel`);
  });

  it('never links a result address on another origin', async () => {
    listMock.mockResolvedValueOnce({
      ok: true,
      requests: [{ ...DONE, outcome: { ...DONE.outcome, resultUrl: `https://evil.example/${ORIGIN}` } }],
    });
    renderPage();
    await flush();
    const done = item('wrong');
    expect(within(done).queryByRole('link', { name: 'See the result' })).toBeNull();
    expect(done.querySelector('a[href^="https://evil.example"]')).toBeNull();
  });

  it('states an empty list and how to send a request', async () => {
    listMock.mockResolvedValueOnce({ ok: true, requests: [] });
    renderPage();
    await flush();
    expect(screen.getByText('You have not sent a change request.')).toBeInTheDocument();
    expect(screen.getByText('To send one, choose Request a change at the foot of any page.')).toBeInTheDocument();
  });

  it('states a failure as an alert and loads again on Refresh', async () => {
    listMock.mockResolvedValueOnce({ ok: false, error: 'Your change requests could not be loaded. Try again.' });
    renderPage();
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('Your change requests could not be loaded. Try again.');
    listMock.mockResolvedValueOnce({ ok: true, requests: [DONE] });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await flush();
    expect(listMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(item('wrong')).toBeDefined();
  });

  it('asks a signed-out reader to sign in, and asks for nothing', () => {
    auth = { user: null, loading: false };
    renderPage();
    expect(screen.getByText('Sign in to see the change requests you sent.')).toBeInTheDocument();
    expect(screen.getByText('Sign-in panel')).toBeInTheDocument();
    expect(listMock).not.toHaveBeenCalled();
  });

  it('asks an unverified reader to verify, and asks for nothing', () => {
    auth = { user: { ...USER, emailVerified: false }, loading: false };
    renderPage();
    expect(screen.getByText('Sign in with Google or an emailed code to see your change requests.')).toBeInTheDocument();
    expect(listMock).not.toHaveBeenCalled();
  });

  it('says so in a read-only demo, and asks for nothing', () => {
    eventConfig = { ...eventConfig, historicalDemo: true };
    renderPage();
    expect(screen.getByText('Change requests are off in this read-only demo.')).toBeInTheDocument();
    expect(listMock).not.toHaveBeenCalled();
  });

  it('names each status in plain words', () => {
    expect(['new', 'in_progress', 'done', 'declined', 'other'].map((status) => statusWord(status))).toEqual(
      ['Received', 'In progress', 'Done', 'Declined', 'Received'],
    );
  });
});
