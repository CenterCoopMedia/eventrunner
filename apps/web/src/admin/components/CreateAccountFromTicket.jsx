import { useRef, useState } from 'react';
import { plannerMessage } from '../plannerErrors.js';
import { linkButtonClass } from './formControls.jsx';
import TicketingConfirmation from './TicketingConfirmation.jsx';

// "Create account" on one ticket row (audit 01 #5). It calls
// createUserFromTicket (functions/src/ticketing/registration.cjs), which
// makes the sign-in account for the ticket email, or uses the account that
// already has it, and claims the ticket for that account.

/** The handler acts only on an unclaimed, valid ticket that has an email. */
export function canCreateAccountFromTicket(ticket) {
  return !ticket?.claimedByUid && ticket?.status === 'valid' &&
    typeof ticket.email === 'string' && ticket.email.trim() !== '';
}

/** The result line for a 200 answer. */
export function createAccountResultMessage(email, result) {
  if (result?.alreadyClaimed) return 'This ticket was already claimed. Nothing changed.';
  if (result?.created) return `Account created for ${email}. The ticket is claimed.`;
  return `${email} already had an account. The ticket is now claimed for it.`;
}

/** Words the staff member can act on, for each refusal the handler gives. */
function refusalMessage(err) {
  if (err?.code === 'not-found') return 'This ticket is no longer in the list. Search again.';
  if (err?.code === 'conflict') return 'This ticket could not be claimed. Its status may have changed. Search again to see the current status.';
  if (err?.code === 'unprocessable') return 'This ticket has no email address. Add the address to the ticket, then try again.';
  // 503 config-unavailable and 403 read-only-demo carry their own words.
  if (err?.status >= 500 && err?.code !== 'config-unavailable') {
    return 'The account could not be created. Try again. If the problem continues, contact support.';
  }
  return plannerMessage(err?.message ?? 'The account could not be created. Try again.');
}

export default function CreateAccountFromTicket({ call, ticket, ticketId, onDone }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const busyRef = useRef(false);
  const email = ticket.email.trim().toLowerCase();

  async function create() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await call('createUserFromTicket', { externalId: ticketId });
      setOpen(false);
      onDone({ ticketId, uid: result.uid, message: createAccountResultMessage(email, result) });
    } catch (err) {
      setError(refusalMessage(err));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className={linkButtonClass} aria-label={`Create account for ${email}`}
        onClick={() => { setError(''); setOpen(true); }}>
        Create account
      </button>
      {open ? (
        <TicketingConfirmation
          title="Create an account from this ticket?"
          confirmLabel="Create account and claim ticket"
          busyLabel="Creating…"
          busy={busy}
          error={error}
          onClose={() => { setOpen(false); setError(''); }}
          onConfirm={create}
        >
          <p>
            Event Runner creates a sign-in account for <span className="font-admin-data">{email}</span> and claims this ticket for it.
            If an account with this address already exists, Event Runner claims the ticket for that account.
          </p>
          <p>The person then signs in with a code sent to this address.</p>
        </TicketingConfirmation>
      ) : null}
    </>
  );
}
