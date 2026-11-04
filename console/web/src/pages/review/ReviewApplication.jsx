import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { callApi } from '../../api.js';
import { ROLE_LABELS, formatDate } from '../../text.js';
import { STATUS_LABELS, TICKET_LABELS } from '../../reviewText.js';
import HostingOnly, { isNotOperator } from './HostingOnly.jsx';
import ReviewActions from './ReviewActions.jsx';
import ReviewAnswers from './ReviewAnswers.jsx';
import ReviewHistory from './ReviewHistory.jsx';

const DONE = Object.freeze({
  requestChanges: 'You asked for changes.',
  declineApplication: 'You declined the request. Its web address is free again.',
  approveApplication: 'You approved the request and recorded the build settings.',
});

/** What the page says after a decision, with the email result. */
function doneMessage(name, result) {
  if (result.mailFailed) return `${DONE[name]} We could not email the Owners. Contact them another way.`;
  return `${DONE[name]} We emailed the Owners.`;
}

function Team({ team }) {
  return (
    <>
      <ul className="cards" aria-labelledby="team-title">
        {team.members.map((member) => (
          <li key={member.uid} className="card">
            <span className="card-title break">{member.email}</span>
            <span className="tag">{ROLE_LABELS[member.role] || member.role}</span>
          </li>
        ))}
      </ul>
      {team.invites.length > 0 ? (
        <>
          <h3 id="review-invites-title">Invites waiting for an answer</h3>
          <ul className="cards" aria-labelledby="review-invites-title">
            {team.invites.map((invite) => (
              <li key={invite.id} className="card">
                <span className="card-title break">{invite.email}</span>
                <span className="tag">{ROLE_LABELS[invite.role] || invite.role}</span>
                <span className="muted">Link expires {formatDate(invite.expiresAt)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}

/** One request for review: answers, team, history and the decisions. Hosting team only. */
export default function ReviewApplication() {
  const { appId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await callApi('getApplicationForReview', { appId }));
      setLoadError(null);
    } catch (err) {
      setLoadError(err);
    }
  }, [appId]);

  useEffect(() => {
    load();
  }, [load]);

  const decide = useCallback(async (name, body) => {
    setNotice('');
    setError('');
    try {
      const result = await callApi(name, { appId, ...body });
      if (name === 'deleteSpamApplication') {
        navigate('/review', { state: { notice: 'The request is deleted. Its web address is free again.' } });
        return true;
      }
      setNotice(doneMessage(name, result));
      await load();
      return true;
    } catch (err) {
      // A refusal about one setting shows at that field in the form.
      if (!err.field) setError(err.message);
      return err;
    }
  }, [appId, load, navigate]);

  if (isNotOperator(loadError)) return <HostingOnly />;
  if (!data) {
    return loadError ? <p className="message error" role="alert">{loadError.message}</p> : <p role="status">Loading the request.</p>;
  }

  const { application: app, organization, team, connection } = data;
  return (
    <section aria-labelledby="review-title">
      <p className="folio">{organization.name}</p>
      <h1 id="review-title" tabIndex={-1}>{app.answers?.event?.name || 'Request'}</h1>
      <p><span className="tag">{STATUS_LABELS[app.status] || app.status}</span></p>

      <div aria-live="polite" className="live">
        {notice ? <p className="message success">{notice}</p> : null}
      </div>
      {error ? <p className="message error" role="alert">{error}</p> : null}

      <h2 id="decision-title">Decision</h2>
      {app.review?.note ? (
        <aside className="note" aria-labelledby="last-note-title">
          <p id="last-note-title" className="note-title">Last note to the client</p>
          <p className="history-note">{app.review.note}</p>
        </aside>
      ) : null}
      <ReviewActions key={app.status} status={app.status} defaults={data.approvalDefaults} onDecide={decide} />

      <h2 id="answers-title">Answers</h2>
      <p className="muted">These are the answers the client sent. The client cannot change them during review.</p>
      <ReviewAnswers answers={app.answers} />

      <h2 id="tickets-title">Ticket sales</h2>
      <dl className="answers">
        <div className="answer"><dt>Choice</dt><dd>{TICKET_LABELS[app.ticketChoice] || 'Not given'}</dd></div>
        <div className="answer"><dt>Account</dt><dd>{connection.label}</dd></div>
      </dl>

      <h2 id="team-title">Team</h2>
      <Team team={team} />

      <h2 id="history-title">History</h2>
      <ReviewHistory history={app.history} />

      <p className="section"><Link to="/review">Go to the review queue</Link></p>
    </section>
  );
}
