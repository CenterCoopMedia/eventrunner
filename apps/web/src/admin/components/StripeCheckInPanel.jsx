import { useRef, useState } from 'react';
import { formatTicketTime } from '../../lib/ticketingCommerce.js';
import { Notice, Panel, primaryButtonClass, secondaryButtonClass, TextAreaField, TextField } from './formControls.jsx';
import TicketingConfirmation from './TicketingConfirmation.jsx';

const RESULT_MESSAGES = {
  checked_in: 'Checked in. Admit this attendee.',
  already_checked_in: 'Already checked in. This scan did not create another check-in.',
  invalid: 'Do not admit. This ticket is invalid, cancelled, refunded, or unavailable.',
  corrected: 'Check-in corrected. The ticket can be checked in again if it remains valid.',
};

export default function StripeCheckInPanel({ call, isOperator, timezone, onChanged }) {
  const [ticketId, setTicketId] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [correction, setCorrection] = useState(null);
  const [reason, setReason] = useState('');
  const busyRef = useRef(false);
  const formRef = useRef(null);
  async function check(action = 'checkIn') {
    if (busyRef.current) return;
    if (!ticketId.trim() || (action === 'undo' && !reason.trim())) { setError(action === 'undo' ? 'Enter a reason for the check-in correction.' : 'Enter or scan the ticket code.'); return; }
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await call('ticketingCheckIn', { ticketId: action === 'undo' ? correction.externalId || correction.id : ticketId.trim(), action, ...(action === 'undo' ? { reason: reason.trim(), confirmed: true } : {}) });
      setResult(response);
      setCorrection(null);
      setReason('');
      onChanged();
      if (action === 'checkIn') formRef.current?.querySelector('input')?.select();
    } catch (err) { setError(err.message); }
    finally { busyRef.current = false; setBusy(false); }
  }
  return <Panel title="Online check-in" description="Scan or type the opaque ticket code. The server checks current admission and prevents duplicate check-ins.">
    <form ref={formRef} className="space-y-sm" onSubmit={(event) => { event.preventDefault(); check(); }}>
      <TextField label="Ticket code for check-in" value={ticketId} autoComplete="off" autoCapitalize="none" spellCheck={false} error={error && !correction && !ticketId.trim() ? error : undefined} onChange={(value) => { setTicketId(value); setResult(null); }} />
      <button type="submit" className={primaryButtonClass} aria-busy={busy} aria-disabled={busy}>{busy ? 'Checking ticket…' : 'Check in attendee'}</button>
    </form>
    {error && !correction ? <div className="mt-sm"><Notice tone="error" message={error} /></div> : null}
    {result ? <div className="mt-md space-y-sm">
      <Notice tone={result.result === 'invalid' ? 'error' : result.result === 'already_checked_in' ? 'caution' : 'ok'} message={RESULT_MESSAGES[result.result] || 'Check the ticket status before admitting this attendee.'} />
      {result.ticket ? <div className="space-y-xs">
        <p className="wrap-anywhere text-admin-base font-bold">{result.ticket.firstName} {result.ticket.lastName} · {result.ticket.ticketClass}</p>
        <p className="wrap-anywhere font-admin-data text-admin-sm">{result.ticket.externalId || result.ticket.id}</p>
        {result.ticket.checkedInAt ? <p className="font-admin-data text-admin-sm">Checked in {formatTicketTime(result.ticket.checkedInAt, timezone)}.</p> : null}
        {isOperator && result.ticket.checkedInAt ? <button type="button" className={secondaryButtonClass} onClick={() => { setCorrection({ ...result.ticket }); setReason(''); setError(''); }}>Review check-in correction</button> : null}
      </div> : null}
    </div> : null}
    {correction ? <TicketingConfirmation title="Undo this check-in?" confirmLabel="Undo recorded check-in" destructive busy={busy} error={error} onClose={() => setCorrection(null)} onConfirm={() => check('undo')}>
      <p>{correction.firstName} {correction.lastName} — {correction.ticketClass}.</p>
      <p className="wrap-anywhere font-admin-data text-admin-sm">Ticket: {correction.externalId || correction.id}</p>
      <p>This removes the check-in recorded at {formatTicketTime(correction.checkedInAt, timezone)}. A valid ticket can then be admitted again. It does not refund or change ticket ownership.</p>
      <TextAreaField label="Reason for check-in correction" value={reason} onChange={setReason} required maxLength={500} />
    </TicketingConfirmation> : null}
  </Panel>;
}
