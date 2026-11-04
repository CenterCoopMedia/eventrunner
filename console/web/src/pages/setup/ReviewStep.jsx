import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { callApi } from '../../api.js';
import { STEPS, SITE_DOMAIN, TICKET_CHOICES, setupPath, stepById, stepOfField } from '../../setup/steps.js';
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
        <p>{ownersNeeded === 0 ? 'The team has the two Owners that launch needs.' : `Add ${ownersNeeded} more ${ownersNeeded === 1 ? 'Owner' : 'Owners'} before you send the request.`}</p>
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
function Problems({ fields, ownersNeeded, orgId, appId, titleRef }) {
  const items = Object.entries(fields)
    .filter(([path]) => path !== 'team')
    .map(([path, message]) => ({ path, message, step: stepOfField(path) }))
    .filter((item) => item.step);
  if (ownersNeeded > 0) items.push({ path: 'team', message: 'Add a second Owner to the team.', step: STEPS[3] });
  if (items.length === 0) return null;
  return (
    <section className="message error problems" aria-labelledby="problems-title">
      <h2 id="problems-title" tabIndex={-1} ref={titleRef}>Answers that need attention</h2>
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
          <Link to={`${setupPath(orgId, appId, step)}?check=1`}>{step.title}</Link> is not saved. Fix it before you send the request.
        </p>
      ))}
    </div>
  );
}

/** Step 7: read the answers and send them with Create my site. */
export default function ReviewStep({ app, answers, errors, ownersNeeded, refusedSteps = [], orgId, appId, flush, onSubmitted }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState(null);
  const titleRef = useRef(null);
  const shown = fields || errors;
  const ready = Object.keys(errors).length === 0 && ownersNeeded === 0;
  const notSaved = refusedSteps.map(stepById).filter(Boolean);
  const held = notSaved.length > 0;

  async function submit() {
    if (held) return;
    setBusy(true);
    setError('');
    if (!(await flush())) {
      setError('We could not save your last change. Try again.');
      setBusy(false);
      return;
    }
    try {
      await callApi('submitApplication', { orgId, appId });
      onSubmitted();
    } catch (err) {
      setError(err.message);
      setFields(err.fields || {});
      setBusy(false);
      setTimeout(() => titleRef.current?.focus(), 0);
    }
  }

  return (
    <div className="stack">
      <p className="lead">Read your answers. When you select Create my site, we review your request. We email you at each step.</p>
      {error ? <p className="message error" role="alert">{error}</p> : null}
      <NotSaved steps={notSaved} orgId={orgId} appId={appId} />
      <Problems fields={shown} ownersNeeded={ownersNeeded} orgId={orgId} appId={appId} titleRef={titleRef} />
      <Summary answers={answers} connections={app.connections} ownersNeeded={ownersNeeded} orgId={orgId} appId={appId} />
      {app.canSubmit ? (
        <div className="section">
          <button type="button" className="button primary" onClick={submit} disabled={busy || held}>Create my site</button>
          {!ready && !held ? <p className="muted">Finish the answers above first. You can select the button to check them again.</p> : null}
        </div>
      ) : (
        <p className="muted">Only an Owner can send the request. Ask an Owner on your team to select Create my site.</p>
      )}
    </div>
  );
}
