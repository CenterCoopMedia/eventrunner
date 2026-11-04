import { Link } from 'react-router';
import { STEPS, SIGNUPS_CLOSED, SITE_DOMAIN, TICKET_CHOICES, setupPath, stepById, stepOfField } from '../../setup/steps.js';
import { senderPreview } from './EmailStep.jsx';

function Row({ label, children }) {
  return (
    <div className="summary-row">
      <dt>{label}</dt>
      <dd>{children || <span className="muted">Not answered</span>}</dd>
    </div>
  );
}

function dayText(day) {
  return [day.label, day.date, day.startTime && day.endTime ? `${day.startTime} to ${day.endTime}` : '']
    .filter(Boolean).join(', ');
}

function Summary({ answers, connections, ownersNeeded, orgId, appId }) {
  const { organization, event, webAddress, tickets, email } = answers;
  const choice = TICKET_CHOICES.find((c) => c.value === tickets.choice);
  const account = choice?.connect ? connections[choice.value] : null;
  const edit = (id, title) => (
    <Link to={`${setupPath(orgId, appId, STEPS.find((s) => s.id === id))}`}>Change {title.toLowerCase()}</Link>
  );
  return (
    <>
      <section aria-labelledby="sum-org" className="summary">
        <h2 id="sum-org">Your organization</h2>
        <dl>
          <Row label="Name">{organization.name}</Row>
          <Row label="Website">{organization.website}</Row>
          <Row label="Mailing address"><span className="pre">{organization.address}</span></Row>
        </dl>
        {edit('organization', 'Your organization')}
      </section>
      <section aria-labelledby="sum-event" className="summary">
        <h2 id="sum-event">Your event</h2>
        <dl>
          <Row label="Event name">{event.name}</Row>
          <Row label="Short name">{event.shortName}</Row>
          <Row label="Description">{event.tagline}</Row>
          <Row label="Time zone">{event.timezone}</Row>
          <Row label="Dates">
            {event.days.length > 0 ? <ul className="plain">{event.days.map((d, i) => <li key={i}>{dayText(d)}</li>)}</ul> : null}
          </Row>
          <Row label="Venue">{[event.venue.name, event.venue.address].filter(Boolean).join(', ')}</Row>
        </dl>
        {edit('event', 'Your event')}
      </section>
      <section aria-labelledby="sum-web" className="summary">
        <h2 id="sum-web">Your web address</h2>
        <dl><Row label="Address">{webAddress.name ? `${webAddress.name}.${SITE_DOMAIN}` : ''}</Row></dl>
        {edit('webAddress', 'Your web address')}
      </section>
      <section aria-labelledby="sum-team" className="summary">
        <h2 id="sum-team">Your team</h2>
        <p>{ownersNeeded === 0 ? 'The team has the two Owners that launch needs.' : 'You can finish the setup now. Launch needs two Owners, and you can add the second one later.'}</p>
        {edit('team', 'Your team')}
      </section>
      <section aria-labelledby="sum-tickets" className="summary">
        <h2 id="sum-tickets">Tickets</h2>
        <dl>
          <Row label="Ticket sales">{choice?.label}</Row>
          {account ? <Row label="Account">{account.connected ? `Connected: ${account.displayName || 'yes'}` : 'Not connected yet'}</Row> : null}
          {choice?.value === 'eventbrite' ? <Row label="Eventbrite event">{account.event?.name}</Row> : null}
        </dl>
        {edit('tickets', 'Tickets')}
      </section>
      <section aria-labelledby="sum-email" className="summary">
        <h2 id="sum-email">Email</h2>
        <dl>
          <Row label="From">{senderPreview(email.senderName, webAddress.name)}</Row>
          <Row label="Replies go to">{email.replyTo}</Row>
        </dl>
        {edit('email', 'Email')}
      </section>
    </>
  );
}

/** Each open problem, with a link to its step. */
function Problems({ fields, orgId, appId }) {
  const items = Object.entries(fields)
    .filter(([path]) => path !== 'team')
    .map(([path, message]) => ({ path, message, step: stepOfField(path) }))
    .filter((item) => item.step);
  if (items.length === 0) return null;
  return (
    <section className="message error problems" aria-labelledby="problems-title">
      <h2 id="problems-title">Answers that need attention</h2>
      <ul>
        {items.map((item) => (
          <li key={item.path}>
            <Link to={`${setupPath(orgId, appId, item.step)}?check=1`}>{item.step.title}</Link>: {item.message}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The steps whose last change the server did not save. Each one holds the request. */
function NotSaved({ steps, orgId, appId }) {
  if (steps.length === 0) return null;
  return (
    <div className="message error">
      {steps.map((step) => (
        <p key={step.id}>
          <Link to={`${setupPath(orgId, appId, step)}?check=1`}>{step.title}</Link> is not saved. Fix it before you continue.
        </p>
      ))}
    </div>
  );
}

/** Step 7: read the answers. Next opens the agreement once they pass and the site is taking sign-ups. */
export default function ReviewStep({ app, answers, errors, ownersNeeded, refusedSteps = [], orgId, appId }) {
  const ready = Object.keys(errors).length === 0;
  const notSaved = refusedSteps.map(stepById).filter(Boolean);
  return (
    <div className="stack">
      <p className="lead">Read your answers. Next you read and accept the agreement, and we start building your site. We email you at each step.</p>
      <NotSaved steps={notSaved} orgId={orgId} appId={appId} />
      <Problems fields={errors} orgId={orgId} appId={appId} />
      <Summary answers={answers} connections={app.connections} ownersNeeded={ownersNeeded} orgId={orgId} appId={appId} />
      {!app.signups?.open ? <p className="message error">{SIGNUPS_CLOSED}</p> : null}
      {app.signups?.open && !ready && notSaved.length === 0 ? <p className="muted">Finish the answers above first. Then you can continue.</p> : null}
    </div>
  );
}
