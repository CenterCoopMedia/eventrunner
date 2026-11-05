import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { callApi } from '../../api.js';
import { ActionResult } from '../../ActionFeedback.jsx';
import { ROLE_LABELS, formatDate } from '../../text.js';
import { STATUS_LABELS, TICKET_LABELS, formatDateTime } from '../../reviewText.js';
import HostingOnly, { isNotOperator } from './HostingOnly.jsx';
import ReviewActions from './ReviewActions.jsx';
import ReviewAnswers from './ReviewAnswers.jsx';
import ReviewHistory from './ReviewHistory.jsx';
import LoadingState from '../../LoadingState.jsx';

/** What the page says after a decision, with the email result. */
function decidedMessage(name, result) {
  const done = name === 'closeApplication'
    ? 'You closed the request. If no build ever began, its web address is free again.'
    : 'You declined the request. Its web address is free again.';
  return result.mailFailed ? `${done} We could not email every Owner. Contact them another way.` : `${done} We emailed the Owners.`;
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
function BuildRecord({ build, canRetry, retrying, onRetry, disabled, result, onRefresh, refreshing }) {
  if (!build && !canRetry && !result) return null;
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
              <p>Fix the cause, then retry. The steps that finished are not done twice.</p>
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
          <button type="button" className="button primary" disabled={retrying || disabled} onClick={onRetry}>
            {retrying ? 'Starting the build' : 'Retry the build'}
          </button>
        </p>
      ) : null}
      <ActionResult result={result} onRefresh={onRefresh} refreshing={refreshing} refreshLabel="Refresh build record" />
    </>
  );
}

/** The current acceptance, as the server recorded it. */
function Acceptance({ acceptance }) {
  if (!acceptance) return null;
  return (
    <>
      <h2 id="agreement-title">Agreement</h2>
      <dl className="answers">
        <div className="answer"><dt>Accepted by</dt><dd>{acceptance.name}{acceptance.title ? `, ${acceptance.title}` : ''} ({acceptance.email}), {formatDateTime(acceptance.at)}</dd></div>
        {acceptance.legalName ? <div className="answer"><dt>Legal name</dt><dd>{acceptance.legalName}</dd></div> : null}
        <div className="answer"><dt>Agreement version</dt><dd>{acceptance.version}</dd></div>
        <div className="answer"><dt>SHA-256 of the text</dt><dd className="break">{acceptance.sha256}</dd></div>
        <div className="answer"><dt>Acceptance record</dt><dd className="break">{acceptance.id}</dd></div>
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
  const [decisionResult, setDecisionResult] = useState(null);
  const [retryResult, setRetryResult] = useState(null);
  const [working, setWorking] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [stale, setStale] = useState(false);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    try {
      setData(await callApi('getApplicationForReview', { appId }));
      setLoadError(null);
      return '';
    } catch (err) {
      setLoadError(err);
      return err.message;
    }
  }, [appId]);

  useEffect(() => {
    load();
  }, [load]);

  const decide = useCallback(async (name, body) => {
    if (inFlight.current || stale) return false;
    inFlight.current = true;
    setWorking('decision');
    setDecisionResult(null);
    try {
      // The revision ties the decision to the version on this page.
      const revision = name === 'deleteSpamApplication' ? {} : { revision: data?.application.revision };
      const result = await callApi(name, { appId, ...revision, ...body });
      if (name === 'deleteSpamApplication') {
        navigate('/review', { state: { notice: 'The request is deleted. If no build ever began, its web address is free again.' } });
        return true;
      }
      const problem = await load();
      setStale(Boolean(problem));
      setDecisionResult({ kind: 'success', message: decidedMessage(name, result),
        refreshError: problem ? `The decision is saved, but we could not refresh the request. ${problem}` : '' });
      return true;
    } catch (err) {
      setDecisionResult({ kind: 'error', message: err.message });
      return err;
    } finally {
      inFlight.current = false;
      setWorking('');
    }
  }, [appId, data, load, navigate, stale]);

  const retry = useCallback(async () => {
    if (inFlight.current || stale) return;
    inFlight.current = true;
    setWorking('retry');
    setRetryResult(null);
    try {
      const { started } = await callApi('retryBuild', { appId });
      const problem = await load();
      setStale(Boolean(problem));
      setRetryResult({ kind: started ? 'success' : 'error',
        message: started ? 'The build started again.' : 'The build did not start. Read the function logs and fix the cause, then retry.',
        refreshError: problem ? `We could not refresh the build record. ${problem}` : '' });
    } catch (err) {
      setRetryResult({ kind: 'error', message: err.message });
    } finally {
      inFlight.current = false;
      setWorking('');
    }
  }, [appId, load, stale]);

  async function refresh(kind) {
    setRefreshing(true);
    const problem = await load();
    setStale(Boolean(problem));
    const update = kind === 'retry' ? setRetryResult : setDecisionResult;
    update((current) => current ? { ...current, refreshError: problem ? `We could not refresh the request. ${problem}` : '' } : current);
    setRefreshing(false);
  }

  if (isNotOperator(loadError)) return <HostingOnly />;
  if (!data) {
    return loadError ? <p className="message error" role="alert">{loadError.message}</p> : <LoadingState>Loading the request.</LoadingState>;
  }

  const { application: app, organization, team, connection } = data;
  return (
    <section aria-labelledby="review-title">
      <p className="folio">{organization.name}</p>
      <h1 id="review-title" tabIndex={-1}>{app.answers?.event?.name || 'Request'}</h1>
      <p><span className="tag">{STATUS_LABELS[app.status] || app.status}</span></p>

      {app.buildStart?.state === 'failed' && data.build?.state !== 'failed' ? (
        <aside className="note" role="note">
          <p className="note-title">The build did not start</p>
          <p>The request stays approved. Read the function logs and fix the cause, then retry the build.</p>
        </aside>
      ) : null}
      <BuildRecord build={data.build} canRetry={data.canRetryBuild} retrying={working === 'retry'} onRetry={retry}
        disabled={Boolean(working) || stale || refreshing} result={retryResult} onRefresh={() => refresh('retry')} refreshing={refreshing} />

      <h2 id="decision-title">Decision</h2>
      {app.review?.note ? (
        <aside className="note" aria-labelledby="last-note-title">
          <p id="last-note-title" className="note-title">Last note to the client</p>
          <p className="history-note">{app.review.note}</p>
        </aside>
      ) : null}
      <ReviewActions key={app.status} status={app.status} canClose={data.canRetryBuild} onDecide={decide}
        busy={working === 'decision'} disabled={stale || working === 'retry' || refreshing}
        result={decisionResult} onRefresh={() => refresh('decision')} refreshing={refreshing} />

      <h2 id="answers-title">Answers</h2>
      {app.acceptance ? <p className="muted">These are the answers the client accepted. The client cannot change them now.</p> : null}
      <ReviewAnswers answers={app.answers} />

      <Acceptance acceptance={app.acceptance} />

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
