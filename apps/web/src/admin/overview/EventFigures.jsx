import { useId } from 'react';
import { Link } from 'react-router-dom';
import { Figure, plural } from './figures.jsx';

function FigureCard({ title, action, to, className = '', children }) {
  const titleId = useId();
  return (
    <article className={`admin-figure-card ${className}`} aria-labelledby={titleId}>
      <h3 id={titleId}>{title}</h3>
      <div className="admin-figure-card__body">{children}</div>
      {to ? <Link className="admin-card-action" to={to}>{action}<span aria-hidden="true">→</span></Link> : null}
    </article>
  );
}

function Breakdown({ values, labels }) {
  return (
    <ul className="admin-figure-breakdown">
      {labels.map(([key, word]) => (
        <li key={key}><Figure value={values?.[key]} /> <span>{word}</span></li>
      ))}
    </ul>
  );
}

/** Server aggregates only. Cards group each total, its meaning, and its next action. */
export default function EventFigures({ stats, isOperator }) {
  const registrations = stats.registrations ?? {};
  const tickets = stats.tickets ?? {};
  const speakers = stats.speakers ?? {};
  const sessions = stats.content?.cmsSchedule ?? {};
  const accounts = registrations.total ?? 0;
  const unresolved = stats.errors?.unresolved ?? 0;
  return (
    <section className="admin-overview-figures" aria-labelledby="event-figures-title">
      <div className="admin-section-intro">
        <h2 id="event-figures-title">Event figures</h2>
        <p>Server counts from the latest refresh. Choose a card’s action to continue your work.</p>
      </div>
      <div className="admin-figure-grid">
        <FigureCard title="Attendees" to="/admin/attendees" action="Manage attendees" className="admin-figure-card--wide">
          <p className="admin-figure-total"><Figure value={accounts} /> <span>{plural(accounts, 'account', 'accounts')}</span></p>
          <Breakdown values={registrations.byStatus} labels={[
            ['pending', 'pending'], ['ticketed', 'ticketed'], ['approved', 'approved'], ['revoked', 'revoked'],
          ]} />
          <p className="admin-figure-note"><Figure value={registrations.profileComplete} /> of <Figure value={accounts} /> {plural(accounts, 'profile', 'profiles')} complete.</p>
        </FigureCard>
        <FigureCard title="System health" to={isOperator ? '/admin/system-errors' : null} action="Review system errors" className={unresolved > 0 ? 'admin-figure-card--attention' : ''}>
          <p className="admin-figure-total"><Figure value={unresolved} /> <span>unresolved {plural(unresolved, 'error', 'errors')}</span></p>
          <p className="admin-figure-note">{unresolved > 0 ? 'Unresolved errors need an operator’s review.' : 'No unresolved errors were reported in this snapshot.'}</p>
          {!isOperator ? <p className="admin-figure-note">Only operators can open the error details.</p> : null}
        </FigureCard>
        <FigureCard title="Tickets" to="/admin/ticketing" action="Open ticketing">
          <p className="admin-figure-total"><Figure value={tickets.total} /> <span>{plural(tickets.total ?? 0, 'ticket', 'tickets')}</span></p>
          <Breakdown values={tickets.byStatus} labels={[
            ['valid', 'valid'], ['refunded', 'refunded'], ['cancelled', 'cancelled'], ['pending_info', 'waiting for details'],
          ]} />
          <p className="admin-figure-note">One ticket record, not one seat.</p>
        </FigureCard>
        <FigureCard title="Speakers" to="/admin/speakers" action="Manage speakers">
          <p className="admin-figure-total"><Figure value={speakers.total} /> <span>{plural(speakers.total ?? 0, 'speaker', 'speakers')}</span></p>
          <Breakdown values={speakers.byStatus} labels={[
            ['draft', 'draft'], ['invited', 'invited'], ['accepted', 'accepted'], ['approved', 'approved'], ['removed', 'removed'],
          ]} />
        </FigureCard>
        <FigureCard title="Program" to="/admin/sessions" action="Manage sessions">
          <p className="admin-figure-total"><Figure value={sessions.published} /> <span>{plural(sessions.published ?? 0, 'session', 'sessions')} on the site</span></p>
          <p className="admin-figure-note"><Figure value={sessions.drafts} /> with unpublished changes.</p>
          <p className="admin-figure-note">Review the running order, session details, and publishing state.</p>
        </FigureCard>
      </div>
    </section>
  );
}
