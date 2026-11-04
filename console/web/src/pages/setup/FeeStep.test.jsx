import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api.js';
import { application, callsTo, serveApi } from '../../test/application.js';
import { renderPage } from '../../test/renderPage.jsx';
import { renderSetup } from '../../test/setupPage.jsx';
import FeeStep from './FeeStep.jsx';

vi.mock('../../api.js', async (importOriginal) => ({ ...(await importOriginal()), callApi: vi.fn() }));

const WAITING = { status: 'awaiting_payment', canEdit: false, canAccept: false, canPay: true };

const step = (overrides = {}, props = {}) => renderPage(
  <FeeStep app={application({ ...WAITING, ...overrides })} orgId="o1" appId="a1" onReopened={vi.fn()} {...props} />,
);

beforeEach(() => {
  serveApi();
});

describe('Fee step', () => {
  it('shows the fee and what happens when a payment fails or is cancelled', () => {
    step();
    expect(screen.getByText('$123.45')).toBeInTheDocument();
    expect(screen.getByText(/If your card is declined, we take no money/)).toBeInTheDocument();
    expect(screen.getByText(/If you cancel or close the page, we take no money/)).toBeInTheDocument();
    expect(screen.getByText(/waiting for payment confirmation/)).toBeInTheDocument();
  });

  it('never names the systems behind the console', () => {
    const { container } = step();
    expect(container.textContent).not.toMatch(/firebase|project|tenant|environment|webhook|secret|stripe|checkout/i);
  });

  it('opens the payment page, and sends no amount', async () => {
    const leave = vi.fn();
    serveApi({ startFeeCheckout: { url: 'https://pay.example/cs_1' } });
    step({}, { leave });
    fireEvent.click(screen.getByRole('button', { name: 'Pay the event fee' }));
    await vi.waitFor(() => expect(leave).toHaveBeenCalledWith('https://pay.example/cs_1'));
    expect(callsTo('startFeeCheckout')).toEqual([{ orgId: 'o1', appId: 'a1' }]);
  });

  it('offers no second way to pay when a payment already went through', async () => {
    const leave = vi.fn();
    serveApi({ startFeeCheckout: { alreadyPaid: true } });
    step({}, { leave });
    fireEvent.click(screen.getByRole('button', { name: 'Pay the event fee' }));
    expect(await screen.findByText(/you will not be charged again/)).toBeInTheDocument();
    expect(leave).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Pay the event fee' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See your request' })).toHaveAttribute('href', '/organizations/o1/applications/a1');
  });

  it('shows a refusal, and the button works again', async () => {
    serveApi({ startFeeCheckout: () => { throw new ApiError(502, 'payment-unavailable', 'We could not reach the payment service. Try again in a few minutes. We will not charge you twice.'); } });
    step();
    fireEvent.click(screen.getByRole('button', { name: 'Pay the event fee' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not reach the payment service.');
    expect(screen.getByRole('button', { name: 'Pay the event fee' })).toBeEnabled();
  });

  it('says plainly when no fee is set, and offers no payment', () => {
    step({ signups: { open: false, fee: null } });
    expect(screen.getByText(/This site is not taking sign-ups right now/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pay the event fee' })).not.toBeInTheDocument();
  });

  it('tells an Editor that only an Owner can pay', () => {
    step({ myRole: 'editor', canPay: false, canWithdraw: false });
    expect(screen.getByText(/Only an Owner can pay the event fee/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pay the event fee' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change your answers' })).not.toBeInTheDocument();
  });

  it('goes back to edit after one question, and Cancel changes nothing', async () => {
    let status = 'awaiting_payment';
    serveApi({
      getApplication: () => ({ application: application(status === 'draft' ? {} : WAITING) }),
      reopenApplication: () => { status = 'draft'; return { status }; },
    });
    renderSetup('fee');
    fireEvent.click(await screen.findByRole('button', { name: 'Change your answers' }));
    const group = screen.getByRole('group', { name: 'Change your answers' });
    fireEvent.click(within(group).getByRole('button', { name: 'Cancel' }));
    expect(callsTo('reopenApplication')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Change your answers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, change my answers' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Review' })).toBeInTheDocument();
    expect(callsTo('reopenApplication')).toEqual([{ orgId: 'o1', appId: 'a1' }]);
  });

  it('shows why going back was refused after a payment', async () => {
    serveApi({
      getApplication: { application: application(WAITING) },
      reopenApplication: () => { throw new ApiError(409, 'payment-received', 'We already received a payment for this request, so it cannot change now.'); },
    });
    renderSetup('fee');
    fireEvent.click(await screen.findByRole('button', { name: 'Change your answers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, change my answers' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('We already received a payment');
    expect(screen.getByRole('heading', { level: 1, name: 'Event fee' })).toBeInTheDocument();
  });
});
