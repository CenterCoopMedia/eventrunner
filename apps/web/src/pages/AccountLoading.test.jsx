import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import MyTickets from './MyTickets.jsx';
import TicketStatus from './TicketStatus.jsx';
import MyChangeRequests from './MyChangeRequests.jsx';

const state = vi.hoisted(() => ({ user: null, loading: false, tickets: vi.fn(), changes: vi.fn() }));
vi.mock('../contexts/AuthContext.jsx', async (original) => ({
  ...await original(), useAuth: () => ({ user: state.user, loading: state.loading }),
}));
vi.mock('../contexts/EventConfigContext.jsx', () => ({
  useEventConfig: () => ({ eventConfig: { historicalDemo: false, name: 'Test event', timezone: 'UTC' }, features: { changeRequests: true } }),
}));
vi.mock('../lib/ticketingCommerce.js', async (original) => ({ ...await original(), ticketingRequest: state.tickets }));
vi.mock('../lib/changeRequestApi.js', async (original) => ({ ...await original(), listMyChangeRequests: state.changes }));
vi.mock('../lib/fieldVitals.js', async (original) => ({ ...await original(), reportHeldUp: vi.fn() }));

const READER = { uid: 'reader', email: 'reader@example.test', emailVerified: true };
const CASES = [
  { name: 'tickets', Page: MyTickets, path: '/tickets/mine', label: 'Loading your tickets…', region: 'Tickets',
    result: { tickets: [], nextCursor: null }, ready: 'No tickets found for this account' },
  { name: 'order', Page: TicketStatus, path: '/tickets/status?orderId=order-1', label: 'Loading your order…', region: 'Order status content',
    result: { orderId: 'order-1', status: 'free', paymentStatus: 'succeeded', totalAmount: 0, currency: 'usd', lines: [], tickets: [] }, ready: 'Your order is confirmed' },
  { name: 'change requests', Page: MyChangeRequests, path: '/profile/change-requests', label: 'Loading your change requests…', region: 'Change requests',
    result: { ok: true, requests: [] }, ready: 'You have not sent a change request.' },
];

let finish;
beforeEach(() => {
  localStorage.clear();
  state.user = READER; state.loading = false;
  const pending = new Promise((resolve) => { finish = resolve; });
  state.tickets.mockReset().mockReturnValue(pending);
  state.changes.mockReset().mockReturnValue(pending);
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

function tree({ Page, path }) {
  return <MemoryRouter initialEntries={[path]}><Page /></MemoryRouter>;
}

describe.each(CASES)('$name loading feedback', (page) => {
  it('names the wait, escalates outside the busy content and removes the indicator when the read resolves', async () => {
    render(tree(page));
    const status = screen.getByRole('status', { name: page.label });
    const region = screen.getByRole('region', { name: page.region });
    expect(status.closest('[aria-busy="true"]')).toBeNull();
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(status.closest('.loading-state')).toHaveAttribute('data-loading-stage', 'initial');
    act(() => vi.advanceTimersByTime(1000));
    expect(status.closest('.loading-state')).toHaveAttribute('data-loading-stage', 'active');
    act(() => vi.advanceTimersByTime(9000));
    expect(status).toHaveTextContent('This is taking longer than usual.');
    act(() => vi.advanceTimersByTime(50000));
    expect(status).toHaveTextContent('We haven’t received a result after a minute.');
    expect(state.tickets.mock.calls.length + state.changes.mock.calls.length).toBe(1);

    await act(async () => finish(page.result));
    expect(screen.queryByRole('status', { name: page.label })).toBeNull();
    expect(region).toHaveAttribute('aria-busy', 'false');
    expect(screen.getByText(page.ready, { exact: true })).toBeInTheDocument();
  });

  it('uses shared feedback for the auth handshake and starts a fresh named data wait afterwards', async () => {
    state.user = null; state.loading = true;
    const view = render(tree(page));
    const auth = screen.getByRole('status', { name: 'Checking your sign-in…' });
    act(() => vi.advanceTimersByTime(10000));
    expect(auth).toHaveTextContent('This is taking longer than usual.');
    expect(state.tickets).not.toHaveBeenCalled();
    expect(state.changes).not.toHaveBeenCalled();

    state.user = READER; state.loading = false;
    view.rerender(tree(page));
    expect(screen.queryByRole('status', { name: 'Checking your sign-in…' })).toBeNull();
    const data = screen.getByRole('status', { name: page.label });
    expect(data.closest('.loading-state')).toHaveAttribute('data-loading-stage', 'initial');
    expect(data.closest('[aria-busy="true"]')).toBeNull();
    await act(async () => finish(page.result));
    expect(screen.queryByRole('status', { name: page.label })).toBeNull();
    expect(screen.getByRole('region', { name: page.region })).toHaveAttribute('aria-busy', 'false');
  });
});
