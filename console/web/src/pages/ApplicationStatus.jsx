import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { callApi } from '../api.js';
import { STATUS_LABELS, STEPS, setupPath } from '../setup/steps.js';
import { formatDate } from '../text.js';

const REFRESH_MS = 30000;

/** The plain steps after the setup (ADR 0007 §3), and the statuses that reach each one. */
const STAGES = [
  { label: 'Answer the setup questions', reached: ['draft', 'changes_requested'] },
  { label: 'We are reviewing your request', reached: ['submitted'] },
  { label: 'We are building your site', reached: ['approved', 'building'] },
  { label: 'Your site is ready', reached: ['ready', 'launched'] },
];

function stageIndex(status) {
  return STAGES.findIndex((stage) => stage.reached.includes(status));
}

function Stages({ status }) {
  const at = stageIndex(status);
  return (
    <ol className="stages">
      {STAGES.map((stage, i) => {
        let state = 'Not started';
        if (i < at) state = 'Done';
        if (i === at) state = 'Now';
        return (
          <li key={stage.label} className={`stage ${state === 'Now' ? 'now' : ''} ${state === 'Done' ? 'done' : ''}`.trim()}
            aria-current={state === 'Now' ? 'step' : undefined}>
            <span className="stage-label">{stage.label}</span>
            <span className="tag">{state}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Withdraw asks once, in place. Cancel returns the focus to Withdraw. */
function Withdraw({ onWithdraw }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const button = useRef(null);
  if (!asking) {
    return <button type="button" className="button danger" ref={button} onClick={() => setAsking(true)}>Withdraw the request</button>;
  }
  return (
    <div className="confirm" role="group" aria-label="Withdraw the request">
      <span>Withdraw this request? We will not build the site, and the web address becomes free.</span>
      <button type="button" className="button danger" disabled={busy}
        onClick={async () => { setBusy(true); await onWithdraw(); setBusy(false); setAsking(false); }}>
        Yes, withdraw
      </button>
      <button type="button" className="button" autoFocus onClick={() => { setAsking(false); setTimeout(() => button.current?.focus(), 0); }}>
        Cancel
      </button>
    </div>
  );
}

/** The live state of one request, with the note from the hosting team. */
export default function ApplicationStatus() {
  const { orgId, appId } = useParams();
  const [app, setApp] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      setApp((await callApi('getApplication', { orgId, appId })).application);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [orgId, appId]);

  // Live state: read again every 30 seconds while the page is open.
  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  async function withdraw() {
    setNotice('');
    try {
      await callApi('withdrawApplication', { orgId, appId });
      setNotice('You withdrew the request.');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!app) return error ? <p className="message error" role="alert">{error}</p> : <p role="status">Loading your request.</p>;

  const title = app.answers.event.name || 'New event site';
  const closed = ['withdrawn', 'declined'].includes(app.status);
  return (
    <section aria-labelledby="status-title">
      <h1 id="status-title" tabIndex={-1}>{title}</h1>
      <p className="lead">{STATUS_LABELS[app.status]}</p>
      {app.address ? <p>Web address: <strong>{app.address}</strong></p> : null}

      <div aria-live="polite" className="live">
        {notice ? <p className="message success">{notice}</p> : null}
      </div>
      {error ? <p className="message error" role="alert">{error}</p> : null}

      {app.status === 'changes_requested' ? (
        <aside className="note" role="note">
          <p className="note-title">The hosting team asked for changes</p>
          {app.note ? <p className="pre">{app.note}</p> : null}
        </aside>
      ) : null}
      {app.status === 'declined' && app.note ? (
        <aside className="note" role="note">
          <p className="note-title">Note from the hosting team</p>
          <p className="pre">{app.note}</p>
        </aside>
      ) : null}

      {closed ? (
        <p>{app.status === 'withdrawn' ? 'This request is withdrawn. We will not build this site.' : 'This request is closed.'}</p>
      ) : <Stages status={app.status} />}

      {app.canEdit ? (
        <p>
          <Link className="button primary" to={setupPath(orgId, appId, STEPS[app.status === 'changes_requested' ? 6 : 0])}>
            {app.status === 'changes_requested' ? 'Make the changes' : 'Continue the setup'}
          </Link>
        </p>
      ) : null}
      {app.submittedAt ? <p className="muted">Sent on {formatDate(app.submittedAt)}. We email the Owners when the status changes.</p> : null}
      {app.canWithdraw ? <div className="section"><Withdraw onWithdraw={withdraw} /></div> : null}
      <p className="section"><Link to={`/organizations/${orgId}`}>Back to your event sites</Link></p>
    </section>
  );
}
