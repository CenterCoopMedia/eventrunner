// The Stripe workspace as an operator sees it: a sales change from the
// summary panel saves a new catalog revision, and the open catalog editor
// must follow it when it holds no unsaved edits.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../../contexts/AuthContext.jsx', () => ({ useAuth: () => ({ isOperator: true, user: { uid: 'operator-synthetic' } }) }));
vi.mock('../../contexts/EventConfigContext.jsx', () => ({ useEventConfig: () => ({ eventConfig: { name: 'Synthetic event', timezone: 'UTC' } }) }));

import StripeTicketingWorkspace from './StripeTicketingWorkspace.jsx';

const TYPE = { id: 'general', name: 'General admission', description: '', unitAmount: 2500, capacity: 100, active: true, visibility: 'public', minPerOrder: 1, maxPerOrder: 10, salesStartAt: null, salesEndAt: null };
const CATALOG = { schemaVersion: 1, revision: 1, published: true, salesPaused: true, currency: 'usd', capacity: 100, maxPerOrder: 10, refundPolicy: 'Contact the organizer.', taxTreatment: 'inclusive', commercialTermsConfirmed: true, salesStartAt: null, salesEndAt: null, ticketTypes: [TYPE] };
const CHANGED = 'The saved catalog has changed. Your unsaved edits are still here; reload to use the current saved version.';

let saved;
const call = vi.fn();

beforeEach(() => {
  saved = CATALOG;
  call.mockReset();
  call.mockImplementation(async (_name, body) => {
    if (body.action === 'catalog') return { mode: 'test', catalog: saved, inventory: { held: 0, sold: 0 } };
    if (body.action === 'pauseSales') {
      saved = { ...saved, revision: saved.revision + 1, salesPaused: body.paused };
      return { mode: 'test', catalog: saved, inventory: { held: 0, sold: 0 } };
    }
    if (body.action === 'saveCatalog') {
      saved = { ...body.catalog, revision: saved.revision + 1 };
      return { mode: 'test', catalog: saved };
    }
    if (body.action === 'orders') return { orders: [], nextCursor: null };
    if (body.action === 'tickets') return { tickets: [], nextCursor: null };
    throw new Error(`Unexpected action: ${body.action}`);
  });
});

async function reopenSales() {
  render(<StripeTicketingWorkspace call={call} />);
  await screen.findByRole('heading', { name: 'Stripe sales' });
  fireEvent.click(screen.getByRole('button', { name: 'Review reopening sales' }));
  const dialog = screen.getByRole('dialog', { name: 'Reopen new ticket sales?' });
  fireEvent.change(within(dialog).getByLabelText(/Reason for changing sales/), { target: { value: 'Launch approved.' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Reopen new sales' }));
  await screen.findByText('New sales enabled');
}

describe('catalog editor after a sales change', () => {
  it('follows the new saved catalog without a warning when the editor holds no edits', async () => {
    await reopenSales();
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Pause new sales' })).not.toBeChecked());
    expect(screen.queryByText(CHANGED)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Discard unsaved edits and reload catalog' })).not.toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Save catalog' });
    expect(submit).toHaveAttribute('aria-disabled', 'false');
    // A save from the rebased editor keeps sales open and names the new revision.
    fireEvent.click(submit);
    await screen.findByText('Catalog saved. Existing orders keep the prices they were issued with.');
    const write = call.mock.calls.map(([, body]) => body).find((body) => body.action === 'saveCatalog');
    expect(write).toMatchObject({ expectedRevision: 2, catalog: { salesPaused: false } });
  });

  it('keeps the warning and the unsaved edits when the editor holds real changes', async () => {
    render(<StripeTicketingWorkspace call={call} />);
    await screen.findByRole('heading', { name: 'Stripe sales' });
    fireEvent.change(screen.getByLabelText('Ticket name'), { target: { value: 'Unsaved early bird' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review reopening sales' }));
    const dialog = screen.getByRole('dialog', { name: 'Reopen new ticket sales?' });
    fireEvent.change(within(dialog).getByLabelText(/Reason for changing sales/), { target: { value: 'Launch approved.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reopen new sales' }));
    expect(await screen.findByText(CHANGED)).toBeInTheDocument();
    expect(screen.getByLabelText('Ticket name')).toHaveValue('Unsaved early bird');
    expect(screen.getByRole('button', { name: 'Save catalog' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('treats an edit typed back to the saved value as no edit', async () => {
    render(<StripeTicketingWorkspace call={call} />);
    await screen.findByRole('heading', { name: 'Stripe sales' });
    fireEvent.change(screen.getByLabelText('Price (USD)'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('Price (USD)'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review reopening sales' }));
    const dialog = screen.getByRole('dialog', { name: 'Reopen new ticket sales?' });
    fireEvent.change(within(dialog).getByLabelText(/Reason for changing sales/), { target: { value: 'Launch approved.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reopen new sales' }));
    await screen.findByText('New sales enabled');
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Pause new sales' })).not.toBeChecked());
    expect(screen.queryByText(CHANGED)).not.toBeInTheDocument();
  });
});
