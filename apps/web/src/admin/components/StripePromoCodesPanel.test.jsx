import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import StripePromoCodesPanel from './StripePromoCodesPanel.jsx';

const CATALOG = {
  currency: 'usd',
  ticketTypes: [
    { id: 'general', name: 'Full event pass', unitAmount: 2500 },
    { id: 'student', name: 'Student pass', unitAmount: 1000 },
    { id: 'free', name: 'Volunteer', unitAmount: 0 },
  ],
};
const EARLY = {
  code: 'EARLY', kind: 'percent', value: 20, ticketTypeIds: [], maxUses: 10, maxPerOrder: null,
  startsAt: null, endsAt: '2026-11-20T05:00:00.000Z', active: true, used: 3,
};
const PRESS = { ...EARLY, code: 'PRESS', kind: 'amount', value: 500, ticketTypeIds: ['student'], maxUses: null, endsAt: null, active: false, used: 0 };

function setup(codes = [EARLY, PRESS]) {
  let stored = codes;
  const call = vi.fn(async (_name, body) => {
    if (body.action === 'promoCodes') return { codes: stored };
    if (body.action === 'savePromoCode') {
      const saved = { ...body.promo, code: body.promo.code.toUpperCase(), used: 0 };
      stored = [...stored.filter((code) => code.code !== saved.code), saved];
      return { codes: stored };
    }
    if (body.action === 'deletePromoCode') {
      stored = stored.filter((code) => code.code !== body.code);
      return { codes: stored };
    }
    throw new Error(`Unexpected action: ${body.action}`);
  });
  render(<StripePromoCodesPanel call={call} catalog={CATALOG} timezone="America/New_York" />);
  return { call };
}

describe('promo codes panel', () => {
  it('lists each code with its discount, its tickets, its uses and its end on the event clock', async () => {
    setup();
    const early = await screen.findByRole('listitem', { name: 'EARLY' });
    expect(within(early).getByText('20% off each ticket')).toBeInTheDocument();
    expect(within(early).getByText('All paid tickets')).toBeInTheDocument();
    expect(within(early).getByText('Used 3 of 10')).toBeInTheDocument();
    expect(within(early).getByText(/Ends .*Nov.*20, 2026/)).toBeInTheDocument();
    const press = screen.getByRole('listitem', { name: 'PRESS' });
    expect(within(press).getByText('$5.00 off each ticket')).toBeInTheDocument();
    expect(within(press).getByText('Student pass')).toBeInTheDocument();
    expect(within(press).getByText('Inactive')).toBeInTheDocument();
    // A used code is kept for its orders; only an unused one can be deleted.
    expect(within(early).queryByRole('button', { name: 'Delete EARLY' })).not.toBeInTheDocument();
    expect(within(press).getByRole('button', { name: 'Delete PRESS' })).toBeInTheDocument();
  });

  it('creates an amount code in major units, limited to the chosen paid tickets', async () => {
    const { call } = setup([]);
    fireEvent.click(await screen.findByRole('button', { name: 'New promo code' }));
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'speaker' } });
    fireEvent.change(screen.getByLabelText('Discount'), { target: { value: 'amount' } });
    fireEvent.change(screen.getByLabelText('Amount off each ticket (USD)'), { target: { value: '12.50' } });
    // A free ticket type cannot be discounted, so it is not offered.
    expect(screen.queryByLabelText('Volunteer')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Full event pass'));
    fireEvent.change(screen.getByLabelText('Use limit (tickets)'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save promo code' }));
    await screen.findByText('Promo code saved.');
    const save = call.mock.calls.find(([, body]) => body.action === 'savePromoCode')[1];
    expect(save).toEqual({
      action: 'savePromoCode', create: true,
      promo: {
        code: 'speaker', kind: 'amount', value: 1250, ticketTypeIds: ['general'], maxUses: 25, maxPerOrder: null,
        startsAt: null, endsAt: null, active: true,
      },
    });
    expect(screen.getByRole('listitem', { name: 'SPEAKER' })).toBeInTheDocument();
  });

  it('marks a bad value and sends nothing', async () => {
    const { call } = setup([]);
    fireEvent.click(await screen.findByRole('button', { name: 'New promo code' }));
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'no' } });
    fireEvent.change(screen.getByLabelText('Percent off'), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save promo code' }));
    expect(await screen.findByText('Enter a whole percent from 1 to 100.')).toBeInTheDocument();
    expect(screen.getByText(/Use 3 to 32 letters/)).toBeInTheDocument();
    expect(call.mock.calls.some(([, body]) => body.action === 'savePromoCode')).toBe(false);
  });

  it('edits a code without changing its name, and deletes an unused one after a confirmation', async () => {
    const { call } = setup();
    const early = await screen.findByRole('listitem', { name: 'EARLY' });
    fireEvent.click(within(early).getByRole('button', { name: 'Edit EARLY' }));
    expect(screen.queryByLabelText('Code')).toBeNull();
    fireEvent.change(screen.getByLabelText('Percent off'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save promo code' }));
    await screen.findByText('Promo code saved.');
    const save = call.mock.calls.find(([, body]) => body.action === 'savePromoCode')[1];
    expect(save.create).toBe(false);
    expect(save.promo).toMatchObject({ code: 'EARLY', value: 25, maxUses: 10 });
    expect(save.promo).not.toHaveProperty('used');

    fireEvent.click(within(screen.getByRole('listitem', { name: 'PRESS' })).getByRole('button', { name: 'Delete PRESS' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete code' }));
    await waitFor(() => expect(screen.queryByRole('listitem', { name: 'PRESS' })).not.toBeInTheDocument());
    expect(call).toHaveBeenCalledWith('ticketingCommerceAdmin', { action: 'deletePromoCode', code: 'PRESS' });
  });
});
