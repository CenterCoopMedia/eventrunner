import { plannerMessage } from '../plannerErrors.js';
import '../plannerFields.css';
import AdminIconControl from './AdminIconControl.jsx';
import { useRef, useState } from 'react';
import { MAX_ORDER_SEATS, normalizeAttendee } from 'shared/ticketCommerce';
import { formatTicketMoney, newTicketingRequestId } from '../../lib/ticketingDetails.js';
import { compCsvTemplate, readCompCsv } from '../compCsv.js';
import { saveTextFile } from '../downloadFile.js';
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
  const [uploadMode, setUploadMode] = useState(false);
  const [upload, setUpload] = useState(null);
  const inputRef = useRef(null);
  const uploadVersion = useRef(0);
  const type = catalog?.ticketTypes?.find((candidate) => candidate.id === ticketTypeId);
  const maximum = Math.min(catalog?.maxPerOrder || MAX_ORDER_SEATS, type?.maxPerOrder || MAX_ORDER_SEATS, MAX_ORDER_SEATS);

  async function loadCsv(file) {
    const version = ++uploadVersion.current;
    setUpload(null);
    setError('');
    setNotice('');
    if (!file) return;
    if (file.size > 256 * 1024) { setError('Choose a CSV file under 256 KB.'); return; }
    let text;
    try { text = await file.text(); }
    catch { if (version === uploadVersion.current) setError('The CSV file could not be read.'); return; }
    if (version !== uploadVersion.current) return;
    try { setUpload(readCompCsv(text)); }
    catch (err) { setError(err.message); }
  }

  function review(event) {
    event.preventDefault();
    setError('');
    if (uploadMode && (!upload || upload.errors.length)) {
      setError('Upload a CSV and correct every row error before reviewing.');
      return;
    }
    const assignments = uploadMode ? upload.attendees : attendees.map(normalizeAttendee);
    if (!type || !reason.trim() || !assignments.length || assignments.length > maximum || assignments.some((attendee) => !attendee)) {
      setError('Choose a ticket type, enter each attendee’s name and email, and provide a reason within the per-order limit.');
      return;
    }
    setConfirmation({
      action: uploadMode ? 'issueCompCsv' : 'issueComp', ticketTypeId, attendees: assignments,
      ...(uploadMode ? {} : { requestId: newTicketingRequestId() }),
      reason: reason.trim(), confirmed: true,
    });
  }

  async function issue() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await call('ticketingCommerceAdmin', confirmation);
      setConfirmation(null);
      if (confirmation.action === 'issueCompCsv') {
        setUpload(null);
        if (inputRef.current) inputRef.current.value = '';
      } else setAttendees([{ firstName: '', lastName: '', email: '' }]);
      setReason('');
      setNotice(result.reused ? 'This CSV matches an existing complimentary order. Review the current tickets in that order.' :
        `${result.tickets?.length || confirmation.attendees.length} complimentary tickets issued. No money was collected.`);
      onComplete(result.order?.orderId || result.order?.id);
    } catch (err) { setError(plannerMessage(err.message)); }
    finally { busyRef.current = false; setBusy(false); }
  }

  return <Panel title="Complimentary tickets" description="Issue free admission to named attendees. Comps reserve real capacity and do not create a payment or refund.">
    <form className="space-y-md" onSubmit={review}>
      <SelectField label="Comp ticket type" value={ticketTypeId} onChange={setTicketTypeId} options={[{ value: '', label: 'Choose a ticket type' }, ...(catalog?.ticketTypes || []).filter((candidate) => candidate.active).map((candidate) => ({ value: candidate.id, label: candidate.name }))]} />
      <button type="button" className={secondaryButtonClass} onClick={() => { setUploadMode(!uploadMode); setError(''); }}>{uploadMode ? 'Enter attendees manually' : 'Upload attendees from CSV'}</button>
      {uploadMode ? <div className="space-y-sm">
        <AdminIconControl label="Download complimentary ticket CSV template" icon="download" className={secondaryButtonClass} onClick={() => saveTextFile('complimentary-tickets.csv', compCsvTemplate)} />
        <label className="block">
          Complimentary ticket CSV
          <input ref={inputRef} className="block max-w-full" type="file" accept=".csv,text/csv" onChange={(event) => loadCsv(event.target.files?.[0])} />
        </label>
        <p>Upload up to {maximum} attendees of the selected ticket type in one batch.</p>
        {upload?.errors.length ? <ul aria-label="CSV row errors">{upload.errors.map(({ row, message }) => <li key={row}>Row {row}: {message}</li>)}</ul> : null}
        {upload ? <p role="status">{upload.attendees.length} valid {upload.attendees.length === 1 ? 'attendee' : 'attendees'}.</p> : null}
      </div> : <>
      {attendees.map((attendee, index) => <fieldset className="space-y-sm border-admin-hairline border-admin-rule-hairline p-sm" key={index}>
        <legend className="text-admin-base font-bold">Comp attendee {index + 1}</legend>
        <div className="planner-fields grid gap-sm sm:grid-cols-2">
          {['firstName', 'lastName', 'email'].map((field) => <TextField key={field} label={field === 'firstName' ? 'First name' : field === 'lastName' ? 'Last name' : 'Attendee email'} type={field === 'email' ? 'email' : 'text'} required={field !== 'lastName'} hint={field === 'lastName' ? 'Optional for attendees who use one name.' : undefined} maxLength={field === 'email' ? 254 : 100} value={attendee[field]} onChange={(value) => setAttendees((previous) => previous.map((row, current) => current === index ? { ...row, [field]: value } : row))} />)}
        </div>
        {attendees.length > 1 ? <AdminIconControl label={`Remove comp attendee ${index + 1}`} icon="remove" className={secondaryButtonClass} onClick={() => setAttendees((previous) => previous.filter((_, current) => current !== index))} /> : null}
      </fieldset>)}
      <button type="button" className={secondaryButtonClass} aria-disabled={attendees.length >= maximum} onClick={() => { if (attendees.length < maximum) setAttendees((previous) => [...previous, { firstName: '', lastName: '', email: '' }]); }}>{attendees.length >= maximum ? `Maximum ${maximum} attendees` : 'Add comp attendee'}</button>
      </>}
      <TextAreaField label="Reason for complimentary admission" value={reason} onChange={setReason} required maxLength={500} />
      {error && !confirmation ? <Notice tone="error" message={error} /> : null}
      {notice ? <Notice tone="ok" message={notice} /> : null}
      <button type="submit" className={secondaryButtonClass}>Review complimentary tickets</button>
    </form>
    {confirmation ? <TicketingConfirmation title="Issue complimentary admission?" confirmLabel={`Issue ${confirmation.attendees.length} complimentary tickets`} busyLabel="Issuing complimentary tickets…" busy={busy} error={error} onClose={() => { setConfirmation(null); setError(''); }} onConfirm={issue}>
      <p>{confirmation.attendees.length} × {type?.name}. Charge: {formatTicketMoney(0, catalog.currency)}. These seats count against event and ticket-type capacity.</p>
      <ul>{confirmation.attendees.map((attendee, index) => <li key={index} className="wrap-anywhere">{attendee.firstName} {attendee.lastName} — {attendee.email}</li>)}</ul>
      <p>Each attendee must claim their own admission using a verified email.</p>
      <p>Reason: {confirmation.reason}</p>
    </TicketingConfirmation> : null}
  </Panel>;
}
