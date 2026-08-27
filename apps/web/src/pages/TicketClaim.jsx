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
//
// Editorial base restyle (design brief §2.1, §2.4): the form and the result
// sit in a hairline-ruled block tinted by --color-surface-alt, the same
// device SignInPanel and the speaker-invite page use — never a shadowed,
// rounded card.
import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { TicketClaimError, verifyTicketOrder } from '../lib/ticketClaim.js';
import { inputClass, primaryActionClass } from '../components/controlClasses.js';

const Panel = ({ children }) => (
  <div className="mt-lg space-y-md border-hairline border-rule-hairline bg-surface-alt p-lg">
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
        <h1 className="font-heading text-h1 font-semibold text-text-primary">Claim your ticket</h1>
        <EmptyState
          title="Sign in to claim your ticket"
          description="Claiming a ticket links it to your account, so it lives behind sign-in."
          action={
            <Link to="/signin" className={primaryActionClass}>
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
        <h1 className="font-heading text-h1 font-semibold text-text-primary">Ticket claimed</h1>
        <Panel>
          <p role="status" className="text-text-primary">
            {result.claimed > 1
              ? `${result.claimed} tickets on that order are now linked to your account.`
              : 'Your ticket is now linked to your account.'}
          </p>
          <Link to="/" className={primaryActionClass}>
            Go to the event site
          </Link>
        </Panel>
      </article>
    );
  }

  return (
    <article className="mx-auto max-w-md">
      <h1 className="font-heading text-h1 font-semibold text-text-primary">Claim your ticket</h1>
      <p className="mt-xs max-w-prose text-body text-text-secondary" style={{ textWrap: 'pretty' }}>
        You are signed in{user.email ? ` as ${user.email}` : ''}. Enter the order number from
        your confirmation email to link your ticket to this account.
      </p>
      <Panel>
        <form onSubmit={submit} noValidate>
          <label htmlFor="order-number" className="block font-semibold text-text-primary">
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
            className={`mt-2xs ${inputClass}`}
          />
          {error ? (
            <p
              id="order-number-error"
              ref={errorRef}
              tabIndex={-1}
              role="alert"
              className="mt-xs flex items-start gap-xs border-hairline border-danger/40 bg-danger/10 px-sm py-xs font-data text-caption text-danger"
            >
              <span aria-hidden="true" className="font-semibold">
                !
              </span>
              <span>{error.message}</span>
            </p>
          ) : null}
          <button type="submit" disabled={submitting} className={`${primaryActionClass} mt-md`}>
            {submitting ? 'Checking…' : 'Claim ticket'}
          </button>
        </form>
      </Panel>
    </article>
  );
}
