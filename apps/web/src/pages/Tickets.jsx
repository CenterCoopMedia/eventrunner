import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { resolveRegistrationAction } from 'shared/registration';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import SignInPanel from '../components/SignInPanel.jsx';
import SectionHead from '../components/editorial/SectionHead.jsx';
import { Checkbox } from '../components/forms/Choice.jsx';
import { TextField, SelectField, focusFirstError } from '../components/forms/publicForm.jsx';
import { primaryActionClass, secondaryActionClass } from '../components/controlClasses.js';
import { useDocumentTitle } from '../lib/useDocumentTitle.js';
import { isReadOnlyDemo } from '../lib/readOnlyDemo.js';
import {
  forgetCheckoutAttempt, formatTicketMoney, formatTicketTime, newTicketingRequestId, readCheckoutAttempt,
  rememberCheckoutAttempt, safeCheckoutUrl, ticketingRequest,
} from '../lib/ticketingCommerce.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Tickets() {
  useDocumentTitle('Get tickets');
  const { user, loading: authLoading, signOut } = useAuth();
  const { eventConfig } = useEventConfig();
  const navigate = useNavigate();
  const demo = isReadOnlyDemo(eventConfig);
  const [catalog, setCatalog] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [loadVersion, setLoadVersion] = useState(0);
  const [quantities, setQuantities] = useState({});
  const [attendees, setAttendees] = useState({});
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [errors, setErrors] = useState({});
  const [requestError, setRequestError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(null);
  const requestRef = useRef(null);
  const formRef = useRef(null);
  const errorRef = useRef(null);
  const submittingRef = useRef(false);
  const activeUid = useRef(user?.uid);
  activeUid.current = user?.uid;

  useEffect(() => {
    if (demo) return undefined;
    const controller = new AbortController();
    setLoadError('');
    ticketingRequest('ticketingCatalog', { signal: controller.signal }).then(setCatalog).catch((err) => {
      if (err?.name !== 'AbortError') setLoadError(err.message);
    });
    return () => controller.abort();
  }, [demo, loadVersion]);

  useEffect(() => {
    setSaved(user?.uid ? { uid: user.uid, attempt: readCheckoutAttempt(user.uid) } : null);
    requestRef.current = null;
    submittingRef.current = false;
    setBusy(false);
    setQuantities({});
    setAttendees({});
    setTermsAccepted(false);
    setErrors({});
    setRequestError('');
  }, [user?.uid]);

  useEffect(() => {
    if (Object.keys(errors).length) {
      if (formRef.current?.querySelector('[aria-invalid="true"]')) focusFirstError(formRef.current);
      else errorRef.current?.focus();
    } else if (requestError) errorRef.current?.focus();
  }, [errors, requestError]);

  const types = catalog?.ticketTypes || [];
  const lines = types.filter((type) => Number(quantities[type.id]) > 0).map((type) => ({
    ticketTypeId: type.id, quantity: Number(quantities[type.id]),
    attendees: Array.from({ length: Number(quantities[type.id]) }, (_, index) => attendees[type.id]?.[index] || {}),
  }));
  const count = lines.reduce((sum, line) => sum + line.quantity, 0);
  const total = lines.reduce((sum, line) => sum + line.quantity * types.find((type) => type.id === line.ticketTypeId).unitAmount, 0);
  const attempt = saved && user && saved.uid === user.uid ? saved.attempt : null;

  function updateAttendee(typeId, index, key, value) {
    setAttendees((previous) => {
      const next = [...(previous[typeId] || [])];
      next[index] = { ...next[index], [key]: value };
      return { ...previous, [typeId]: next };
    });
  }

  async function sendCheckout(body) {
    if (submittingRef.current || !user) return;
    const uid = user.uid;
    const startingNewCheckout = !attempt && body.resume !== true;
    submittingRef.current = true;
    setBusy(true);
    setRequestError('');
    rememberCheckoutAttempt(uid, { requestId: body.requestId, orderId: body.orderId });
    setSaved({ uid, attempt: { requestId: body.requestId, orderId: body.orderId } });
    try {
      const result = await ticketingRequest('ticketingCheckout', { user, body });
      rememberCheckoutAttempt(uid, { requestId: body.requestId, orderId: result.orderId });
      if (activeUid.current !== uid) return;
      setSaved({ uid, attempt: { requestId: body.requestId, orderId: result.orderId } });
      if (result.checkoutUrl) {
        const url = safeCheckoutUrl(result.checkoutUrl);
        if (!url) throw new Error('The payment link could not be verified. View your order status or contact the organizers.');
        window.location.assign(url);
      } else {
        navigate(`/tickets/status?orderId=${encodeURIComponent(result.orderId)}`);
      }
    } catch (err) {
      if (activeUid.current === uid) {
        if (err.code === 'purchase-in-progress' && err.existingOrderId) {
          rememberCheckoutAttempt(uid, { orderId: err.existingOrderId });
          requestRef.current = null;
          setSaved({ uid, attempt: { orderId: err.existingOrderId } });
          navigate(`/tickets/status?orderId=${encodeURIComponent(err.existingOrderId)}`);
          return;
        }
        const missingSavedCheckout = body.resume === true && err.status === 404 && err.code === 'not-found';
        // A missing profile rejects a first submission before reservation. A
        // retry can already hold seats from an earlier uncertain response.
        const profileRejectedBeforeCreation = startingNewCheckout && err.code === 'account-not-ready';
        if (missingSavedCheckout || profileRejectedBeforeCreation || ['invalid-checkout', 'quantity-out-of-range', 'amount-out-of-range', 'amount-too-small', 'sales-closed', 'sold-out', 'ticket-unavailable', 'rate-limited'].includes(err.code)) {
          forgetCheckoutAttempt(uid);
          requestRef.current = null;
          setSaved({ uid, attempt: null });
          setLoadVersion((value) => value + 1);
        }
        setRequestError(missingSavedCheckout
          ? 'The saved checkout is not available to this account. Choose your tickets again.'
          : err.message || 'Checkout could not be opened. Retry the saved request.');
      }
    } finally {
      if (activeUid.current === uid) {
        submittingRef.current = false;
        setBusy(false);
      }
    }
  }

  function submit(event) {
    event.preventDefault();
    if (submittingRef.current) return;
    const nextErrors = {};
    if (!count) nextErrors.cart = 'Choose at least one ticket.';
    if (count > Math.min(catalog.maxPerOrder || 20, 20)) nextErrors.cart = `Choose no more than ${Math.min(catalog.maxPerOrder || 20, 20)} tickets per order.`;
    for (const line of lines) {
      const type = types.find((candidate) => candidate.id === line.ticketTypeId);
      if (!type.available || line.quantity < (type.minPerOrder || 1) || line.quantity > type.maxPerOrder || (Number.isInteger(type.remaining) && line.quantity > type.remaining)) {
        nextErrors[`${type.id}.quantity`] = 'Choose an available quantity for this ticket type.';
      }
      line.attendees.forEach((attendee, index) => {
        if (!attendee.firstName?.trim()) nextErrors[`${type.id}.${index}.firstName`] = 'Enter the attendee’s first name.';
        if (!EMAIL_RE.test(attendee.email?.trim() || '')) nextErrors[`${type.id}.${index}.email`] = 'Enter the attendee’s email address.';
      });
    }
    if (!termsAccepted) nextErrors.terms = 'Read and accept the refund policy before continuing.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    const body = {
      requestId: newTicketingRequestId(),
      lines: lines.map((line) => ({ ...line, attendees: line.attendees.map((attendee) => ({
        firstName: attendee.firstName.trim(), lastName: (attendee.lastName || '').trim(), email: attendee.email.trim(),
      })) })),
    };
    requestRef.current = body;
    sendCheckout(body);
  }

  const heading = <h1 className="font-heading text-h1 font-semibold text-text-primary">Get tickets</h1>;
  if (demo) return (
    <article className="space-y-md">
      {heading}
      <p>This is an event demo. Ticket sales and payments are unavailable.</p>
      <Link to="/schedule" className={secondaryActionClass}>Read the schedule</Link>
    </article>
  );
  if (loadError) return (
    <article className="space-y-md">
      {heading}<p role="alert" className="text-danger">{loadError}</p>
      <button type="button" className={secondaryActionClass} onClick={() => setLoadVersion((value) => value + 1)}>Retry ticket information</button>
    </article>
  );
  if (!catalog) return <article className="space-y-md">{heading}<p role="status">Loading ticket information…</p></article>;
  if (catalog.provider !== 'stripe') {
    const registrationAction = resolveRegistrationAction(eventConfig);
    return (
      <article className="space-y-md">
        {heading}
        <p>{registrationAction ? 'Registration is managed by the event’s registration provider.' : 'Contact the organizers for registration information.'}</p>
        {registrationAction ? <a href={registrationAction.url} className={primaryActionClass}>{registrationAction.label || 'Open registration'}</a> : null}
        <p><Link to="/ticket/claim" className="underline">Claim a ticket you already have</Link></p>
      </article>
    );
  }

  return (
    <article className="min-w-0 space-y-lg text-body text-text-primary">
      <div className="space-y-xs">
        {heading}
        <p className="text-lead">{catalog.eventName || eventConfig.name}</p>
        {catalog.mode === 'test' ? <p className="border-hairline border-rule-hairline bg-surface-alt p-sm">Test mode. These tickets do not represent a live purchase.</p> : null}
      </div>
      {!attempt && requestError ? <p ref={errorRef} tabIndex={-1} role="alert" className="text-danger">{requestError}</p> : null}

      {attempt ? (
        <section className="space-y-sm border-hairline border-rule-hairline bg-surface-alt p-md" aria-labelledby="saved-checkout-heading">
          <h2 id="saved-checkout-heading" className="font-heading text-h2">Continue your existing order</h2>
          <p>A checkout request is already saved for this account. Check or resume that order before starting another purchase. Going back from Stripe does not cancel a payment or release its seats.</p>
          {requestError ? <p ref={errorRef} tabIndex={-1} role="alert" className="text-danger">{requestError}</p> : null}
          <div className="flex flex-wrap gap-sm">
            <button type="button" className={primaryActionClass} aria-busy={busy} aria-disabled={busy} onClick={() => sendCheckout(requestRef.current || (attempt.orderId ? { orderId: attempt.orderId, resume: true } : { requestId: attempt.requestId, resume: true }))}>
              {busy ? 'Opening your order…' : 'Resume existing checkout'}
            </button>
            <Link to={`/tickets/status?${attempt.orderId ? `orderId=${encodeURIComponent(attempt.orderId)}` : `requestId=${encodeURIComponent(attempt.requestId)}`}`} className={secondaryActionClass}>View order status</Link>
          </div>
        </section>
      ) : null}

      {!catalog.salesEnabled ? (
        <section className="space-y-xs">
          <SectionHead title="Ticket sales are closed" />
          <p>{catalog.closedReason || 'The organizers are not accepting new ticket orders right now.'}</p>
          <Link to="/tickets/mine" className={secondaryActionClass}>View your tickets</Link>
        </section>
      ) : authLoading ? <p role="status">Checking your sign-in…</p> : !user ? (
        <section aria-labelledby="ticket-signin-heading" className="space-y-sm">
          <SectionHead title="Sign in to buy tickets" id="ticket-signin-heading" />
          <p>Your verified account keeps your order private. You can assign each ticket to a different attendee after signing in.</p>
          <SignInPanel />
        </section>
      ) : !user.emailVerified ? (
        <section className="space-y-sm">
          <SectionHead title="Verify your email before buying tickets" />
          <p>Sign in with Google or an emailed code for the address that will own this order.</p>
          <button type="button" className={secondaryActionClass} onClick={() => signOut()}>Sign out to verify your email</button>
        </section>
      ) : !attempt ? (
        <form ref={formRef} className="space-y-xl" onSubmit={submit} noValidate>
          <section aria-labelledby="choose-tickets-heading" className="space-y-md">
            <SectionHead title="Choose your tickets" id="choose-tickets-heading" />
            <p>You are buying as <span className="wrap-anywhere font-semibold">{user.email}</span>. All ticket types include full-event admission.</p>
            {types.length === 0 ? <p>No ticket types are currently available.</p> : null}
            {types.map((type) => {
              const maximum = Math.max(0, Math.min(type.maxPerOrder || 20, catalog.maxPerOrder || 20, 20, Number.isInteger(type.remaining) ? type.remaining : 20));
              const salesStartAt = [catalog.salesStartAt, type.salesStartAt].filter(Boolean).sort((left, right) => Date.parse(right) - Date.parse(left))[0];
              const salesEndAt = [catalog.salesEndAt, type.salesEndAt].filter(Boolean).sort((left, right) => Date.parse(left) - Date.parse(right))[0];
              return (
                <fieldset key={type.id} className="min-w-0 space-y-sm border-b-hairline border-rule-hairline pb-md">
                  <legend className="font-heading text-h3 font-semibold">{type.name}</legend>
                  <div className="grid min-w-0 gap-md sm:grid-cols-2">
                    <div className="min-w-0 space-y-xs">
                      <p className="font-data tabular-nums">{formatTicketMoney(type.unitAmount, catalog.currency)} per ticket</p>
                      {type.description ? <p className="wrap-anywhere text-text-secondary">{type.description}</p> : null}
                      {!type.available ? <p>Unavailable</p> : Number.isInteger(type.remaining) ? <p>{type.remaining} seats available</p> : null}
                      {salesStartAt ? <p className="text-caption">Sales open {formatTicketTime(salesStartAt, eventConfig.timezone)}.</p> : null}
                      {salesEndAt ? <p className="text-caption">Sales close {formatTicketTime(salesEndAt, eventConfig.timezone)}.</p> : null}
                    </div>
                    <SelectField label={`Quantity — ${type.name}`} value={quantities[type.id] || '0'} error={errors[`${type.id}.quantity`]}
                      onChange={(value) => setQuantities((previous) => ({ ...previous, [type.id]: value }))}
                      options={[{ value: '0', label: 'No tickets' }, ...(type.available ? Array.from({ length: maximum }, (_, index) => ({ value: String(index + 1), label: String(index + 1) })).filter((option) => Number(option.value) >= (type.minPerOrder || 1)) : [])]} />
                  </div>
                </fieldset>
              );
            })}
            {errors.cart ? <p ref={errorRef} tabIndex={-1} role="alert" className="text-danger">{errors.cart}</p> : null}
          </section>

          {count ? <section aria-labelledby="ticket-attendees-heading" className="space-y-md">
            <SectionHead title="Name each attendee" id="ticket-attendees-heading" />
            <p>Each attendee receives one ticket. They must sign in with their verified email to claim admission. Buying for someone does not give you their event access.</p>
            {lines.flatMap((line) => line.attendees.map((attendee, index) => {
              const type = types.find((candidate) => candidate.id === line.ticketTypeId);
              const key = `${type.id}.${index}`;
              return <fieldset key={key} className="min-w-0 space-y-sm border-hairline border-rule-hairline p-md">
                <legend className="px-xs font-semibold">{type.name} — attendee {index + 1}</legend>
                <div className="grid gap-md sm:grid-cols-2">
                  <TextField label="First name" value={attendee.firstName || ''} autoComplete="given-name" maxLength={100} required error={errors[`${key}.firstName`]} onChange={(value) => updateAttendee(type.id, index, 'firstName', value)} />
                  <TextField label="Last name" hint="Optional for attendees who use one name." value={attendee.lastName || ''} autoComplete="family-name" maxLength={100} error={errors[`${key}.lastName`]} onChange={(value) => updateAttendee(type.id, index, 'lastName', value)} />
                </div>
                <TextField label="Attendee email" type="email" inputMode="email" autoComplete="email" maxLength={254} required value={attendee.email || ''} error={errors[`${key}.email`]} onChange={(value) => updateAttendee(type.id, index, 'email', value)} />
              </fieldset>;
            }))}
          </section> : null}

          <section aria-labelledby="ticket-total-heading" className="space-y-md">
            <SectionHead title="Review your total" id="ticket-total-heading" />
            <dl className="space-y-xs">
              {lines.map((line) => <div key={line.ticketTypeId} className="flex flex-wrap justify-between gap-sm">
                <dt>{types.find((type) => type.id === line.ticketTypeId).name} × {line.quantity}</dt>
                <dd className="font-data tabular-nums">{formatTicketMoney(types.find((type) => type.id === line.ticketTypeId).unitAmount * line.quantity, catalog.currency)}</dd>
              </div>)}
              <div className="flex flex-wrap justify-between gap-sm border-t-hairline border-rule-hairline pt-sm font-semibold">
                <dt>Total for {count} {count === 1 ? 'ticket' : 'tickets'}</dt><dd className="font-data tabular-nums">{formatTicketMoney(total, catalog.currency)}</dd>
              </div>
            </dl>
            <p className="text-caption text-text-secondary">{catalog.taxTreatment === 'inclusive' ? 'Any applicable tax is included in these prices.' : 'The organizer has configured this event not to collect tax.'} The organizer pays processing fees; no additional fees are added to your total.</p>
            <h3 className="font-heading text-h3 font-semibold">Refund policy</h3>
            <p className="whitespace-pre-wrap wrap-anywhere">{catalog.refundPolicy}</p>
            <Checkbox label="I have read and accept the refund policy" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} error={errors.terms} />
            {total > 0 ? <p>Stripe securely collects your payment on the next page. Your tickets are issued only after payment is confirmed. Returning to this site does not confirm a purchase.</p> : <p>No payment is required. The server will confirm available seats before issuing your tickets.</p>}
            <button type="submit" className={primaryActionClass} aria-busy={busy} aria-disabled={busy}>{busy ? 'Preparing your order…' : total > 0 ? `Continue to Stripe — ${formatTicketMoney(total, catalog.currency)}` : 'Reserve tickets'}</button>
          </section>
        </form>
      ) : null}
      <p className="no-print"><Link to="/tickets/mine" className="underline">View tickets assigned to you</Link> · <Link to="/ticket/claim" className="underline">Claim an existing ticket</Link></p>
    </article>
  );
}
