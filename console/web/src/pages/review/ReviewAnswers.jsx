import { TICKET_LABELS, eventDayText } from '../../reviewText.js';

const MISSING = 'Not given';

function Row({ term, children }) {
  const empty = children === undefined || children === null || children === '';
  return (
    <div className="answer">
      <dt>{term}</dt>
      <dd className={empty ? 'muted' : undefined}>{empty ? MISSING : children}</dd>
    </div>
  );
}

function Days({ days }) {
  if (!Array.isArray(days) || days.length === 0) return null;
  return (
    <ul className="plain">
      {days.map((day, i) => (
        <li key={`${day.date}-${i}`}>
          {eventDayText(day)}
        </li>
      ))}
    </ul>
  );
}

/** The frozen answers, in the order of the guided setup, in plain words. */
export default function ReviewAnswers({ answers }) {
  if (!answers) return <p>Event details will appear when the client accepts the agreement.</p>;
  const { organization = {}, event = {}, webAddress = {}, tickets = {}, email = {} } = answers;
  const host = webAddress.name ? `${webAddress.name}.eventrunner.org` : '';
  const sender = email.senderName && host ? `${email.senderName} <hello@${host}>` : 'Not added';
  return (
    <>
      <h3>Organization</h3>
      <dl className="answers">
        <Row term="Name">{organization.name}</Row>
        <Row term="Website">{organization.website}</Row>
        <Row term="Mailing address">{organization.address}</Row>
      </dl>
      <h3>Event</h3>
      <dl className="answers">
        <Row term="Name">{event.name}</Row>
        <Row term="Short name">{event.shortName}</Row>
        <Row term="One-line description">{event.tagline}</Row>
        <Row term="Time zone">{event.timezone?.replaceAll('_', ' ').split('/').reverse().join(', ')}</Row>
        <Row term="Dates"><Days days={event.days} /></Row>
        <Row term="Venue">{event.venue?.name}</Row>
        <Row term="Venue address">{event.venue?.address}</Row>
      </dl>
      <h3>Web address</h3>
      <dl className="answers">
        <Row term="Address">{host}</Row>
      </dl>
      <h3>Tickets</h3>
      <dl className="answers">
        <Row term="Choice">{TICKET_LABELS[tickets.choice]}</Row>
      </dl>
      <h3>Email</h3>
      <dl className="answers">
        <Row term="Sender name">{email.senderName || 'Not added'}</Row>
        <Row term="Replies go to">{email.replyTo}</Row>
        <Row term="Sender preview">{sender}</Row>
      </dl>
    </>
  );
}
