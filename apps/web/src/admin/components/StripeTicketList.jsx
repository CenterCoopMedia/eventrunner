import { useCallback, useEffect, useRef, useState } from 'react';
import { formatTicketMoney, formatTicketTime, ticketStatusLabel } from '../../lib/ticketingCommerce.js';
import { AdminEmptyState, AdminLoadingState, StatusBadge } from './adminChrome.jsx';
import { Notice, Panel, secondaryButtonClass, SelectField, TextField, linkButtonClass } from './formControls.jsx';

export function TicketingTable({ label, children }) {
  return <div role="region" aria-label={label} tabIndex={0} className="max-h-[32rem] overflow-auto rounded-admin border-admin-hairline border-admin-rule-hairline"><table className="w-full min-w-[48rem] border-collapse text-admin-sm">{children}</table></div>;
}
export function TicketingHead({ children }) {
  return <th scope="col" className="sticky top-0 z-10 border-b-admin-strong border-admin-rule-strong bg-admin-ground-soft px-sm py-xs text-start text-admin-xs font-semibold text-admin-ink-secondary">{children}</th>;
}
export const cellClass = 'px-sm py-xs text-admin-ink-secondary';
export const dataCellClass = 'px-sm py-xs font-admin-data text-admin-ink-data';

/** Each search owns its cursor. A late response cannot append rows from a previous filter. */
export default function StripeTicketList({ call, kind, catalog, timezone, refreshToken, onOpenOrder }) {
  const [filters, setFilters] = useState({ search: '', paymentStatus: '', refundStatus: '', ticketTypeId: '', status: '', claimState: '', checkInState: '' });
  const [submitted, setSubmitted] = useState({});
  const [rows, setRows] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const runRef = useRef(0);
  const busyRef = useRef(false);
  const activeRef = useRef(true);
  const isOrders = kind === 'orders';
  const label = isOrders ? 'Orders' : 'Admission tickets';
  useEffect(() => { activeRef.current = true; return () => { activeRef.current = false; runRef.current += 1; }; }, []);

  const search = useCallback(async (criteria, appendCursor = null) => {
    if (appendCursor && busyRef.current) return;
    const run = ++runRef.current;
    busyRef.current = true;
    setBusy(true);
    setError('');
    if (!appendCursor) { setCursor(null); setRows(null); }
    try {
      const body = Object.fromEntries(Object.entries(criteria).filter(([, value]) => value));
      const result = await call('ticketingCommerceAdmin', { action: kind, limit: 25, ...body, ...(appendCursor ? { cursor: appendCursor } : {}) });
      if (run !== runRef.current || !activeRef.current) return;
      setRows((previous) => appendCursor ? [...(previous || []), ...(result[kind] || [])] : result[kind] || []);
      setCursor(result.nextCursor || null);
    } catch (err) { if (run === runRef.current && activeRef.current) setError(err.message); }
    finally { if (run === runRef.current && activeRef.current) { busyRef.current = false; setBusy(false); } }
  }, [call, kind]);

  useEffect(() => { search(submitted); }, [search, submitted, refreshToken]);
  const setFilter = (key, value) => setFilters((previous) => ({ ...previous, [key]: value }));
  const options = (values) => [{ value: '', label: 'Any' }, ...values.map((value) => ({ value, label: ticketStatusLabel(value) }))];

  return <Panel title={label} description={isOrders ? 'Search purchaser email or order reference. Financial amounts retain the original purchase record.' : 'Search attendee email or ticket code. Each row represents one seat.'}>
    <form className="mb-md grid items-end gap-sm sm:grid-cols-2 lg:grid-cols-3" onSubmit={(event) => { event.preventDefault(); setSubmitted({ ...filters }); }}>
      <TextField label={isOrders ? 'Find a purchaser or order' : 'Find an attendee or ticket'} type="search" value={filters.search} onChange={(value) => setFilter('search', value.trimStart())} />
      {isOrders ? <>
        <SelectField label="Payment state" value={filters.paymentStatus} onChange={(value) => setFilter('paymentStatus', value)} options={options(['unpaid', 'pending', 'succeeded', 'failed', 'expired'])} />
        <SelectField label="Refund state" value={filters.refundStatus} onChange={(value) => setFilter('refundStatus', value)} options={options(['none', 'pending', 'partial', 'full', 'failed', 'requires_action'])} />
      </> : <>
        <SelectField label="Ticket type filter" value={filters.ticketTypeId} onChange={(value) => setFilter('ticketTypeId', value)} options={[{ value: '', label: 'Any ticket type' }, ...(catalog?.ticketTypes || []).map((type) => ({ value: type.id, label: type.name }))]} />
        <SelectField label="Admission state" value={filters.status} onChange={(value) => setFilter('status', value)} options={options(['valid', 'cancelled', 'refunded', 'pending_info'])} />
        <SelectField label="Claim state" value={filters.claimState} onChange={(value) => setFilter('claimState', value)} options={[{ value: '', label: 'Any' }, { value: 'claimed', label: 'Claimed' }, { value: 'unclaimed', label: 'Unclaimed' }]} />
        <SelectField label="Check-in state" value={filters.checkInState} onChange={(value) => setFilter('checkInState', value)} options={[{ value: '', label: 'Any' }, { value: 'checked_in', label: 'Checked in' }, { value: 'not_checked_in', label: 'Not checked in' }]} />
      </>}
      <button type="submit" className={secondaryButtonClass} aria-busy={busy}>{isOrders ? 'Search orders' : 'Search admission tickets'}</button>
    </form>
    {error ? <Notice tone="error" message={error} /> : null}
    {rows === null && !error ? <AdminLoadingState label={`Loading ${label.toLowerCase()}…`} /> : rows?.length === 0 ? <AdminEmptyState title={`No ${label.toLowerCase()} found`} description="Adjust the filters to find another record." /> : rows?.length ? <>
      <p role="status" className="mb-xs text-admin-sm text-admin-ink-secondary">Showing {rows.length} {isOrders ? 'orders' : 'tickets'}{cursor ? '; more are available' : ''}.</p>
      <TicketingTable label={label}>
        <thead><tr>{(isOrders ? ['Order reference', 'Purchaser', 'Payment', 'Refund', 'Total', 'Created'] : ['Ticket code', 'Attendee', 'Email', 'Type', 'Admission', 'Claim', 'Check-in', 'Order']).map((column) => <TicketingHead key={column}>{column}</TicketingHead>)}</tr></thead>
        <tbody>{rows.map((row) => <tr key={row.orderId && isOrders ? row.orderId : row.externalId || row.id} className="border-b-admin-hairline border-admin-rule-hairline last:border-b-0">
          {isOrders ? <>
            <td className={dataCellClass}><button type="button" className={linkButtonClass} onClick={() => onOpenOrder(row.orderId || row.id)}>{row.orderId || row.id}</button></td>
            <td className={dataCellClass}>{row.purchaserEmail || row.purchaser?.email || 'Not available'}</td>
            <td className={cellClass}><StatusBadge>{ticketStatusLabel(row.paymentStatus)}</StatusBadge></td>
            <td className={cellClass}>{ticketStatusLabel(row.refundStatus || 'none')}</td>
            <td className={dataCellClass}>{formatTicketMoney(row.totalAmount, row.currency)}</td>
            <td className={dataCellClass}>{formatTicketTime(row.createdAt, timezone)}</td>
          </> : <>
            <td className={dataCellClass}>{row.externalId || row.id}</td>
            <td className={cellClass}>{[row.firstName, row.lastName].filter(Boolean).join(' ') || 'Not provided'}</td>
            <td className={dataCellClass}>{row.email}</td>
            <td className={cellClass}>{row.ticketClass}</td>
            <td className={cellClass}><StatusBadge tone={row.status === 'valid' ? 'ok' : 'caution'}>{ticketStatusLabel(row.status)}</StatusBadge></td>
            <td className={cellClass}>{row.claimedByUid ? 'Claimed' : 'Unclaimed'}</td>
            <td className={cellClass}>{row.checkedInAt ? 'Checked in' : 'Not checked in'}</td>
            <td className={cellClass}><button type="button" className={linkButtonClass} onClick={() => onOpenOrder(row.orderId)}>Inspect order</button></td>
          </>}
        </tr>)}</tbody>
      </TicketingTable>
    </> : null}
    {cursor ? <button type="button" className={`${secondaryButtonClass} mt-sm`} aria-busy={busy} aria-disabled={busy} onClick={() => search(submitted, cursor)}>{busy ? 'Loading…' : `Load more ${isOrders ? 'orders' : 'tickets'}`}</button> : null}
  </Panel>;
}
