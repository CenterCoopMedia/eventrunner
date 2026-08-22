// Self-service ticket claim (issue #33, spec §3.3, §3.5).
//
// The page every `ticket.claim_prompt` CTA links to (manual.cjs,
// eventbrite.cjs `getRegistrationPrompt`): a signed-in attendee types the
// order number from their confirmation email, the server matches it against
// their account's VERIFIED address and claims every ticket on that order
// for this account (ticketingVerifyOrder → claimTicketsForUser,
// functions/src/ticketing/registration.cjs).
//
// The no-oracle rule carries through to this page on purpose. The server
// answers the SAME 404 for "no such order", "that order belongs to another
// event", "the order's address does not match this account", and "somebody
// already claimed it" — so this page renders exactly ONE failure state for
// all of them, "No ticket matches that order number," rather than trying to
// distinguish causes the server deliberately does not distinguish. Telling
// a stranger typing order numbers WHICH of those was true is exactly the
// oracle the single response code exists to close off.
import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { TicketClaimError, verifyTicketOrder } from '../lib/ticketClaim.js';

const primaryButtonClass =
  'touch-target inline-flex items-center justify-center rounded-brand ' +
  'bg-brand-primary px-4 py-2 font-semibold text-brand-surface ' +
  'hover:bg-brand-primary-dark disabled:opacity-60';

const inputClass =
  'touch-target w-full rounded-brand border border-brand-ink/20 bg-brand-surface px-3 py-2 ' +
  'text-brand-ink placeholder:text-brand-ink-muted aria-[invalid=true]:border-danger';

const Panel = ({ children }) => (
  <div className="mt-6 space-y-4 rounded-brand-lg border border-brand-ink/10 bg-brand-surface p-6">
    {children}
  </div>
);

export default function TicketClaim() {
  const { user, loading: authLoading } = useAuth();

  const [orderNumber, setOrderNumber] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null); // the server's success payload
  const [error, setError] = useState(null); // { message } — one shape, every cause
  const inputRef = useRef(null);
  const errorRef = useRef(null);

  const submit = useCallback(
    async (event) => {
      event.preventDefault();
      const trimmed = orderNumber.trim();
      if (!trimmed) {
        setError({ message: 'Enter the order number from your confirmation email.' });
        errorRef.current?.focus();
        return;
      }
      setError(null);
      setSubmitting(true);
      try {
        const idToken = await user.getIdToken();
        const claimed = await verifyTicketOrder({ orderNumber: trimmed, idToken });
        setResult(claimed);
      } catch (err) {
        // Every server-side refusal (unknown order, wrong event, address
        // mismatch, already claimed) reaches here as the identical 404 —
        // see the module doc. A network failure gets its own honest
        // message instead of being folded into "no ticket matches",
        // because that IS distinguishable and recoverable by trying again.
        setError({
          message:
            err instanceof TicketClaimError && err.code === 'network'
              ? 'We could not reach the server. Check your connection and try again.'
              : 'No ticket matches that order number. Check it against your confirmation email, or contact the organizers.',
        });
        errorRef.current?.focus();
      } finally {
        setSubmitting(false);
      }
    },
    [orderNumber, user],
  );

  if (authLoading) return null;

  if (!user) {
    return (
      <article className="mx-auto max-w-md">
        <h1 className="text-3xl font-semibold text-brand-ink">Claim your ticket</h1>
        <EmptyState
          title="Sign in to claim your ticket"
          description="Claiming a ticket links it to your account, so it lives behind sign-in."
          action={
            <Link
              to="/signin"
              className="touch-target inline-flex items-center rounded-brand bg-brand-primary px-4 py-2 font-semibold text-brand-surface"
            >
              Sign in
            </Link>
          }
        />
      </article>
    );
  }

  if (result) {
    return (
      <article className="mx-auto max-w-md">
        <h1 className="text-3xl font-semibold text-brand-ink">Ticket claimed</h1>
        <Panel>
          <p role="status" className="text-brand-ink">
            {result.claimed > 1
              ? `${result.claimed} tickets on that order are now linked to your account.`
              : 'Your ticket is now linked to your account.'}
          </p>
          <Link to="/" className={primaryButtonClass}>
            Go to the event site
          </Link>
        </Panel>
      </article>
    );
  }

  return (
    <article className="mx-auto max-w-md">
      <h1 className="text-3xl font-semibold text-brand-ink">Claim your ticket</h1>
      <p className="mt-2 text-brand-ink-muted" style={{ textWrap: 'pretty' }}>
        You are signed in{user.email ? ` as ${user.email}` : ''}. Enter the order number from
        your confirmation email to link your ticket to this account.
      </p>
      <Panel>
        <form onSubmit={submit} noValidate>
          <label htmlFor="order-number" className="block font-medium text-brand-ink">
            Order number
          </label>
          <input
            ref={inputRef}
            id="order-number"
            name="orderNumber"
            type="text"
            autoComplete="off"
            value={orderNumber}
            onChange={(event) => setOrderNumber(event.target.value)}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? 'order-number-error' : undefined}
            className={`${inputClass} mt-1`}
          />
          {error ? (
            <p
              id="order-number-error"
              ref={errorRef}
              tabIndex={-1}
              role="alert"
              className="mt-2 flex items-start gap-2 rounded-brand border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
            >
              <span aria-hidden="true" className="font-semibold">
                !
              </span>
              <span>{error.message}</span>
            </p>
          ) : null}
          <button type="submit" disabled={submitting} className={`${primaryButtonClass} mt-4`}>
            {submitting ? 'Checking…' : 'Claim ticket'}
          </button>
        </form>
      </Panel>
    </article>
  );
}
