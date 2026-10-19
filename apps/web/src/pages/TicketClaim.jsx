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
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useProfile } from '../contexts/ProfileContext.jsx';
import SignInPanel from '../components/SignInPanel.jsx';
import { TicketClaimError, verifyTicketOrder } from '../lib/ticketClaim.js';
import { inputClass, primaryActionClass } from '../components/controlClasses.js';

const Panel = ({ children }) => (
  <div className="mt-lg space-y-md border-hairline border-rule-hairline bg-surface-alt p-lg">
    {children}
  </div>
);

// Keep listening through the existing ProfileContext retry path. A bounded
// wait also gives the attendee a recovery action without losing the reference.
function PreparingAccount({ retryPath }) {
  const [takingLonger, setTakingLonger] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setTakingLonger(true), 15_000);
    return () => clearTimeout(timer);
  }, []);
  return (
    <Panel>
      <p role={takingLonger ? 'alert' : 'status'} className="text-text-primary">
        {takingLonger
          ? 'Your account is taking longer to load. Check your connection and reload this page, or contact the organizers if this continues.'
          : 'Setting up your account. The claim form will appear when your account is ready.'}
      </p>
      {takingLonger ? <a href={retryPath} className={primaryActionClass}>Reload claim page</a> : null}
    </Panel>
  );
}

export default function TicketClaim() {
  const { user, loading: authLoading } = useAuth();
  const { profile, status } = useProfile();
  const [searchParams] = useSearchParams();

  // Authentication stays on this page, preserving both the emailed reference
  // and any edit. Only the explicit verified-account submit below claims it.
  const [orderNumber, setOrderNumber] = useState(() => (searchParams.get('order') || '').slice(0, 160));
  const [reauthenticate, setReauthenticate] = useState(null);
  const identity = user ? `${user.uid}:${user.email || ''}` : null;
  if (authLoading) return null;

  const needsSignIn = !user || !user.emailVerified || reauthenticate === identity;
  if (needsSignIn) {
    return (
      <article className="mx-auto max-w-md">
        <h1 className="font-heading text-h1 font-semibold text-text-primary">Claim your ticket</h1>
        <p className="my-md text-text-secondary" role={reauthenticate === identity && user ? 'alert' : undefined}>
          {!user
            ? 'Sign in to claim your ticket'
            : reauthenticate === identity
              ? 'Your sign-in could not be verified. Sign in again before claiming your ticket.'
              : 'Verify your email before claiming your ticket. Sign in with Google or an emailed code below.'}
        </p>
        <SignInPanel key={identity || 'signed-out'} initialEmail={user?.email || ''} onSignedIn={() => setReauthenticate(null)} />
      </article>
    );
  }

  // A fresh sign-in can precede the auth trigger that creates users/{uid}.
  // Also reject a prior account's profile during the subscription transition.
  if (status !== 'ready' || profile?.id !== user.uid) {
    const retryParams = new URLSearchParams(searchParams);
    if (orderNumber || retryParams.has('order')) retryParams.set('order', orderNumber);
    return (
      <article className="mx-auto max-w-md">
        <h1 className="font-heading text-h1 font-semibold text-text-primary">Claim your ticket</h1>
        <PreparingAccount key={identity} retryPath={`/ticket/claim?${retryParams.toString()}`} />
      </article>
    );
  }

  // Mount submission state per verified account. Signing out, switching
  // accounts or losing the account document discards any old result.
  return <ClaimForm key={identity} user={user} orderNumber={orderNumber} setOrderNumber={setOrderNumber} onRequireSignIn={() => setReauthenticate(identity)} />;
}

function ClaimForm({ user, orderNumber, setOrderNumber, onRequireSignIn }) {
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null); // the server's success payload
  const [error, setError] = useState(null); // { message } — one shape, every cause
  const inputRef = useRef(null);
  const errorRef = useRef(null);
  const active = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const submit = useCallback(
    async (event) => {
      event.preventDefault();
      if (inFlight.current || !active.current) return;
      const trimmed = orderNumber.trim();
      if (!trimmed) {
        setError({ message: 'Enter the order number from your confirmation email.' });
        return;
      }
      setError(null);
      inFlight.current = true;
      setSubmitting(true);
      try {
        const idToken = await user.getIdToken();
        if (!active.current) return;
        const claimed = await verifyTicketOrder({ orderNumber: trimmed, idToken });
        if (active.current) setResult(claimed);
      } catch (err) {
        if (!active.current) return;
        if ((err instanceof TicketClaimError && [401, 403].includes(err.status)) || (typeof err?.code === 'string' && err.code.startsWith('auth/'))) {
          onRequireSignIn();
          return;
        }
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
      } finally {
        inFlight.current = false;
        if (active.current) setSubmitting(false);
      }
    },
    [orderNumber, user, onRequireSignIn],
  );

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
          <Link to="/tickets/mine" className={primaryActionClass}>
            View and print your tickets
          </Link>
        </Panel>
      </article>
    );
  }

  return (
    <article className="mx-auto max-w-md">
      <h1 className="font-heading text-h1 font-semibold text-text-primary">Claim your ticket</h1>
      <p className="mt-xs max-w-prose text-body text-text-secondary text-pretty">
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
