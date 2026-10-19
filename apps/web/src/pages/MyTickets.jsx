import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import SignInPanel from '../components/SignInPanel.jsx';
import TicketDocuments from '../components/TicketDocuments.jsx';
import { secondaryActionClass } from '../components/controlClasses.js';
import { isReadOnlyDemo } from '../lib/readOnlyDemo.js';
import { useDocumentTitle } from '../lib/useDocumentTitle.js';
import { ticketingRequest } from '../lib/ticketingCommerce.js';

export default function MyTickets() {
  useDocumentTitle('Your tickets');
  const { user, loading } = useAuth();
  const { eventConfig } = useEventConfig();
  const demo = isReadOnlyDemo(eventConfig);
  const [loaded, setLoaded] = useState(null);
  const [failure, setFailure] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const requestController = useRef(null);
  const tickets = loaded && user && loaded.uid === user.uid ? loaded.tickets : null;
  const error = failure && user && failure.uid === user.uid ? failure.message : null;
  useEffect(() => {
    if (demo || !user?.emailVerified) return undefined;
    const controller = new AbortController();
    requestController.current = controller;
    busyRef.current = true;
    setBusy(true);
    setFailure(null);
    ticketingRequest('ticketingMyTickets', { user, body: {}, signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) setLoaded({ uid: user.uid, tickets: result.tickets, nextCursor: result.nextCursor });
    }).catch((err) => {
      if (!controller.signal.aborted) setFailure({ uid: user.uid, message: err.message });
    }).finally(() => { if (!controller.signal.aborted) { busyRef.current = false; setBusy(false); } });
    return () => requestController.current?.abort();
  }, [user, demo, refresh]);

  async function loadMore() {
    if (busyRef.current || !user?.emailVerified || loaded?.uid !== user.uid || !loaded.nextCursor) return;
    const controller = new AbortController();
    requestController.current = controller;
    busyRef.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const result = await ticketingRequest('ticketingMyTickets', { user, body: { cursor: loaded.nextCursor }, signal: controller.signal });
      if (!controller.signal.aborted) setLoaded((previous) => ({
        uid: user.uid, tickets: [...previous.tickets, ...result.tickets], nextCursor: result.nextCursor,
      }));
    } catch (err) {
      if (!controller.signal.aborted) setFailure({ uid: user.uid, message: err.message });
    } finally {
      if (!controller.signal.aborted) { busyRef.current = false; setBusy(false); }
    }
  }

  const heading = <h1 className="font-heading text-h1 font-semibold">Your tickets</h1>;
  if (demo) return <article className="space-y-md">{heading}<p>This event demo does not issue tickets.</p></article>;
  if (loading) return <p role="status">Checking your sign-in…</p>;
  if (!user) return <article className="space-y-md">{heading}<p>Sign in with the verified email assigned to your ticket.</p><SignInPanel /></article>;
  if (!user.emailVerified) return <article className="space-y-md">{heading}<p>Sign in with Google or an emailed code to verify your ticket email.</p><Link to="/signin" className={secondaryActionClass}>Open sign-in</Link></article>;
  return <article className="ticket-print-page min-w-0 space-y-lg text-body text-text-primary">
    {heading}
    <div className="space-y-sm no-print"><p>These tickets have been claimed by your verified account. Claim an assigned ticket with its order reference to add it here. Purchaser payment details remain private.</p><button type="button" className={secondaryActionClass} aria-busy={busy} aria-disabled={busy} onClick={() => { if (!busy) setRefresh((value) => value + 1); }}>{busy ? 'Refreshing tickets…' : 'Refresh tickets'}</button></div>
    {error ? <p role="alert" className="text-danger">{error}</p> : null}
    {!tickets && !error ? <p role="status">Loading your tickets…</p> : null}
    {tickets?.length ? <TicketDocuments tickets={tickets} eventName={eventConfig.name} timezone={eventConfig.timezone} /> : tickets ? <section className="space-y-sm"><h2 className="font-heading text-h2">No tickets found for this account</h2><p>Use the email assigned by the purchaser. If you have an order reference, you can check it through the ticket claim form.</p><Link to="/ticket/claim" className={secondaryActionClass}>Claim an existing ticket</Link></section> : null}
    {loaded && user && loaded.uid === user.uid && loaded.nextCursor ? <button type="button" className={`${secondaryActionClass} no-print`} aria-busy={busy} aria-disabled={busy} onClick={loadMore}>{busy ? 'Loading tickets…' : 'Load more tickets'}</button> : null}
  </article>;
}
