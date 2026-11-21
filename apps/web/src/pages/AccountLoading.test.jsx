import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import DeferredPage from '../components/DeferredPage.jsx';
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
  { name: 'tickets', Page: MyTickets, path: '/tickets/mine', label: 'Loading your tickets…', region: 'Tickets', sharedWait: true,
    result: { tickets: [], nextCursor: null }, ready: 'No tickets found for this account', completion: 'You have no tickets for this account.' },
  { name: 'order', Page: TicketStatus, path: '/tickets/status?orderId=order-1', label: 'Loading your order…', region: 'Order status content',
    result: { orderId: 'order-1', status: 'free', paymentStatus: 'succeeded', totalAmount: 0, currency: 'usd', lines: [], tickets: [] }, ready: 'Your order is confirmed' },
  { name: 'change requests', Page: MyChangeRequests, path: '/profile/change-requests', label: 'Loading your change requests…', region: 'Change requests',
    result: { ok: true, requests: [] }, ready: 'You have not sent a change request.', completion: 'Your change requests are ready.' },
];

let finish;
beforeEach(() => {
  localStorage.clear();
  state.user = READER; state.loading = false;
  const pending = new Promise((resolve) => { finish = resolve; });
  state.tickets.mockReset().mockReturnValue(pending);
  state.changes.mockReset().mockReturnValue(pending);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
});
afterEach(() => vi.useRealTimers());

function tree({ Page, path, sharedWait }) {
  return (
    <MemoryRouter initialEntries={[path]}>
      {sharedWait ? <DeferredPage component={Page} label="your tickets" routeKey={path} /> : <Page />}
    </MemoryRouter>
  );
}

describe.each(CASES)('$name loading feedback', (page) => {
  it('names the wait, escalates outside the busy content and removes the indicator when the read resolves', async () => {
    render(tree(page));
    const status = screen.getByRole('status');
    const region = screen.getByRole('region', { name: page.region });
    expect(status.closest('[aria-busy="true"]')).toBeNull();
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(status.closest('.loading-state')).toHaveAttribute('data-loading-stage', 'initial');
    expect(status).toBeEmptyDOMElement();
    expect(screen.getByText(page.label)).toBeVisible();
    act(() => vi.advanceTimersByTime(1000));
    expect(status.closest('.loading-state')).toHaveAttribute('data-loading-stage', 'active');
    expect(status.textContent).toBe(page.label);
    act(() => vi.advanceTimersByTime(9000));
    expect(status.textContent).toBe('This is taking longer than usual. We’re still waiting for a response.');
    act(() => vi.advanceTimersByTime(50000));
    if (page.name === 'tickets') {
      expect(status).toHaveTextContent('This is taking longer than a minute.');
      expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
    } else {
      expect(status.textContent).toBe('We haven’t received a result after a minute. You can keep waiting.');
    }
    expect(state.tickets.mock.calls.length + state.changes.mock.calls.length).toBe(1);

    await act(async () => finish(page.result));
    if (page.completion) expect(status).toHaveTextContent(page.completion);
    else expect(status).not.toBeInTheDocument();
    expect(screen.queryByText(page.label)).not.toBeInTheDocument();
    expect(region).toHaveAttribute('aria-busy', 'false');
    expect(screen.getByText(page.ready, { exact: true })).toBeInTheDocument();
  });

  it('names the data wait after sign-in and keeps the original deadline on shared routes', async () => {
    state.user = null; state.loading = true;
    const view = render(tree(page));
    const auth = screen.getByRole('status');
    expect(auth).toBeEmptyDOMElement();
    act(() => vi.advanceTimersByTime(1000));
    expect(auth.textContent).toBe('Checking your sign-in…');
    act(() => vi.advanceTimersByTime(29_000));
    expect(auth).toHaveTextContent('This is taking longer than usual.');
    expect(state.tickets).not.toHaveBeenCalled();
    expect(state.changes).not.toHaveBeenCalled();

    state.user = READER; state.loading = false;
    view.rerender(tree(page));
    expect(screen.queryByText('Checking your sign-in…')).toBeNull();
    expect(screen.getByText(page.label)).toBeVisible();
    const data = screen.getByRole('status');
    expect(data.closest('.loading-state')).toHaveAttribute('data-loading-stage', page.sharedWait ? 'slow' : 'initial');
    expect(data.closest('[aria-busy="true"]')).toBeNull();
    if (page.sharedWait) {
      expect(data).toBeEmptyDOMElement();
      expect(data.closest('.loading-state').querySelector('.loading-status__detail')).toHaveTextContent('This is taking longer than usual.');
      act(() => vi.advanceTimersByTime(29_999));
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
      act(() => vi.advanceTimersByTime(1));
      expect(data).toHaveTextContent('This is taking longer than a minute.');
      expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
    }
    await act(async () => finish(page.result));
    if (page.completion) expect(data).toHaveTextContent(page.sharedWait ? page.completion : '');
    else expect(data).not.toBeInTheDocument();
    expect(screen.queryByText(page.label)).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: page.region })).toHaveAttribute('aria-busy', 'false');
  });
});
