import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import SignInPanel from '../components/SignInPanel.jsx';
import TicketDocuments from '../components/TicketDocuments.jsx';
import SectionHead from '../components/editorial/SectionHead.jsx';
import { primaryActionClass, secondaryActionClass } from '../components/controlClasses.js';
import { isReadOnlyDemo } from '../lib/readOnlyDemo.js';
import { useDocumentTitle } from '../lib/useDocumentTitle.js';
import {
  forgetCheckoutAttempt, formatTicketMoney, formatTicketTime, readCheckoutAttempt, rememberCheckoutAttempt,
  safeCheckoutUrl, ticketingRequest, ticketStatusLabel,
} from '../lib/ticketingCommerce.js';

const COMPLETE = new Set(['paid', 'free']);
const TERMINAL = new Set(['failed', 'expired', 'cancelled']);

export default function TicketStatus() {
  useDocumentTitle('Order status');
  const { user, loading: authLoading } = useAuth();
  const { eventConfig } = useEventConfig();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const [loaded, setLoaded] = useState(null);
  const [failure, setFailure] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [resumeError, setResumeError] = useState('');
  const [resuming, setResuming] = useState(false);
  const resumeRef = useRef(false);
  const uidRef = useRef(user?.uid);
  uidRef.current = user?.uid;
  const demo = isReadOnlyDemo(eventConfig);
  const stored = readCheckoutAttempt(user?.uid);
  const orderId = search.get('orderId') || (!search.get('requestId') && stored?.orderId) || null;
  const requestId = orderId ? null : search.get('requestId') || stored?.requestId || null;
  const key = `${user?.uid}:${orderId || requestId}`;
  const order = loaded?.key === key ? loaded.order : null;
  const error = failure?.key === key ? failure.error : null;
  const complete = order && COMPLETE.has(order.status) && order.paymentStatus === 'succeeded';
  const terminal = order && TERMINAL.has(order.status);
  const needsReview = order?.status === 'exception';
  const refunded = order?.status === 'refunded';
  const showTickets = order && ['paid', 'free', 'refunded', 'cancelled', 'exception'].includes(order.status);

  useEffect(() => {
    if (demo || !user?.emailVerified || !(orderId || requestId)) return undefined;
    const controller = new AbortController();
    setBusy(true);
    setFailure(null);
    ticketingRequest('ticketingOrderStatus', {
      user, query: orderId ? { orderId } : { requestId }, signal: controller.signal,
    }).then((result) => {
      if (!controller.signal.aborted) setLoaded({ key, order: result });
    }).catch((err) => {
      if (err?.name !== 'AbortError' && !controller.signal.aborted) setFailure({ key, error: err });
    }).finally(() => {
      if (!controller.signal.aborted) setBusy(false);
    });
    return () => controller.abort();
  }, [user, orderId, requestId, key, refresh, demo]);

  // A bounded refresh helps after the hosted handoff without claiming that the
  // redirect, an elapsed timer, or the browser itself fulfilled the order.
  useEffect(() => {
    if (!order || complete || terminal || needsReview || refunded || error || refresh >= 12) return undefined;
    const timer = setTimeout(() => setRefresh((value) => value + 1), 5000);
    return () => clearTimeout(timer);
  }, [order, complete, terminal, needsReview, refunded, error, refresh]);

  const resume = useCallback(async () => {
    if (resumeRef.current || !user) return;
    const body = order?.orderId ? { orderId: order.orderId, resume: true } : requestId ? { requestId, resume: true } : null;
    if (!body) return;
    resumeRef.current = true;
    setResuming(true);
    setResumeError('');
    const uid = user.uid;
    try {
      const result = await ticketingRequest('ticketingCheckout', { user, body });
      if (uidRef.current !== uid) return;
      rememberCheckoutAttempt(uid, { requestId: body.requestId, orderId: result.orderId });
      if (result.checkoutUrl) {
        const url = safeCheckoutUrl(result.checkoutUrl);
        if (!url) throw new Error('The payment link could not be verified. Contact the organizers.');
        window.location.assign(url);
      } else navigate(`/tickets/status?orderId=${encodeURIComponent(result.orderId)}`, { replace: true });
      setRefresh((value) => value + 1);
    } catch (err) {
      if (uidRef.current === uid) setResumeError(err.message);
    } finally {
      resumeRef.current = false;
      if (uidRef.current === uid) setResuming(false);
    }
  }, [user, requestId, order?.orderId, navigate]);

  const heading = <h1 className="font-heading text-h1 font-semibold">Order status</h1>;
  if (demo) return <article className="space-y-md">{heading}<p>This event demo does not create orders or take payments.</p></article>;
  if (authLoading) return <p role="status">Checking your sign-in…</p>;
  if (!user) return <article className="space-y-md">{heading}<h2 className="font-heading text-h2">Sign in to view your order</h2><p>Use the purchaser’s verified email. Your order number and return link do not give other people access to your order.</p><SignInPanel /></article>;
  if (!user.emailVerified) return <article className="space-y-md">{heading}<p>A verified email is required to view an order. Sign in using Google or an emailed code.</p><Link to="/signin" className={secondaryActionClass}>Open sign-in</Link></article>;
  if (!(orderId || requestId)) return <article className="space-y-md">{heading}<p>Open the order link from your confirmation, or view tickets assigned to your account.</p><Link to="/tickets/mine" className={secondaryActionClass}>View your tickets</Link></article>;

  function startAnother() {
    forgetCheckoutAttempt(user.uid);
    navigate('/tickets');
  }

  const checkoutUrl = safeCheckoutUrl(order?.checkoutUrl);
  const canResume = order?.orderId || requestId;
  return (
    <article className="ticket-print-page min-w-0 space-y-lg text-body text-text-primary">
      {heading}
      {error ? <div className="space-y-sm no-print"><p role="alert" className="text-danger">{error.message}</p><button type="button" className={secondaryActionClass} onClick={() => setRefresh((value) => value + 1)}>Retry order status</button>{error.status === 404 && requestId && stored?.requestId === requestId ? <><p>No order is recorded for this saved request. If another tab is still submitting it, let that request finish before choosing tickets again.</p><button type="button" className={secondaryActionClass} onClick={startAnother}>Return to ticket selection</button></> : null}</div> : null}
      {!order && !error ? <p role="status">Loading your order…</p> : null}
      {order ? <>
        <section className="space-y-sm" aria-labelledby="payment-status-heading">
          <SectionHead title={complete ? 'Your order is confirmed' : needsReview ? 'Your order needs organizer review' : refunded ? 'Your order has been refunded' : terminal ? 'This order is closed' : 'We are confirming your order'} id="payment-status-heading" />
          <p role="status">{complete ? 'Your admission records have been issued. Each attendee can claim their own ticket with their verified email.' : needsReview ? 'The organizers are reviewing a payment or admission exception. Contact them before attempting another payment.' : refunded || terminal ? 'Check each ticket below for its current admission status. A cancelled ticket does not by itself mean money was refunded.' : 'Payment is not yet confirmed. You do not have new admission from this order until confirmation finishes.'}</p>
          <dl className="grid min-w-0 gap-sm sm:grid-cols-2">
            <div><dt className="font-semibold">Order reference</dt><dd className="wrap-anywhere font-data">{order.orderId}</dd></div>
            <div><dt className="font-semibold">Payment</dt><dd>{order.status === 'free' ? 'No payment required' : ticketStatusLabel(order.paymentStatus)}</dd></div>
            <div><dt className="font-semibold">Order total</dt><dd className="font-data tabular-nums">{formatTicketMoney(order.totalAmount, order.currency)}</dd></div>
            <div><dt className="font-semibold">Refund</dt><dd>{ticketStatusLabel(order.refundStatus || 'none')}{order.refundedAmount > 0 ? ` — ${formatTicketMoney(order.refundedAmount, order.currency)}` : ''}</dd></div>
          </dl>
          {order.refundStatus && order.refundStatus !== 'none' ? <p>A refund status describes the payment. Each ticket below shows whether it still grants admission.</p> : null}
          {!complete && !terminal && !needsReview && !refunded ? <div className="space-y-sm no-print">
            {order.paymentStatus === 'failed' ? <p>Your latest payment attempt failed. The existing checkout can still accept a new payment attempt. Use the same checkout to try again.</p> : null}
            <p>Closing Stripe or returning here does not cancel its payment session. If you have already paid, allow confirmation to finish. Do not submit another payment to speed it up.</p>
            {order.expiresAt ? <p>Checkout expires {formatTicketTime(order.expiresAt, eventConfig.timezone)}.</p> : null}
            <div className="flex flex-wrap gap-sm">
              {checkoutUrl ? <a href={checkoutUrl} rel="noreferrer" className={primaryActionClass}>Continue your existing Stripe checkout</a> : canResume ? <button type="button" className={primaryActionClass} aria-busy={resuming} aria-disabled={resuming} onClick={resume}>{resuming ? 'Recovering checkout…' : 'Recover existing checkout'}</button> : null}
              <button type="button" className={secondaryActionClass} aria-busy={busy} aria-disabled={busy} onClick={() => { if (!busy) setRefresh((value) => value + 1); }}>{busy ? 'Checking payment…' : 'Check payment status'}</button>
            </div>
            {resumeError ? <p role="alert" className="text-danger">{resumeError}</p> : null}
          </div> : null}
        </section>
        {order.lines?.length ? <section className="space-y-sm no-print"><h2 className="font-heading text-h2">Order details</h2><ul className="space-y-xs">{order.lines.map((line) => <li key={line.ticketTypeId} className="flex flex-wrap justify-between gap-sm border-b-hairline border-rule-hairline pb-xs"><span>{line.name} × {line.quantity}</span><span className="font-data tabular-nums">{formatTicketMoney(line.lineAmount ?? line.unitAmount * line.quantity, order.currency)}</span></li>)}</ul></section> : null}
        {showTickets && order.tickets?.length ? <TicketDocuments tickets={order.tickets.map((ticket) => ({ ...ticket, orderId: order.orderId }))} eventName={eventConfig.name} timezone={eventConfig.timezone} /> : null}
        <section className="space-y-sm no-print">
          <p>Stripe’s payment receipt and this event’s ticket confirmation serve different purposes. Contact the organizers about ticket assignments, cancellations, or refund policy.</p>
          <Link to="/tickets/mine" className={secondaryActionClass}>View tickets assigned to you</Link>
          {complete || terminal || refunded ? <button type="button" className={secondaryActionClass} onClick={startAnother}>Choose tickets for a new order</button> : <p>Finish this checkout or wait for its confirmed expiry before starting another order. Contact the organizers if it remains unresolved.</p>}
        </section>
      </> : null}
      <p className="no-print"><Link to="/ticket/claim" className="underline">Claim a ticket with your attendee email</Link></p>
    </article>
  );
}
