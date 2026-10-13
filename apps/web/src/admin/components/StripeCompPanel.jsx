import { useRef, useState } from 'react';
import { formatTicketMoney, newTicketingRequestId } from '../../lib/ticketingCommerce.js';
import { Notice, Panel, secondaryButtonClass, SelectField, TextAreaField, TextField } from './formControls.jsx';
import TicketingConfirmation from './TicketingConfirmation.jsx';

export default function StripeCompPanel({ call, catalog, onComplete }) {
  const [ticketTypeId, setTicketTypeId] = useState('');
  const [attendees, setAttendees] = useState([{ firstName: '', lastName: '', email: '' }]);
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState('');
  const type = catalog?.ticketTypes?.find((candidate) => candidate.id === ticketTypeId);
  const maximum = Math.min(catalog?.maxPerOrder || 20, type?.maxPerOrder || 20, 20);

  function review(event) {
    event.preventDefault();
    setError('');
    if (!type || !reason.trim() || !attendees.length || attendees.length > maximum || attendees.some((attendee) => !attendee.firstName.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(attendee.email.trim()))) {
      setError('Choose a ticket type, enter each attendee’s name and email, and provide a reason within the per-order limit.');
      return;
    }
    setConfirmation({ action: 'issueComp', ticketTypeId, attendees: attendees.map((attendee) => Object.fromEntries(Object.entries(attendee).map(([key, value]) => [key, value.trim()]))), requestId: newTicketingRequestId(), reason: reason.trim(), confirmed: true });
  }

  async function issue() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await call('ticketingCommerceAdmin', confirmation);
      setConfirmation(null);
      setAttendees([{ firstName: '', lastName: '', email: '' }]);
      setReason('');
      setNotice(`${result.tickets?.length || confirmation.attendees.length} complimentary tickets issued. No money was collected.`);
      onComplete(result.order?.orderId || result.order?.id);
    } catch (err) { setError(err.message); }
    finally { busyRef.current = false; setBusy(false); }
  }

  return <Panel title="Complimentary tickets" description="Issue free admission to named attendees. Comps reserve real capacity and do not create a payment or refund.">
    <form className="space-y-md" onSubmit={review}>
      <SelectField label="Comp ticket type" value={ticketTypeId} onChange={setTicketTypeId} options={[{ value: '', label: 'Choose a ticket type' }, ...(catalog?.ticketTypes || []).filter((candidate) => candidate.active).map((candidate) => ({ value: candidate.id, label: candidate.name }))]} />
      {attendees.map((attendee, index) => <fieldset className="space-y-sm border-admin-hairline border-admin-rule-hairline p-sm" key={index}>
        <legend className="text-admin-base font-bold">Comp attendee {index + 1}</legend>
        <div className="grid gap-sm sm:grid-cols-2">
          {['firstName', 'lastName', 'email'].map((field) => <TextField key={field} label={field === 'firstName' ? 'First name' : field === 'lastName' ? 'Last name' : 'Attendee email'} type={field === 'email' ? 'email' : 'text'} required={field !== 'lastName'} hint={field === 'lastName' ? 'Optional for attendees who use one name.' : undefined} maxLength={field === 'email' ? 254 : 100} value={attendee[field]} onChange={(value) => setAttendees((previous) => previous.map((row, current) => current === index ? { ...row, [field]: value } : row))} />)}
        </div>
        {attendees.length > 1 ? <button type="button" className={secondaryButtonClass} onClick={() => setAttendees((previous) => previous.filter((_, current) => current !== index))}>Remove comp attendee {index + 1}</button> : null}
      </fieldset>)}
      <button type="button" className={secondaryButtonClass} aria-disabled={attendees.length >= maximum} onClick={() => { if (attendees.length < maximum) setAttendees((previous) => [...previous, { firstName: '', lastName: '', email: '' }]); }}>{attendees.length >= maximum ? `Limit reached — ${maximum} attendees` : 'Add comp attendee'}</button>
      <TextAreaField label="Reason for complimentary admission" value={reason} onChange={setReason} required maxLength={500} />
      {error && !confirmation ? <Notice tone="error" message={error} /> : null}
      {notice ? <Notice tone="ok" message={notice} /> : null}
      <button type="submit" className={secondaryButtonClass}>Review complimentary tickets</button>
    </form>
    {confirmation ? <TicketingConfirmation title="Issue complimentary admission?" confirmLabel={`Issue ${confirmation.attendees.length} complimentary tickets`} busy={busy} error={error} onClose={() => { setConfirmation(null); setError(''); }} onConfirm={issue}>
      <p>{confirmation.attendees.length} × {type?.name}. Charge: {formatTicketMoney(0, catalog.currency)}. These seats count against event and ticket-type capacity.</p>
      <ul>{confirmation.attendees.map((attendee, index) => <li key={index} className="wrap-anywhere">{attendee.firstName} {attendee.lastName} — {attendee.email}</li>)}</ul>
      <p>Each attendee must claim their own admission using a verified email.</p>
      <p>Reason: {confirmation.reason}</p>
    </TicketingConfirmation> : null}
  </Panel>;
}
