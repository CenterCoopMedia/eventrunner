import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { callApi } from '../../api.js';
import { ROLE_LABELS, formatDate, formatFee } from '../../text.js';
import { STATUS_LABELS, TICKET_LABELS, formatDateTime } from '../../reviewText.js';
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
  if (result.mailFailed) return `${DONE[name]} We could not email every Owner. Contact them another way.`;
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

const BUILD_STATE_LABELS = Object.freeze({
  queued: 'Waiting to run',
  running: 'Running',
  done: 'Finished',
  failed: 'Failed',
});

/** The build record, in full. Only the hosting team sees it. */
function BuildRecord({ build, canRetry, retrying, onRetry }) {
  if (!build && !canRetry) return null;
  return (
    <>
      <h2 id="build-title">Build</h2>
      {build ? (
        <>
          <p>
            <span className="tag">{BUILD_STATE_LABELS[build.state] || build.state}</span>
            {build.testMode ? <span className="tag">Test mode</span> : null}
          </p>
          {build.error ? (
            <aside className="note" role="note">
              <p className="note-title">The build failed</p>
              <p className="break">{build.error}</p>
              <p>The payment stands. Fix the cause, then retry. The steps that finished are not done twice.</p>
            </aside>
          ) : null}
          <ol className="stack" aria-labelledby="build-title">
            {build.steps.map((step) => (
              <li key={step.id}>
                <strong>{step.label}</strong>: {BUILD_STATE_LABELS[step.state] || step.state}
                {step.at ? `, ${formatDateTime(step.at)}` : ''}
                {step.detail ? <span className="muted break"> {step.detail}</span> : null}
              </li>
            ))}
          </ol>
          {build.runUrl ? <p><a href={build.runUrl}>Open the run</a></p> : null}
        </>
      ) : null}
      {canRetry ? (
        <p>
          <button type="button" className="button primary" disabled={retrying} onClick={onRetry}>
            {retrying ? 'Starting the build' : 'Retry the build'}
          </button>
        </p>
      ) : null}
    </>
  );
}

/** What the hosting team must act on after a payment. */
function PaymentNotes({ app, build }) {
  return (
    <>
      {app.buildStart?.state === 'failed' && build?.state !== 'failed' ? (
        <aside className="note" role="note">
          <p className="note-title">The build did not start</p>
          <p>The payment stands and the request stays approved. Read the function logs and fix the cause, then retry the build.</p>
        </aside>
      ) : null}
      {app.feeProblem ? (
        <aside className="note" role="note">
          <p className="note-title">A payment needs attention</p>
          <p>A paid session did not approve this request. Reason: {app.feeProblem.code}. Session: <span className="break">{app.feeProblem.sessionId}</span>. Payment intent: <span className="break">{app.feeProblem.paymentIntentId || 'not given'}</span>. Compare it with the payment in Stripe, and refund it if it should not stand.</p>
        </aside>
      ) : null}
    </>
  );
}

/** The current acceptance and the payment, as the server recorded them. */
function AgreementAndFee({ acceptance, payment }) {
  if (!acceptance && !payment) return null;
  return (
    <>
      <h2 id="agreement-fee-title">Agreement and event fee</h2>
      <dl className="answers">
        {acceptance ? (
          <>
            <div className="answer"><dt>Accepted by</dt><dd>{acceptance.name} ({acceptance.email}), {formatDateTime(acceptance.at)}</dd></div>
            <div className="answer"><dt>Agreement version</dt><dd>{acceptance.version}</dd></div>
            <div className="answer"><dt>SHA-256 of the text</dt><dd className="break">{acceptance.sha256}</dd></div>
            <div className="answer"><dt>Acceptance record</dt><dd className="break">{acceptance.id}</dd></div>
          </>
        ) : null}
        {payment ? (
          <>
            <div className="answer"><dt>Event fee paid</dt><dd>{formatFee(payment)}, {formatDateTime(payment.paidAt)}</dd></div>
            <div className="answer"><dt>Checkout session</dt><dd className="break">{payment.sessionId}</dd></div>
            <div className="answer"><dt>Payment intent</dt><dd className="break">{payment.paymentIntentId || 'Not given'}</dd></div>
          </>
        ) : null}
      </dl>
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
  const [retrying, setRetrying] = useState(false);

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
      // The revision ties the decision to the version on this page.
      const revision = name === 'deleteSpamApplication' ? {} : { revision: data?.application.revision };
      const result = await callApi(name, { appId, ...revision, ...body });
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
  }, [appId, data, load, navigate]);

  const retry = useCallback(async () => {
    setNotice('');
    setError('');
    setRetrying(true);
    try {
      const { started } = await callApi('retryBuild', { appId });
      if (started) setNotice('The build started again.');
      else setError('The build did not start. Read the function logs and fix the cause, then retry.');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setRetrying(false);
    }
  }, [appId, load]);

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
      <PaymentNotes app={app} build={data.build} />
      <BuildRecord build={data.build} canRetry={data.canRetryBuild} retrying={retrying} onRetry={retry} />

      <h2 id="decision-title">Decision</h2>
      {app.review?.note ? (
        <aside className="note" aria-labelledby="last-note-title">
          <p id="last-note-title" className="note-title">Last note to the client</p>
          <p className="history-note">{app.review.note}</p>
        </aside>
      ) : null}
      <ReviewActions key={app.status} status={app.status} defaults={data.approvalDefaults} onDecide={decide} />

      <h2 id="answers-title">Answers</h2>
      <p className="muted">
        {app.status === 'awaiting_payment'
          ? 'These are the answers the client accepted. The client can go back and change them until they pay.'
          : 'These are the answers the client sent. The client cannot change them during review.'}
      </p>
      <ReviewAnswers answers={app.answers} />

      <AgreementAndFee acceptance={app.acceptance} payment={app.payment} />

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
