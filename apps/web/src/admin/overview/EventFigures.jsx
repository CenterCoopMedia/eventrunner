import { useId } from 'react';
import { Link } from 'react-router';
import { Figure, plural } from './figures.jsx';

function FigureItem({ title, action, to, children }) {
  const titleId = useId();
  return (
    <article className="admin-register-item" aria-labelledby={titleId}>
      <h3 id={titleId}>{title}</h3>
      <div className="admin-register-item__body">{children}</div>
      <Link className="admin-register-action" to={to}>{action}<span aria-hidden="true">→</span></Link>
    </article>
  );
}

function Breakdown({ values, labels }) {
  return (
    <ul className="admin-register-breakdown">
      {labels.map(([key, word]) => (
        <li key={key}><Figure value={values?.[key]} /> <span>{word}</span></li>
      ))}
    </ul>
  );
}

/** A separate operational status, kept out of the four event totals. */
export function SystemHealth({ errors, isOperator }) {
  const titleId = useId();
  const unresolved = errors?.unresolved ?? 0;
  return (
    <article className="admin-overview-health" aria-labelledby={titleId}>
      <h2 id={titleId}>System health</h2>
      <p className="admin-figure-total"><Figure value={unresolved} /> <span>unresolved {plural(unresolved, 'error', 'errors')}</span></p>
      <p className="admin-figure-note">{unresolved > 0 ? 'Unresolved errors need an operator’s review.' : 'No unresolved errors at the last check.'}</p>
      {isOperator ? (
        <Link className="admin-register-action" to="/admin/system-errors">Review system errors<span aria-hidden="true">→</span></Link>
      ) : <p className="admin-figure-note">Only operators can open the error details.</p>}
    </article>
  );
}

/** Server aggregates only. Each column keeps a total, its meaning, and its next action. */
export default function EventFigures({ stats }) {
  const registrations = stats.registrations ?? {};
  const tickets = stats.tickets ?? {};
  const speakers = stats.speakers ?? {};
  const sessions = stats.content?.cmsSchedule ?? {};
  const accounts = registrations.total ?? 0;
  return (
    <section className="admin-overview-register" aria-labelledby="event-figures-title">
      <div className="admin-section-intro">
        <h2 id="event-figures-title">Event figures</h2>
        <p>Attendance, ticketing and program progress from your latest refresh.</p>
      </div>
      <div className="admin-register-grid">
        <FigureItem title="Attendees" to="/admin/attendees" action="Manage attendees">
          <p className="admin-figure-total"><Figure value={accounts} /> <span>{plural(accounts, 'account', 'accounts')}</span></p>
          <Breakdown values={registrations.byStatus} labels={[
            ['pending', 'pending'], ['ticketed', 'ticketed'], ['approved', 'approved'], ['revoked', 'revoked'],
          ]} />
          <p className="admin-figure-note"><Figure value={registrations.profileComplete} /> of <Figure value={accounts} /> {plural(accounts, 'profile', 'profiles')} complete.</p>
        </FigureItem>
        <FigureItem title="Tickets" to="/admin/ticketing" action="Open ticketing">
          <p className="admin-figure-total"><Figure value={tickets.total} /> <span>{plural(tickets.total ?? 0, 'ticket', 'tickets')}</span></p>
          <Breakdown values={tickets.byStatus} labels={[
            ['valid', 'valid'], ['refunded', 'refunded'], ['cancelled', 'cancelled'], ['pending_info', 'waiting for details'],
          ]} />
        </FigureItem>
        <FigureItem title="Speakers" to="/admin/speakers" action="Manage speakers">
          <p className="admin-figure-total"><Figure value={speakers.total} /> <span>{plural(speakers.total ?? 0, 'speaker', 'speakers')}</span></p>
          <Breakdown values={speakers.byStatus} labels={[
            ['draft', 'draft'], ['invited', 'invited'], ['accepted', 'accepted'], ['approved', 'approved'], ['removed', 'removed'],
          ]} />
        </FigureItem>
        <FigureItem title="Program" to="/admin/sessions" action="Manage sessions">
          <p className="admin-figure-total"><Figure value={sessions.published} /> <span>{plural(sessions.published ?? 0, 'session', 'sessions')} on the site</span></p>
          <p className="admin-figure-note"><Figure value={sessions.drafts} /> with unpublished changes.</p>
          <p className="admin-figure-note">Review the running order and session details.</p>
        </FigureItem>
      </div>
    </section>
  );
}
