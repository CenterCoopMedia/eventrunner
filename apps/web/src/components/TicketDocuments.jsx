import { Link } from 'react-router';
import { secondaryActionClass } from './controlClasses.js';
import { formatTicketTime, ticketStatusLabel } from '../lib/ticketingCommerce.js';

/** The printed credential is an opaque admission ID. It contains no embedded personal data. */
export default function TicketDocuments({ tickets, eventName, timezone }) {
  return (
    <section className="space-y-md" aria-labelledby="admission-tickets-heading">
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <h2 id="admission-tickets-heading" className="font-heading text-h2 font-semibold">Admission tickets</h2>
        <button type="button" className={`${secondaryActionClass} no-print`} onClick={() => window.print()}>Print tickets</button>
      </div>
      <p className="no-print">Bring the ticket code below or a printed copy to check-in. Staff can look up the code if you cannot scan or open a ticket.</p>
      {tickets.map((ticket) => {
        const id = ticket.externalId || ticket.id;
        return (
          <article key={id} className="ticket-document min-w-0 space-y-sm border-hairline border-rule-hairline bg-surface p-md">
            <h3 className="wrap-anywhere font-heading text-h3 font-semibold">{eventName}</h3>
            <p className="font-semibold">{ticket.ticketClass || 'Event admission'} · {ticketStatusLabel(ticket.status)}</p>
            <dl className="grid min-w-0 gap-sm sm:grid-cols-2">
              <div><dt className="font-semibold">Attendee</dt><dd className="wrap-anywhere">{[ticket.firstName, ticket.lastName].filter(Boolean).join(' ') || 'Not provided'}</dd></div>
              <div><dt className="font-semibold">Ticket code</dt><dd className="wrap-anywhere font-data text-body">{id}</dd></div>
            </dl>
            {ticket.status !== 'valid' ? <p className="font-semibold">This ticket does not currently grant admission.</p> : null}
            {ticket.checkedInAt ? <p>Checked in {formatTicketTime(ticket.checkedInAt, timezone)}.</p> : null}
            <div className="no-print space-y-xs">
              {ticket.claimedByMe ? <p>Claimed by your account.</p> : <p>The attendee must use their verified email to claim this ticket. A ticket code or order number alone does not grant account access.</p>}
              {!ticket.claimedByMe && ticket.status === 'valid' && ticket.orderId ? <Link to={`/ticket/claim?order=${encodeURIComponent(ticket.orderId)}`} className="underline">Claim this ticket with the attendee’s account</Link> : null}
            </div>
          </article>
        );
      })}
    </section>
  );
}
