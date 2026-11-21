// Sales windows on the event's clock (issue #476). Ending early bird at
// 11:59 PM Eastern on January 15 used to mean typing 2027-01-16T04:59 in a
// UTC field. Staff now pick the date and time they mean; the stored value
// is still the UTC instant the catalog contract takes.
import { useLayoutEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import StripeCatalogPanel from './StripeCatalogPanel.jsx';

afterEach(cleanup);

const TYPE = { id: 'early', name: 'Early bird', description: '', unitAmount: 2000, capacity: 50, active: true, visibility: 'public', minPerOrder: 1, maxPerOrder: 4, salesStartAt: null, salesEndAt: null };
const CATALOG = { schemaVersion: 1, revision: 1, published: false, salesPaused: true, currency: 'usd', capacity: 100, maxPerOrder: 10, refundPolicy: '', taxTreatment: 'inclusive', commercialTermsConfirmed: false, salesStartAt: '2026-11-16T14:00:00.000Z', salesEndAt: null, ticketTypes: [TYPE] };

function Surface({ call, onCatalogChange }) {
  const [data, setData] = useState({ catalog: CATALOG, mode: 'test' });
  useLayoutEffect(() => {
    onCatalogChange?.(data.catalog);
  }, [data.catalog, onCatalogChange]);
  return <StripeCatalogPanel call={call} data={data} isOperator timezone="America/New_York" onSaved={setData} />;
}

function saving() {
  return vi.fn(async (_name, body) => ({ catalog: { ...body.catalog, revision: 2 }, mode: 'test' }));
}

const typeFieldset = () => screen.getByRole('group', { name: 'Early bird' });

describe('catalog sales windows', () => {
  it('reads a stored sales start back on the event’s clock with its zone and offset', () => {
    render(<Surface call={saving()} />);
    expect(screen.getByLabelText('Event sales start Date')).toHaveValue('2026-11-16');
    expect(screen.getByLabelText('Event sales start Time')).toHaveValue('09:00');
    expect(screen.getByText('Sales start Monday, November 16, 2026 at 9:00 AM Eastern Standard Time (UTC−05:00).')).toBeInTheDocument();
    expect(screen.getByText('No end restriction.')).toBeInTheDocument();
    expect(screen.queryByText(/\(UTC\)|entered in UTC/)).toBeNull();
  });

  it('ends early bird at 11:59 PM Eastern on January 15 without any UTC arithmetic', async () => {
    const call = saving();
    render(<Surface call={call} />);
    fireEvent.change(within(typeFieldset()).getByLabelText('Ticket sales end Date'), { target: { value: '2027-01-15' } });
    fireEvent.change(within(typeFieldset()).getByLabelText('Ticket sales end Time'), { target: { value: '23:59' } });
    expect(within(typeFieldset()).getByText('Sales end Friday, January 15, 2027 at 11:59 PM Eastern Standard Time (UTC−05:00).')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save ticket settings' }));
    await screen.findByText('Catalog saved. Existing orders keep the prices they were issued with.');
    const sent = call.mock.calls.find(([, body]) => body.action === 'saveCatalog')[1].catalog;
    expect(sent.ticketTypes[0].salesEndAt).toBe('2027-01-16T04:59:00.000Z');
    expect(sent.salesStartAt).toBe('2026-11-16T14:00:00.000Z');
    expect(sent.salesEndAt).toBeNull();
  });

  it('clears a sales start to no restriction', async () => {
    const call = saving();
    render(<Surface call={call} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear event sales start' }));
    expect(screen.getByText('No start restriction.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save ticket settings' }));
    await waitFor(() => expect(call).toHaveBeenCalled());
    expect(call.mock.calls[0][1].catalog.salesStartAt).toBeNull();
  });

  it('holds the save for half a date and time, and for a time the clocks skip', async () => {
    const call = saving();
    render(<Surface call={call} />);
    fireEvent.change(screen.getByLabelText('Event sales end Date'), { target: { value: '2027-03-14' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save ticket settings' }));
    expect(call).not.toHaveBeenCalled();
    expect(screen.getByText('Correct the marked sales times before saving.')).toBeInTheDocument();
    expect(screen.getByText('Enter a time.')).toBeInTheDocument();
    expect(screen.getByLabelText('Event sales end Time')).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(screen.getByLabelText('Event sales end Time'), { target: { value: '02:15' } });
    expect(screen.getByText(/2:15 AM does not exist on March 14, 2027/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save ticket settings' }));
    expect(call).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Event sales end Time'), { target: { value: '03:15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save ticket settings' }));
    await waitFor(() => expect(call).toHaveBeenCalled());
    expect(call.mock.calls[0][1].catalog.salesEndAt).toBe('2027-03-14T07:15:00.000Z');
  });

  it('can save as soon as reload discards half-entered event and ticket sales times', async () => {
    let saves = 0;
    const call = vi.fn(async (_name, body) => {
      if (body.action === 'catalog') return { catalog: { ...CATALOG, revision: 2 }, mode: 'test' };
      saves += 1;
      if (saves === 1) throw new Error('The save response was lost.');
      return { catalog: { ...body.catalog, revision: 3 }, mode: 'test' };
    });
    function saveOnReload(catalog) {
      if (catalog.revision !== 2) return;
      expect(screen.getByText('The current saved catalog is loaded. Review it before making more changes.')).toBeInTheDocument();
      expect(screen.getByLabelText('Event sales end Date')).toHaveValue('');
      expect(within(typeFieldset()).getByLabelText('Ticket sales start Date')).toHaveValue('');
      const save = screen.getByRole('button', { name: 'Save ticket settings' });
      expect(save).toHaveAttribute('aria-disabled', 'false');
      // Click at the first committed render, before the old date fields' passive cleanup.
      save.click();
    }
    render(<Surface call={call} onCatalogChange={saveOnReload} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save ticket settings' }));
    await screen.findByText('The save response was lost.');
    fireEvent.change(screen.getByLabelText('Event sales end Date'), { target: { value: '2027-03-14' } });
    fireEvent.change(within(typeFieldset()).getByLabelText('Ticket sales start Date'), { target: { value: '2027-02-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Discard unsaved edits and reload catalog' }));
    await screen.findByText('Catalog saved. Existing orders keep the prices they were issued with.');
    expect(call).toHaveBeenLastCalledWith('ticketingCommerceAdmin', {
      action: 'saveCatalog', expectedRevision: 2, catalog: { ...CATALOG, revision: 2 },
    });
  });

  it('marks a sales time and a price in one refused save', () => {
    const call = saving();
    render(<Surface call={call} />);
    fireEvent.change(screen.getByLabelText('Event sales end Date'), { target: { value: '2027-03-14' } });
    fireEvent.change(within(typeFieldset()).getByLabelText(/^Price/), { target: { value: '-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save ticket settings' }));
    expect(call).not.toHaveBeenCalled();
    expect(screen.getByText('Correct the marked sales times and ticket prices before saving.')).toBeInTheDocument();
    expect(screen.getByText('Enter a time.')).toBeInTheDocument();
    expect(screen.getByText(/Enter a non-negative price/)).toBeInTheDocument();
  });

  it('drops the hold of a ticket type removed before it was saved', async () => {
    const call = saving();
    render(<Surface call={call} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add ticket type' }));
    const added = screen.getAllByRole('group', { name: /Ticket type 2/ })[0];
    fireEvent.change(within(added).getByLabelText('Ticket sales start Date'), { target: { value: '2027-01-01' } });
    fireEvent.click(within(added).getByRole('button', { name: 'Remove ticket type' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save ticket settings' }));
    await waitFor(() => expect(call).toHaveBeenCalled());
  });

  it('keeps a half-entered sales time as an unsaved edit when a new revision lands', () => {
    const props = { call: saving(), isOperator: true, timezone: 'America/New_York', onSaved: vi.fn() };
    const { rerender } = render(<StripeCatalogPanel {...props} data={{ catalog: CATALOG, mode: 'test' }} />);
    // The date alone does not name an instant yet, so the draft is unchanged.
    fireEvent.change(screen.getByLabelText('Event sales end Date'), { target: { value: '2027-01-15' } });
    // Another operator saves an end time while that date is half entered.
    rerender(<StripeCatalogPanel {...props} data={{ catalog: { ...CATALOG, revision: 2, salesEndAt: '2027-02-01T05:00:00.000Z' }, mode: 'test' }} />);
    expect(screen.getByLabelText('Event sales end Date')).toHaveValue('2027-01-15');
    expect(screen.queryByText('The editor now shows the current saved catalog.')).toBeNull();
    expect(screen.getByText(/The saved catalog has changed/)).toBeInTheDocument();
  });
});
