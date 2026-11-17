import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import AuthContext from '../../contexts/AuthContext.jsx';
import CalendarSyncCard from './CalendarSyncCard.jsx';
import { readCalendarId, saveCalendarId } from '../../lib/calendarSync.js';
import { calendarEvent, calendarSession, calendarUser, calendarProvider, calendarResponse } from '../../test/calendarProvider.mjs';

// Only the Firebase popup and Calendar HTTP boundary are substituted. The
// card, sync, time conversion and account-scoped browser storage are real.
const auth = vi.hoisted(() => ({ grant: vi.fn(), credential: vi.fn() }));
vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: class {
    addScope() {}
    static credentialFromResult(result) { return auth.credential(result); }
  },
  linkWithPopup: auth.grant, reauthenticateWithPopup: auth.grant,
}));
let provider;
beforeEach(() => {
  localStorage.clear();
  auth.grant.mockReset().mockResolvedValue({});
  auth.credential.mockReset().mockReturnValue({ accessToken: 'synthetic-access' });
  provider = calendarProvider();
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('fetch', provider.fetchImpl);
  saveCalendarId(calendarUser, 'c1');
});
afterEach(() => vi.unstubAllGlobals());
function card(sessions = [calendarSession], user = calendarUser) {
  return <AuthContext.Provider value={{ user }}>
    <CalendarSyncCard key={user.uid} sessions={sessions} eventConfig={calendarEvent} />
  </AuthContext.Provider>;
}
function start() { fireEvent.click(screen.getByRole('button', { name: /sync my sessions/i })); }

it('serializes content edits during a pass, removes the final bookmark and retains only the calendar ID', async () => {
  let release;
  let started;
  const pending = new Promise((resolve) => { release = resolve; });
  const writing = new Promise((resolve) => { started = resolve; });
  vi.stubGlobal('fetch', async (url, init) => {
    if (init.method === 'POST') { started(); await pending; }
    return provider.fetchImpl(url, init);
  });
  const { rerender } = render(card());
  const button = screen.getByRole('button', { name: /sync my sessions/i });
  button.focus();
  expect(button).toHaveFocus();
  expect(button).toHaveClass('public-action'); // shared :focus-visible styling
  start();
  await act(async () => writing);
  expect(screen.getByRole('button', { name: 'Syncing…' })).toBeDisabled();
  const edited = { ...calendarSession, title: 'Changed title', startTime: '10:00', endTime: '10:40' };
  rerender(card([edited]));
  expect(provider.calls.some((call) => call.method === 'PUT')).toBe(false);
  await act(async () => release());
  await screen.findByText(/Your calendar is up to date/);
  await waitFor(() => expect(provider.live()[0].summary).toBe('Changed title'));
  expect(provider.live()[0].start.dateTime).toBe('2026-10-15T15:00:00.000Z');
  rerender(card([]));
  await waitFor(() => expect(provider.live()).toHaveLength(0));
  await screen.findByText(/1 removed/);
  expect(localStorage.length).toBe(1);
  expect(localStorage.getItem(localStorage.key(0))).toBe('c1');
});

it('reports partial failures and repairs them on a manual retry without another grant', async () => {
  const network = async (url, init) => init.method === 'POST' ? calendarResponse(503) : provider.fetchImpl(url, init);
  vi.stubGlobal('fetch', network);
  render(card());
  start();
  await screen.findByText(/Some events could not be updated/);
  expect(screen.queryByText(/Your calendar is up to date/)).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('.ics download');
  vi.stubGlobal('fetch', provider.fetchImpl);
  start();
  await screen.findByText(/Your calendar is up to date/);
  expect(provider.live()).toHaveLength(1);
  expect(auth.grant).toHaveBeenCalledTimes(1);
});

it.each([
  [403, 'accessNotConfigured', /has not finished its calendar setup/, false],
  [403, 'insufficientPermissions', /access wasn’t granted/, true],
  [403, 'rateLimitExceeded', /could not be updated just now/, true],
  [401, 'authError', /access expired or was revoked/, true],
])('renders the provider refusal (%i, %s) safely', async (status, reason, message, retry) => {
  vi.stubGlobal('fetch', async () => calendarResponse(status, {
    error: { message: 'synthetic private response', errors: [{ reason }] },
  }));
  render(card());
  start();
  await screen.findByText(message);
  expect(screen.getByRole('status')).toHaveTextContent('.ics');
  expect(screen.queryByText(/synthetic private/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /sync my sessions/i }) !== null).toBe(retry);
  expect(provider.calls).toHaveLength(0);
  if (status === 401 || reason === 'insufficientPermissions') {
    vi.stubGlobal('fetch', provider.fetchImpl);
    start();
    await screen.findByText(/Your calendar is up to date/);
    expect(auth.grant).toHaveBeenCalledTimes(2);
  }
});

it('leaves a refused popup grant unwritten', async () => {
  auth.grant.mockRejectedValueOnce({ code: 'auth/popup-closed-by-user' });
  render(card());
  start();
  await screen.findByText(/access wasn’t granted/);
  expect(provider.calls).toHaveLength(0);
});

it('clears a missing calendar before a failed replacement and reuses the next successful creation', async () => {
  vi.stubGlobal('fetch', async (url, init) => calendarResponse(init.method === 'GET' ? 404 : 503));
  render(card());
  start();
  await screen.findByText(/could not be updated just now/);
  expect(readCalendarId(calendarUser)).toBeNull();
  vi.stubGlobal('fetch', provider.fetchImpl);
  start();
  await screen.findByText(/Your calendar is up to date/);
  expect(readCalendarId(calendarUser)).toBe('c1');
  expect(provider.calls.filter((call) => call.url.endsWith('/calendars'))).toHaveLength(1);
});

it('aborts pending work on account change and obtains a separate grant and calendar', async () => {
  let release;
  let signal;
  vi.stubGlobal('fetch', (_url, init) => {
    signal = init.signal;
    return new Promise((resolve) => { release = resolve; });
  });
  const { rerender, unmount } = render(card());
  start();
  await waitFor(() => expect(signal).toBeDefined());
  const other = { ...calendarUser, uid: 'u2' };
  rerender(card([calendarSession], other));
  expect(signal.aborted).toBe(true);
  await act(async () => release(calendarResponse(200, { items: [] })));
  expect(screen.queryByText(/Your calendar is up to date/)).not.toBeInTheDocument();
  vi.stubGlobal('fetch', provider.fetchImpl);
  start();
  await screen.findByText(/Your calendar is up to date/);
  expect(auth.grant).toHaveBeenLastCalledWith(other, expect.anything());
  expect(readCalendarId(other)).toBe('c1');
  expect(localStorage.length).toBe(2);
  unmount();
});
