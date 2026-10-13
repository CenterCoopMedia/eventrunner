import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import StripeOrderDetail from './StripeOrderDetail.jsx';

const DETAIL = {
  order: { id: 'order-1', purchaserEmail: 'purchaser@example.test', paymentStatus: 'succeeded',
    refundStatus: 'none', totalAmount: 2500, currency: 'usd', createdAt: '2026-01-01T12:00:00Z' },
  tickets: [], audit: [],
};

async function setup(outcomes) {
  const resend = vi.fn();
  for (const outcome of outcomes) {
    if (outcome instanceof Error) resend.mockRejectedValueOnce(outcome);
    else resend.mockResolvedValueOnce(outcome);
  }
  const call = vi.fn(async (_name, body) => body.action === 'resend'
    ? resend(body)
    : { ...DETAIL, order: { ...DETAIL.order, id: body.orderId } });
  const props = { call, orderId: 'order-1', isOperator: true, timezone: 'UTC', onChanged: vi.fn(), onClose: vi.fn() };
  const view = render(<StripeOrderDetail {...props} />);
  await screen.findByRole('button', { name: 'Resend ticket confirmation' });
  return { resend, props, ...view };
}

function clickResend() { fireEvent.click(screen.getByRole('button', { name: 'Resend ticket confirmation' })); }
function requestIds(resend) { return resend.mock.calls.map(([body]) => body.requestId); }

const UNUSED_TICKET = { externalId: 'seat-unused', firstName: 'Unused', lastName: 'Attendee', email: 'unused@example.test', status: 'valid', checkedInAt: null };
const USED_TICKET = { ...UNUSED_TICKET, externalId: 'seat-used', firstName: 'Used', email: 'used@example.test', checkedInAt: '2026-01-02T10:00:00Z' };

async function cancellationSetup({ isOperator = false, initialTickets = [UNUSED_TICKET, USED_TICKET], latestTickets = initialTickets, lookupError } = {}) {
  let reads = 0;
  const call = vi.fn(async (_name, body) => {
    if (body.action === 'order') {
      reads += 1;
      if (reads > 1 && lookupError) throw lookupError;
      return { ...DETAIL, tickets: reads === 1 ? initialTickets : latestTickets };
    }
    if (body.action === 'cancelTickets') return { ...DETAIL, tickets: latestTickets };
    throw new Error(`Unexpected action: ${body.action}`);
  });
  const props = { call, orderId: 'order-1', isOperator, timezone: 'UTC', onChanged: vi.fn(), onClose: vi.fn() };
  const view = render(<StripeOrderDetail {...props} />);
  await screen.findByRole('checkbox', { name: /Select Unused Attendee/ });
  return { call, props, ...view };
}

function reviewCancellation() { fireEvent.click(screen.getByRole('button', { name: 'Review ticket cancellation' })); }
function confirmCancellation() {
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Reason for this action'), { target: { value: 'Attendee cannot attend.' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /Cancel \d+ admission tickets/ }));
}

describe('staff cancellation authority', () => {
  it('disables checked-in ticket selection for staff while allowing unused tickets from the same order', async () => {
    const { call } = await cancellationSetup();
    const used = screen.getByRole('checkbox', { name: /Select Used Attendee/ });
    expect(used).toBeDisabled();
    expect(used).toHaveAccessibleDescription('An operator must cancel a checked-in ticket.');
    fireEvent.click(screen.getByRole('checkbox', { name: /Select Unused Attendee/ }));
    reviewCancellation();
    await screen.findByRole('dialog');
    confirmCancellation();
    await waitFor(() => expect(call).toHaveBeenCalledWith('ticketingCommerceAdmin', expect.objectContaining({ action: 'cancelTickets', ticketIds: ['seat-unused'], confirmed: true })));
  });

  it('refreshes a mixed staff selection before review and excludes a newly checked-in ticket', async () => {
    const { call } = await cancellationSetup({ initialTickets: [UNUSED_TICKET, { ...USED_TICKET, checkedInAt: null }] });
    // The latest lookup must differ from the originally displayed snapshot.
    call.mockImplementationOnce(async () => ({ ...DETAIL, tickets: [UNUSED_TICKET, USED_TICKET] }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Select Unused Attendee/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Select Used Attendee/ }));
    reviewCancellation();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Unused Attendee')).toBeInTheDocument();
    expect(within(dialog).queryByText('Used Attendee')).not.toBeInTheDocument();
    expect(within(dialog).getByText(/Checked-in or unavailable tickets were removed from the selection/)).toBeInTheDocument();
    confirmCancellation();
    await waitFor(() => expect(call).toHaveBeenCalledWith('ticketingCommerceAdmin', expect.objectContaining({ action: 'cancelTickets', ticketIds: ['seat-unused'] })));
  });

  it('blocks staff review when the entire stale selection is now checked in', async () => {
    const { call } = await cancellationSetup({ initialTickets: [UNUSED_TICKET], latestTickets: [{ ...UNUSED_TICKET, checkedInAt: USED_TICKET.checkedInAt }] });
    fireEvent.click(screen.getByRole('checkbox', { name: /Select Unused Attendee/ }));
    reviewCancellation();
    await screen.findByText(/An operator must review their cancellation/);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Select Unused Attendee/ })).toBeDisabled();
    expect(call.mock.calls.some(([, body]) => body.action === 'cancelTickets')).toBe(false);
  });

  it('keeps staff selection available to retry when the current order cannot be checked', async () => {
    const { call } = await cancellationSetup({ lookupError: new Error('Current ticket state is unavailable.') });
    fireEvent.click(screen.getByRole('checkbox', { name: /Select Unused Attendee/ }));
    reviewCancellation();
    await screen.findByText('Current ticket state is unavailable.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Select Unused Attendee/ })).toBeChecked();
    expect(call.mock.calls.some(([, body]) => body.action === 'cancelTickets')).toBe(false);
  });

  it('lets operators explicitly confirm cancellation of checked-in tickets in a mixed selection', async () => {
    const { call } = await cancellationSetup({ isOperator: true });
    const used = screen.getByRole('checkbox', { name: /Select Used Attendee/ });
    expect(used).toBeEnabled();
    fireEvent.click(used);
    fireEvent.click(screen.getByRole('checkbox', { name: /Select Unused Attendee/ }));
    reviewCancellation();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/already checked in/)).toBeInTheDocument();
    expect(call.mock.calls.some(([, body]) => body.action === 'cancelTickets')).toBe(false);
    confirmCancellation();
    await waitFor(() => expect(call).toHaveBeenCalledWith('ticketingCommerceAdmin', expect.objectContaining({ action: 'cancelTickets', ticketIds: ['seat-used', 'seat-unused'], confirmed: true })));
  });

  it('rechecks operator authority at confirmation if the role changes during review', async () => {
    const { call, props, rerender } = await cancellationSetup({ isOperator: true });
    fireEvent.click(screen.getByRole('checkbox', { name: /Select Used Attendee/ }));
    reviewCancellation();
    await screen.findByRole('dialog');
    rerender(<StripeOrderDetail {...props} isOperator={false} />);
    confirmCancellation();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText(/Review the current tickets before cancelling/)).toBeInTheDocument();
    expect(call.mock.calls.some(([, body]) => body.action === 'cancelTickets')).toBe(false);
  });
});

describe('order confirmation resend outcomes', () => {
  it('reports the sent count and uses a new request for a later deliberate resend after completion', async () => {
    const { resend } = await setup([{ sent: 2, failed: 0, alreadySent: false }, { sent: 2, failed: 0, alreadySent: false }]);
    clickResend();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Resend ticket confirmation' })).toHaveAttribute('aria-busy', 'false'));
    clickResend();
    await waitFor(() => expect(resend).toHaveBeenCalledTimes(2));
    const ids = requestIds(resend);
    expect(ids[0]).toEqual(expect.any(String));
    expect(ids[1]).not.toBe(ids[0]);
    expect(resend.mock.calls.every(([body]) => body.orderId === 'order-1')).toBe(true);
    expect(screen.getByText('2 confirmation messages sent. Stripe’s payment receipt is separate.')).toBeInTheDocument();
  });

  it('ignores a second press while the same send is in flight', async () => {
    const { resend } = await setup([]);
    let finish;
    resend.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    clickResend();
    const button = screen.getByRole('button', { name: 'Resend ticket confirmation' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    clickResend();
    expect(resend).toHaveBeenCalledTimes(1);
    await act(async () => finish({ sent: 1, failed: 0, alreadySent: false }));
    expect(screen.getByText('1 confirmation message sent. Stripe’s payment receipt is separate.')).toBeInTheDocument();
  });

  it.each([
    [0, 2, '0 confirmation messages sent. 2 messages failed or could not be confirmed.'],
    [1, 1, '1 confirmation message sent. 1 message failed or could not be confirmed.'],
  ])('retains the request after sent=%i, failed=%i, including an already-recorded replay', async (sent, failed, message) => {
    // emailCore claims each recipient before delivery. A failed recipient's
    // once key also returns skipped on retry, so alreadySent is not evidence
    // that the earlier failed delivery succeeded.
    const { resend } = await setup([
      { sent, failed, alreadySent: false },
      { sent: 0, failed: 0, alreadySent: true },
      { sent: 0, failed: 0, alreadySent: true },
    ]);
    clickResend();
    await screen.findByText(`${message} Retrying keeps this request. Review the email log before another send.`);
    expect(screen.queryByText(/Transactional ticket confirmation sent/)).not.toBeInTheDocument();
    clickResend();
    await screen.findByText(/This request is already recorded\. No messages were sent again\./);
    expect(screen.getByText(/Delivery is still unconfirmed/)).toBeInTheDocument();
    clickResend();
    await waitFor(() => expect(resend).toHaveBeenCalledTimes(3));
    expect(new Set(requestIds(resend)).size).toBe(1);
  });

  it('retains the request after a lost response and does not turn an already-recorded retry into success', async () => {
    const { resend } = await setup([
      new Error('The network response was lost.'),
      { sent: 0, failed: 0, alreadySent: true },
      { sent: 0, failed: 0, alreadySent: true },
    ]);
    clickResend();
    await screen.findByText(/The network response was lost/);
    expect(screen.getByText(/Delivery is unconfirmed\. Retrying keeps this request/)).toBeInTheDocument();
    clickResend();
    await screen.findByText(/This request is already recorded/);
    expect(screen.getByText(/Delivery is still unconfirmed/)).toBeInTheDocument();
    clickResend();
    await waitFor(() => expect(resend).toHaveBeenCalledTimes(3));
    expect(new Set(requestIds(resend)).size).toBe(1);
  });

  it('does not assume a positive retry count confirms recipients skipped after an earlier partial failure', async () => {
    const { resend } = await setup([
      { sent: 1, failed: 1, alreadySent: false },
      { sent: 1, failed: 0, alreadySent: false },
      { sent: 0, failed: 0, alreadySent: true },
    ]);
    clickResend();
    await screen.findByText(/1 message failed or could not be confirmed/);
    clickResend();
    await screen.findByText(/1 confirmation message sent\. Earlier delivery results are still unconfirmed/);
    clickResend();
    await waitFor(() => expect(resend).toHaveBeenCalledTimes(3));
    expect(new Set(requestIds(resend)).size).toBe(1);
  });

  it.each([
    ['not-confirmed', 'The order’s payment is not confirmed.'],
    ['no-valid-tickets', 'This order has no valid admission tickets.'],
    ['read-only-demo', 'This historical demo is read-only.'],
  ])('explains skipped %s and preserves the request until a later clean send completes', async (skipped, explanation) => {
    const { resend } = await setup([
      { sent: 0, alreadySent: false, skipped },
      { sent: 1, failed: 0, alreadySent: false },
      { sent: 1, failed: 0, alreadySent: false },
    ]);
    clickResend();
    await screen.findByText(`No confirmation messages were sent. ${explanation} Retrying keeps this request.`);
    expect(screen.queryByText(/Transactional ticket confirmation sent/)).not.toBeInTheDocument();
    clickResend();
    await screen.findByText('1 confirmation message sent. Stripe’s payment receipt is separate.');
    expect(requestIds(resend)[1]).toBe(requestIds(resend)[0]);
    clickResend();
    await waitFor(() => expect(resend).toHaveBeenCalledTimes(3));
    expect(requestIds(resend)[2]).not.toBe(requestIds(resend)[1]);
  });

  it('keeps an already-recorded response without prior completion under review', async () => {
    const { resend } = await setup([{ sent: 0, failed: 0, alreadySent: true }, { sent: 0, failed: 0, alreadySent: true }]);
    clickResend();
    await screen.findByText(/Delivery is still unconfirmed/);
    clickResend();
    await waitFor(() => expect(resend).toHaveBeenCalledTimes(2));
    expect(new Set(requestIds(resend)).size).toBe(1);
  });

  it.each([
    [{ sent: 0, failed: 0, alreadySent: false }, /No confirmation messages were sent\. Review the order’s recipients/],
    [{}, /The confirmation response did not confirm delivery/],
  ])('keeps an empty or unrecognized outcome from reporting success', async (outcome, message) => {
    const { resend } = await setup([outcome, outcome]);
    clickResend();
    await screen.findByText(message);
    clickResend();
    await waitFor(() => expect(resend).toHaveBeenCalledTimes(2));
    expect(new Set(requestIds(resend)).size).toBe(1);
  });

  it('scopes a retained request to its order when the selected order changes', async () => {
    const { resend, props, rerender } = await setup([{ sent: 0, failed: 1, alreadySent: false }, { sent: 1, failed: 0, alreadySent: false }]);
    clickResend();
    await screen.findByText(/1 message failed or could not be confirmed/);
    rerender(<StripeOrderDetail {...props} orderId="order-2" />);
    await screen.findByRole('heading', { name: 'order-2' });
    clickResend();
    await screen.findByText('1 confirmation message sent. Stripe’s payment receipt is separate.');
    expect(resend.mock.calls[0][0].orderId).toBe('order-1');
    expect(resend.mock.calls[1][0].orderId).toBe('order-2');
    expect(requestIds(resend)[1]).not.toBe(requestIds(resend)[0]);
  });
});
