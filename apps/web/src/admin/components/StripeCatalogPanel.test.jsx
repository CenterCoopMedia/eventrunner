import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import StripeCatalogPanel from './StripeCatalogPanel.jsx';

const TYPE = { id: 'general', name: 'General admission', description: '', unitAmount: 2500, capacity: 100, active: true, visibility: 'public', minPerOrder: 1, maxPerOrder: 10, salesStartAt: null, salesEndAt: null };
const CATALOG = { schemaVersion: 1, revision: 1, published: true, salesPaused: true, currency: 'usd', capacity: 100, maxPerOrder: 10, refundPolicy: 'Contact the organizer.', taxTreatment: 'inclusive', commercialTermsConfirmed: true, salesStartAt: null, salesEndAt: null, ticketTypes: [TYPE] };

function CatalogSurface({ call }) {
  const [data, setData] = useState({ catalog: CATALOG, mode: 'test' });
  return <StripeCatalogPanel call={call} data={data} isOperator timezone="UTC" onSaved={setData} />;
}

describe('catalog save reconciliation', () => {
  it.each([
    ['The save response was lost.', true, 'Saved version', 3000],
    ['The saved catalog changed.', false, 'Saved by another operator', 4500],
  ])('recovers after %s without overwriting the server with a stale revision', async (message, committed, savedName, savedPrice) => {
    let saved = CATALOG;
    let saves = 0;
    let resolveReload;
    const call = vi.fn(async (_name, body) => {
      if (body.action === 'catalog') return new Promise((resolve) => { resolveReload = () => resolve({ catalog: saved, mode: 'test' }); });
      if (body.action === 'saveCatalog') {
        expect(body.expectedRevision).toBe(saved.revision);
        saves += 1;
        saved = saves === 1 && !committed
          ? { ...CATALOG, revision: 2, ticketTypes: [{ ...TYPE, name: savedName, unitAmount: savedPrice }] }
          : { ...body.catalog, revision: saved.revision + 1 };
        if (saves === 1) throw new Error(message);
        return { catalog: saved, mode: 'test' };
      }
      throw new Error(`Unexpected action: ${body.action}`);
    });
    render(<CatalogSurface call={call} />);
    fireEvent.change(screen.getByLabelText('Ticket name'), { target: { value: 'Saved version' } });
    fireEvent.change(screen.getByLabelText('Price (USD)'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save catalog' }));
    await screen.findByText(message);
    expect(screen.getByLabelText('Ticket name')).toHaveValue('Saved version');
    fireEvent.change(screen.getByLabelText('Ticket name'), { target: { value: 'Unsaved later edit' } });
    fireEvent.change(screen.getByLabelText('Price (USD)'), { target: { value: '35' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save catalog' }));
    expect(saves).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'Discard unsaved edits and reload catalog' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('ticketingCommerceAdmin', { action: 'catalog' }));
    expect(screen.getByLabelText('Ticket name')).toHaveValue('Unsaved later edit');
    await act(async () => resolveReload());
    expect(screen.getByLabelText('Ticket name')).toHaveValue(savedName);
    expect(screen.getByLabelText('Price (USD)')).toHaveValue(String(savedPrice / 100));
    expect(screen.queryByText(message)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Ticket name'), { target: { value: 'New intentional edit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save catalog' }));
    await screen.findByText('Catalog saved. Existing orders keep the prices they were issued with.');
    const writes = call.mock.calls.filter(([, body]) => body.action === 'saveCatalog').map(([, body]) => body);
    expect(writes.map((body) => body.expectedRevision)).toEqual([1, 2]);
    expect(writes[1].catalog.ticketTypes[0]).toMatchObject({ name: 'New intentional edit', unitAmount: savedPrice });
  });

  it('preserves the draft when reconciliation fails and retries the read before allowing another save', async () => {
    let reads = 0;
    const call = vi.fn(async (_name, body) => {
      if (body.action === 'saveCatalog') throw new Error('The save outcome is unknown.');
      if (body.action === 'catalog') {
        reads += 1;
        if (reads === 1) throw new Error('The catalog reload failed.');
        return { catalog: { ...CATALOG, revision: 4, ticketTypes: [{ ...TYPE, name: 'Latest server version', unitAmount: 4000 }] } };
      }
      throw new Error(`Unexpected action: ${body.action}`);
    });
    render(<CatalogSurface call={call} />);
    fireEvent.change(screen.getByLabelText('Ticket name'), { target: { value: 'Retained draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save catalog' }));
    await screen.findByText('The save outcome is unknown.');
    fireEvent.click(screen.getByRole('button', { name: 'Discard unsaved edits and reload catalog' }));
    await screen.findByText('The catalog reload failed.');
    expect(screen.getByLabelText('Ticket name')).toHaveValue('Retained draft');
    fireEvent.click(screen.getByRole('button', { name: 'Save catalog' }));
    expect(call.mock.calls.filter(([, body]) => body.action === 'saveCatalog')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Discard unsaved edits and reload catalog' }));
    await waitFor(() => expect(screen.getByLabelText('Ticket name')).toHaveValue('Latest server version'));
    expect(screen.getByLabelText('Price (USD)')).toHaveValue('40');
    expect(screen.queryByRole('button', { name: 'Discard unsaved edits and reload catalog' })).not.toBeInTheDocument();
  });

  it('follows a revision that lands while a reload is in flight once the reload ends', async () => {
    let resolveReload;
    const call = vi.fn(async (_name, body) => {
      if (body.action === 'catalog') return new Promise((resolve) => { resolveReload = resolve; });
      throw new Error(`Unexpected action: ${body.action}`);
    });
    const props = { call, isOperator: true, timezone: 'UTC', onSaved: vi.fn() };
    const { rerender } = render(<StripeCatalogPanel {...props} data={{ catalog: CATALOG }} />);
    fireEvent.change(screen.getByLabelText('Ticket name'), { target: { value: 'Local unsaved change' } });
    rerender(<StripeCatalogPanel {...props} data={{ catalog: { ...CATALOG, revision: 2 } }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Discard unsaved edits and reload catalog' }));
    // A sales change saves revision 3 while the reload still reads revision 2.
    rerender(<StripeCatalogPanel {...props} data={{ catalog: { ...CATALOG, revision: 3, salesPaused: false } }} />);
    await act(async () => resolveReload({ catalog: { ...CATALOG, revision: 2 } }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Pause new sales' })).not.toBeChecked());
    expect(screen.getByText('The editor now shows the current saved catalog.')).toBeInTheDocument();
    expect(screen.queryByText(/The saved catalog has changed/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save catalog' })).toHaveAttribute('aria-disabled', 'false');
  });
});
