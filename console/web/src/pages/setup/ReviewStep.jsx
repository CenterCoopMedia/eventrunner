import { Link } from 'react-router';
import { STEPS, SIGNUPS_CLOSED, SITE_DOMAIN, TICKET_CHOICES, setupPath, stepById, stepOfField } from '../../setup/steps.js';
import { senderPreview } from './EmailStep.jsx';
import { eventDayText } from '../../reviewText.js';
import IconControl from '../../IconControl.jsx';

function Row({ label, children }) {
  return (
    <div className="summary-row">
      <dt>{label}</dt>
      <dd>{children || <span className="muted">Not added</span>}</dd>
    </div>
  );
}

function Summary({ answers, connections, ownersNeeded, orgId, appId }) {
  const { organization, event, webAddress, tickets, email } = answers;
  const choice = TICKET_CHOICES.find((c) => c.value === tickets.choice);
  const account = choice?.connect ? connections[choice.value] : null;
  const edit = (id, title) => (
    <IconControl icon="edit" label={`Edit ${title.toLowerCase()}`} to={setupPath(orgId, appId, STEPS.find((s) => s.id === id))} />
  );
  return (
    <>
      <section aria-labelledby="sum-org" className="summary">
        <div className="summary-heading"><h2 id="sum-org">Your organization</h2>{edit('organization', 'Your organization')}</div>
        <dl>
          <Row label="Name">{organization.name}</Row>
          <Row label="Website">{organization.website}</Row>
          <Row label="Mailing address"><span className="pre">{organization.address}</span></Row>
        </dl>
      </section>
      <section aria-labelledby="sum-event" className="summary">
        <div className="summary-heading"><h2 id="sum-event">Your event</h2>{edit('event', 'Your event')}</div>
        <dl>
          <Row label="Event name">{event.name}</Row>
          <Row label="Short name">{event.shortName}</Row>
          <Row label="Description">{event.tagline}</Row>
          <Row label="Time zone">{event.timezone.replaceAll('_', ' ').split('/').reverse().join(', ')}</Row>
          <Row label="Dates">
            {event.days.length > 0 ? <ul className="plain">{event.days.map((d, i) => <li key={i}>{eventDayText(d)}</li>)}</ul> : null}
          </Row>
          <Row label="Venue">{[event.venue.name, event.venue.address].filter(Boolean).join(', ')}</Row>
        </dl>
      </section>
      <section aria-labelledby="sum-web" className="summary">
        <div className="summary-heading"><h2 id="sum-web">Your web address</h2>{edit('webAddress', 'Your web address')}</div>
        <dl><Row label="Address">{webAddress.name ? `${webAddress.name}.${SITE_DOMAIN}` : ''}</Row></dl>
      </section>
      <section aria-labelledby="sum-team" className="summary">
        <div className="summary-heading"><h2 id="sum-team">Your team</h2>{edit('team', 'Your team')}</div>
        <p>{ownersNeeded === 0 ? 'Your team has at least two owners.' : 'A second owner can help manage your team. You can invite one at any time.'}</p>
      </section>
      <section aria-labelledby="sum-tickets" className="summary">
        <div className="summary-heading"><h2 id="sum-tickets">Tickets</h2>{edit('tickets', 'Tickets')}</div>
        <dl>
          <Row label="Ticket sales">{choice?.label}</Row>
          {account ? <Row label="Account">{account.connected ? account.displayName || 'Connected' : 'Not connected yet'}</Row> : null}
          {choice?.value === 'eventbrite' ? <Row label="Eventbrite event">{account.event?.name}</Row> : null}
        </dl>
      </section>
      <section aria-labelledby="sum-email" className="summary">
        <div className="summary-heading"><h2 id="sum-email">Email</h2>{edit('email', 'Email')}</div>
        <dl>
          <Row label="From">{email.senderName ? senderPreview(email.senderName, webAddress.name) : null}</Row>
          <Row label="Replies go to">{email.replyTo}</Row>
        </dl>
      </section>
    </>
  );
}

/** Each open problem, with a link to its step. */
export function Problems({ fields, orgId, appId }) {
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
      <p className="lead">Check your event details, then continue to the hosting agreement.</p>
      <NotSaved steps={notSaved} orgId={orgId} appId={appId} />
      <Problems fields={errors} orgId={orgId} appId={appId} />
      <Summary answers={answers} connections={app.connections} ownersNeeded={ownersNeeded} orgId={orgId} appId={appId} />
      {!app.signups?.open ? <p className="message error">{SIGNUPS_CLOSED}</p> : null}
      {app.signups?.open && !ready && notSaved.length === 0 ? <p className="muted">Finish the answers above first. Then you can continue.</p> : null}
    </div>
  );
}
