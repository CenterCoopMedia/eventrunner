import { lazy } from 'react';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import MyTicketsRoute from './MyTicketsRoute.jsx';
import MyTickets from '../pages/MyTickets.jsx';

const state = vi.hoisted(() => ({ auth: {}, config: {}, request: vi.fn() }));
vi.mock('../contexts/AuthContext.jsx', () => ({ useAuth: () => state.auth }));
vi.mock('../contexts/EventConfigContext.jsx', () => ({ useEventConfig: () => ({ eventConfig: state.config }) }));
vi.mock('../lib/ticketingCommerce.js', async (original) => ({ ...await original(), ticketingRequest: state.request }));

const reader = { uid: 'reader', emailVerified: true };
const otherReader = { uid: 'other-reader', emailVerified: true };

beforeEach(() => {
  state.auth = { user: reader, loading: false };
  state.config = { name: 'Test event' };
  state.request.mockReset().mockResolvedValue({ tickets: [], nextCursor: null });
});

function suspendedRoute() {
  let reveal;
  const pending = new Promise((resolve) => { reveal = () => resolve({ default: MyTickets }); });
  const Page = lazy(() => pending);
  const route = () => (
    <MemoryRouter initialEntries={['/tickets/mine']}>
      <MyTicketsRoute component={Page} label="your tickets" routeKey="/tickets/mine" />
    </MemoryRouter>
  );
  return { route, reveal };
}

it('starts the authorized first page before the page code loads and reuses its result', async () => {
  const { route, reveal } = suspendedRoute();
  render(route());
  expect(screen.getByText('Loading your tickets…')).toBeVisible();
  expect(state.request).toHaveBeenCalledExactlyOnceWith('ticketingMyTickets', expect.objectContaining({ user: reader, body: {} }));

  await act(async () => reveal());
  expect(screen.getByText('No tickets found for this account')).toBeVisible();
  expect(state.request).toHaveBeenCalledTimes(1);
});

it('aborts the pending read when the verified account changes or leaves before the page loads', () => {
  const { route } = suspendedRoute();
  state.request.mockReturnValue(new Promise(() => {}));
  const { rerender, unmount } = render(route());
  const first = state.request.mock.calls[0][1];

  state.auth = { user: otherReader, loading: false };
  rerender(route());
  const second = state.request.mock.calls[1][1];
  expect(first.signal.aborted).toBe(true);
  expect(second.user).toBe(otherReader);
  expect(second.signal.aborted).toBe(false);

  unmount();
  expect(second.signal.aborted).toBe(true);
});

it.each([
  ['the auth handshake', { user: reader, loading: true }, {}],
  ['sign-out', { user: null, loading: false }, {}],
  ['an unverified account', { user: { ...reader, emailVerified: false }, loading: false }, {}],
  ['a read-only demo', { user: reader, loading: false }, { historicalDemo: true }],
])('does not start a ticket read during %s', (_, auth, config) => {
  state.auth = auth;
  state.config = config;
  const { route } = suspendedRoute();
  render(route());
  expect(state.request).not.toHaveBeenCalled();
});
