import { useEffect, useRef, useState } from 'react';
import ExternalLink from '../../components/ExternalLink.jsx';
import { Checkbox } from '../../components/forms/Choice.jsx';
import { formatTicketMoney, formatTicketTime, newTicketingRequestId, safeStripeDashboardUrl, ticketStatusLabel } from '../../lib/ticketingCommerce.js';
import { AdminLoadingState, StatusBadge } from './adminChrome.jsx';
import { Notice, Panel, secondaryButtonClass, dangerButtonClass, linkButtonClass, TextAreaField, TextField, SelectField } from './formControls.jsx';
import TicketingConfirmation from './TicketingConfirmation.jsx';
import { TicketingTable, TicketingHead, cellClass, dataCellClass } from './StripeTicketList.jsx';

export default function StripeOrderDetail({ call, orderId, isOperator, timezone, onChanged, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState([]);
  const [confirm, setConfirm] = useState(null);
  const [reason, setReason] = useState('');
  const [edit, setEdit] = useState(null);
  const [refundId, setRefundId] = useState('');
  const [preserveAdmission, setPreserveAdmission] = useState(false);
  const busyRef = useRef(false);
  const resendRef = useRef(null);
  const headingRef = useRef(null);
  useEffect(() => { headingRef.current?.focus(); }, []);
  useEffect(() => {
    let active = true;
    setError('');
    call('ticketingCommerceAdmin', { action: 'order', orderId }).then((result) => { if (active) setData(result); }).catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [call, orderId, refresh]);
  const order = data?.order;
  const tickets = data?.tickets || [];
  const selectedTickets = tickets.filter((ticket) => selected.includes(ticket.externalId || ticket.id));
  const dashboardUrl = safeStripeDashboardUrl(data?.stripeDashboardUrl);
  const refunds = order?.refunds || data?.refunds || [];
  const selectedRefund = refunds.find((refund) => refund.id === refundId);

  async function run(body, message) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await call('ticketingCommerceAdmin', body);
      if (result.order && result.tickets) setData(result);
      else setRefresh((value) => value + 1);
      setNotice(result.alreadySent ? 'This confirmation request was already sent; it was not sent again.' : message);
      setConfirm(null);
      setEdit(null);
      setReason('');
      setSelected([]);
      onChanged();
    } catch (err) { setError(err.message); }
    finally { busyRef.current = false; setBusy(false); }
  }

  function closeConfirmation() { setConfirm(null); setEdit(null); setReason(''); setError(''); }
  function performConfirmed() {
    if (!reason.trim()) { setError('Enter a reason for the audit trail.'); return; }
    if (confirm === 'cancel') {
      run({ action: 'cancelTickets', orderId, ticketIds: selected, reason: reason.trim(), confirmed: true }, 'Selected tickets cancelled. No money was refunded and no seats were restocked.');
    } else if (confirm === 'refund') {
      if (!selectedRefund) { setError('Choose the refund being allocated.'); return; }
      if (!preserveAdmission && !selected.length) { setError('Select affected tickets or choose to keep every ticket valid.'); return; }
      run({ action: 'allocateRefund', orderId, refundId, ticketIds: preserveAdmission ? [] : selected, preserveAdmission, reason: reason.trim(), confirmed: true }, preserveAdmission ? 'Refund allocation recorded. Admission remains valid.' : 'Refund allocated to the selected tickets. Their admission has been removed.');
    } else if (confirm === 'edit') {
      if (!edit.firstName.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(edit.email.trim())) { setError('Enter the attendee’s name and a valid email.'); return; }
      run({ action: 'updateAttendee', ticketId: edit.ticketId, firstName: edit.firstName.trim(), lastName: edit.lastName.trim(), email: edit.email.trim(), reason: reason.trim() }, 'Attendee details corrected. Payment ownership is unchanged.');
    }
  }

  const selectedSummary = <ul className="space-y-xs">{selectedTickets.map((ticket) => <li key={ticket.externalId || ticket.id} className="wrap-anywhere"><span className="font-semibold">{ticket.firstName} {ticket.lastName}</span> — <span className="font-admin-data">{ticket.externalId || ticket.id}</span>{ticket.checkedInAt ? ' — already checked in' : ''}</li>)}</ul>;
  return <Panel title="Order details" actions={<button type="button" className={secondaryButtonClass} onClick={onClose}>Close order details</button>}>
    <h3 ref={headingRef} tabIndex={-1} className="mb-sm wrap-anywhere font-admin-data text-admin-base font-bold">{orderId}</h3>
    {!order && !error ? <AdminLoadingState label="Loading order details…" /> : null}
    {error && !confirm ? <Notice tone="error" message={error} /> : null}
    {notice ? <Notice tone="ok" message={notice} /> : null}
    {order ? <div className="space-y-md">
      <dl className="grid min-w-0 gap-md sm:grid-cols-2 lg:grid-cols-3">
        <div><dt className="text-admin-base font-semibold">Purchaser</dt><dd className="wrap-anywhere font-admin-data text-admin-sm">{order.purchaserEmail || order.purchaser?.email}</dd></div>
        <div><dt className="text-admin-base font-semibold">Payment</dt><dd><StatusBadge>{ticketStatusLabel(order.paymentStatus)}</StatusBadge></dd></div>
        <div><dt className="text-admin-base font-semibold">Original total</dt><dd className="font-admin-data text-admin-sm">{formatTicketMoney(order.totalAmount, order.currency)}</dd></div>
        <div><dt className="text-admin-base font-semibold">Refund state</dt><dd>{ticketStatusLabel(order.refundStatus || 'none')}</dd></div>
        <div><dt className="text-admin-base font-semibold">Refunded amount</dt><dd className="font-admin-data text-admin-sm">{formatTicketMoney(order.refundedAmount || 0, order.currency)}</dd></div>
        <div><dt className="text-admin-base font-semibold">Created</dt><dd className="font-admin-data text-admin-sm">{formatTicketTime(order.createdAt, timezone)}</dd></div>
      </dl>
      {order.reconciliationException ? <Notice tone="caution" message={typeof order.reconciliationException === 'string' ? order.reconciliationException : order.reconciliationException.message || 'Reconciliation needs operator attention.'} /> : null}
      <div className="flex flex-wrap gap-sm">
        <button type="button" className={secondaryButtonClass} aria-busy={busy} aria-disabled={busy} onClick={() => run({ action: 'reconcile', orderId }, 'Latest payment and ticket state requested from Stripe.')}>Resync this order</button>
        <button type="button" className={secondaryButtonClass} aria-busy={busy} aria-disabled={busy} onClick={() => {
          if (!resendRef.current) resendRef.current = newTicketingRequestId();
          run({ action: 'resend', orderId, requestId: resendRef.current }, 'Transactional ticket confirmation sent. Stripe’s payment receipt is separate.');
        }}>Resend ticket confirmation</button>
        {dashboardUrl ? <ExternalLink href={dashboardUrl} className={secondaryButtonClass}>Open this payment in Stripe Dashboard</ExternalLink> : null}
      </div>
      <p className="text-admin-sm text-admin-ink-secondary">Refund money through the authorized organizer’s Stripe Dashboard. Cancelling a ticket here removes admission without refunding the purchaser. Neither action returns sold seats to inventory. Payment amounts remain the original historical record.</p>
      <section className="space-y-sm" aria-label="Order admission tickets">
        <h3 className="text-admin-lg font-bold">Individual tickets</h3>
        <div className="flex flex-wrap items-center gap-sm">
          <p role="status" className="text-admin-sm">{selected.length ? `${selected.length} tickets selected` : 'No tickets selected'}</p>
          <button type="button" className={secondaryButtonClass} onClick={() => setSelected([])}>Clear selection</button>
          <button type="button" className={dangerButtonClass} aria-disabled={!selected.length || busy} onClick={() => {
            if (!selected.length) { setError('Select the tickets you want to cancel.'); return; }
            if (busy) return;
            setReason(''); setError(''); setConfirm('cancel');
          }}>Review ticket cancellation</button>
        </div>
        {tickets.length ? <TicketingTable label="Individual tickets on this order"><thead><tr>{['Select', 'Ticket code', 'Attendee', 'Email', 'Admission', 'Claim', 'Check-in', 'Correction'].map((column) => <TicketingHead key={column}>{column}</TicketingHead>)}</tr></thead>
          <tbody>{tickets.map((ticket) => {
            const id = ticket.externalId || ticket.id;
            return <tr key={id} className="border-b-admin-hairline border-admin-rule-hairline last:border-b-0">
              <td className={cellClass}><Checkbox tone="admin" label={<span className="sr-only">Select {ticket.firstName} {ticket.lastName}, {id}</span>} checked={selected.includes(id)} onChange={(event) => setSelected((previous) => event.target.checked ? [...previous, id] : previous.filter((selectedId) => selectedId !== id))} /></td>
              <td className={dataCellClass}>{id}</td>
              <td className={cellClass}>{ticket.firstName} {ticket.lastName}</td>
              <td className={dataCellClass}>{ticket.email}</td>
              <td className={cellClass}><StatusBadge tone={ticket.status === 'valid' ? 'ok' : 'caution'}>{ticketStatusLabel(ticket.status)}</StatusBadge></td>
              <td className={cellClass}>{ticket.claimedByUid ? 'Claimed' : 'Unclaimed'}</td>
              <td className={cellClass}>{ticket.checkedInAt ? 'Checked in' : 'Not checked in'}</td>
              <td className={cellClass}><button type="button" className={linkButtonClass} onClick={() => { setEdit({ ticketId: id, firstName: ticket.firstName || '', lastName: ticket.lastName || '', email: ticket.email || '', claimed: Boolean(ticket.claimedByUid), checkedIn: Boolean(ticket.checkedInAt) }); setReason(''); setError(''); setConfirm('edit'); }}>Correct attendee</button></td>
            </tr>;
          })}</tbody></TicketingTable> : <p className="text-admin-sm text-admin-ink-secondary">No admission tickets have been issued for this order.</p>}
      </section>
      {refunds.length ? <section className="space-y-sm">
        <h3 className="text-admin-lg font-bold">Refund history</h3>
        <ul className="space-y-xs">{refunds.map((refund) => <li key={refund.id} className="wrap-anywhere border-b-admin-hairline border-admin-rule-hairline pb-xs"><span className="font-admin-data">{refund.id}</span> — {formatTicketMoney(refund.amount, refund.currency || order.currency)} — {(refund.status === 'succeeded' ? 'Succeeded' : ticketStatusLabel(refund.status))} — {formatTicketTime(refund.createdAt, timezone)}{refund.failureReason ? ` — ${refund.failureReason}` : ''}</li>)}</ul>
        {isOperator ? <>
          <p className="text-admin-sm text-admin-ink-secondary">An amount-only partial refund does not identify which attendee loses admission. Record the organizer’s decision using the ticket selection above, or explicitly retain every ticket.</p>
          <SelectField label="Refund to allocate" value={refundId} onChange={setRefundId} options={[{ value: '', label: 'Choose a refund' }, ...refunds.map((refund) => ({ value: refund.id, label: `${refund.id} — ${formatTicketMoney(refund.amount, refund.currency || order.currency)} — ${(refund.status === 'succeeded' ? 'Succeeded' : ticketStatusLabel(refund.status))}` }))]} />
          <Checkbox tone="admin" label="Keep every ticket valid" checked={preserveAdmission} onChange={(event) => setPreserveAdmission(event.target.checked)} />
          <button type="button" className={secondaryButtonClass} onClick={() => {
            if (!refundId || (!preserveAdmission && !selected.length)) { setError('Choose a refund and select affected tickets, or choose to keep every ticket valid.'); return; }
            setReason(''); setError(''); setConfirm('refund');
          }}>Review refund allocation</button>
        </> : null}
      </section> : null}
      {order.disputes?.length ? <section className="space-y-sm"><h3 className="text-admin-lg font-bold">Payment disputes</h3><p className="text-admin-sm text-admin-ink-secondary">Review and respond in Stripe Dashboard. A dispute does not automatically change admission; check each ticket before deciding whether to cancel it.</p><ul className="space-y-xs">{order.disputes.map((dispute) => <li key={dispute.id} className="wrap-anywhere"><span className="font-admin-data">{dispute.id}</span> — {formatTicketMoney(dispute.amount, dispute.currency || order.currency)} — {ticketStatusLabel(dispute.status)}</li>)}</ul></section> : null}
      <section className="space-y-sm">
        <h3 className="text-admin-lg font-bold">Audit trail</h3>
        {data.audit?.length ? <ol className="space-y-sm">{data.audit.map((entry) => <li key={entry.id} className="space-y-3xs border-b-admin-hairline border-admin-rule-hairline pb-sm"><p className="font-semibold">{ticketStatusLabel(entry.action.replace(/^ticketing\./, '').replaceAll('-', '_'))}</p><p className="wrap-anywhere font-admin-data text-admin-xs">{formatTicketTime(entry.at, timezone)} · {entry.actorUid || 'Provider reconciliation'}</p>{entry.reason ? <p className="wrap-anywhere text-admin-sm">{entry.reason}</p> : null}{entry.ticketIds?.length ? <p className="wrap-anywhere font-admin-data text-admin-xs">Tickets: {entry.ticketIds.join(', ')}</p> : null}</li>)}</ol> : <p className="text-admin-sm text-admin-ink-secondary">No staff actions have been recorded for this order.</p>}
      </section>
    </div> : null}
    {confirm ? <TicketingConfirmation title={confirm === 'cancel' ? 'Cancel the selected admission tickets?' : confirm === 'refund' ? 'Record this refund’s admission consequences?' : 'Correct attendee details'} confirmLabel={confirm === 'cancel' ? `Cancel ${selected.length} admission tickets` : confirm === 'refund' ? preserveAdmission ? 'Record refund with admission retained' : `Remove admission from ${selected.length} tickets` : 'Save attendee correction'} destructive={confirm === 'cancel' || (confirm === 'refund' && !preserveAdmission)} error={error} busy={busy} onClose={closeConfirmation} onConfirm={performConfirmed}>
      {confirm === 'edit' ? <>
        <p className="wrap-anywhere font-admin-data text-admin-sm">Ticket: {edit.ticketId}</p>
        <TextField label="Corrected first name" value={edit.firstName} maxLength={100} onChange={(value) => setEdit((previous) => ({ ...previous, firstName: value }))} />
        <TextField label="Corrected last name" hint="Optional for attendees who use one name." value={edit.lastName} maxLength={100} onChange={(value) => setEdit((previous) => ({ ...previous, lastName: value }))} />
        <TextField label="Corrected attendee email" type="email" value={edit.email} maxLength={254} readOnly={edit.claimed || edit.checkedIn} hint={edit.claimed ? 'A claimed ticket cannot change email here. Ticket transfers require a separate verified workflow.' : edit.checkedIn ? 'A checked-in ticket cannot change email here.' : 'Use a correction only. This does not transfer payment ownership.'} onChange={(value) => setEdit((previous) => ({ ...previous, email: value }))} />
      </> : <>
        <p className="wrap-anywhere">Order: <span className="font-admin-data">{orderId}</span>. Original payment: {formatTicketMoney(order?.totalAmount, order?.currency)}.</p>
        {confirm === 'refund' ? <p>Refund {selectedRefund?.id}: {formatTicketMoney(selectedRefund?.amount, selectedRefund?.currency || order?.currency)} — {selectedRefund?.status === 'succeeded' ? 'Succeeded' : ticketStatusLabel(selectedRefund?.status)}.</p> : null}
        {preserveAdmission && confirm === 'refund' ? <p>All ticket admission stays as it is. This records an amount-only payment adjustment.</p> : <>{selectedSummary}<p>These tickets will lose admission, including any that have already been checked in. Sold seats will not be returned to capacity.</p></>}
        <p>No refund payment is created by this action.</p>
      </>}
      <TextAreaField label="Reason for this action" value={reason} onChange={setReason} required maxLength={500} />
    </TicketingConfirmation> : null}
  </Panel>;
}
