import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router';
import { callApi } from '../api.js';
import ConnectionPanel, { ConnectionNotice } from '../setup/ConnectionPanel.jsx';
import { STATUS_LABELS, STEPS, TICKET_CHOICES, setupPath, statusPath, stepById } from '../setup/steps.js';
import { formatDate, formatFee } from '../text.js';

const REFRESH_MS = 30000;
// Sooner while the reader waits to hear about a payment they just made.
const WAITING_REFRESH_MS = 5000;

/** The plain steps after the setup (ADR 0007, amendment 2026-11-04), and the statuses that reach each one. */
const STAGES = [
  { label: 'Answer the setup questions', reached: ['draft'] },
  { label: 'Accept the agreement and pay the event fee', reached: ['awaiting_payment'] },
  { label: 'We are building your site', reached: ['approved', 'building'] },
  { label: 'Your site is ready', reached: ['ready', 'launched'] },
];

/** The same steps for a request the hosting team reviews, which has no payment. */
const REVIEW_STAGES = [
  { label: 'Answer the setup questions', reached: ['draft', 'changes_requested'] },
  { label: 'We are reviewing your request', reached: ['submitted'] },
  STAGES[2],
  STAGES[3],
];

function stagesFor(app) {
  const reviewed = ['submitted', 'changes_requested'].includes(app.status)
    || (STAGES.slice(2).some((stage) => stage.reached.includes(app.status)) && !app.payment);
  return reviewed ? REVIEW_STAGES : STAGES;
}

function Stages({ app }) {
  const stages = stagesFor(app);
  const at = stages.findIndex((stage) => stage.reached.includes(app.status));
  return (
    <ol className="stages">
      {stages.map((stage, i) => {
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

const PROVIDERS = TICKET_CHOICES.filter((choice) => choice.connect).map((choice) => choice.value);

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
  const { state } = useLocation();
  const [app, setApp] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search] = useSearchParams();
  const payment = search.get('payment');
  // Coming back from the payment page proves nothing, so this only changes
  // the words. Only the server's confirmation moves the request on.
  const waiting = app?.status === 'awaiting_payment' && payment === 'done';

  const load = useCallback(async () => {
    try {
      setApp((await callApi('getApplication', { orgId, appId })).application);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [orgId, appId]);

  // Live state: read again while the page is open.
  useEffect(() => {
    load();
    const timer = setInterval(load, waiting ? WAITING_REFRESH_MS : REFRESH_MS);
    return () => clearInterval(timer);
  }, [load, waiting]);

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
  const feeLink = setupPath(orgId, appId, stepById('fee'));
  const choice = app.answers.tickets.choice;
  const accounts = PROVIDERS.filter((provider) => app.connections[provider].connected || (provider === choice && !closed));
  return (
    <section aria-labelledby="status-title">
      <h1 id="status-title" tabIndex={-1}>{title}</h1>
      <p className="lead">{waiting ? 'Waiting for payment confirmation' : STATUS_LABELS[app.status]}</p>
      {app.address ? <p>Web address: <strong>{app.address}</strong></p> : null}

      <ConnectionNotice message={state?.connectionMessage} />
      <div aria-live="polite" className="live">
        {notice ? <p className="message success">{notice}</p> : null}
      </div>
      {error ? <p className="message error" role="alert">{error}</p> : null}

      {waiting ? (
        <aside className="note" role="note">
          <p className="note-title">We are waiting for confirmation of your payment</p>
          <p>This page updates on its own, and we email the Owners when it is confirmed. If nothing changes after a few minutes, <Link to={feeLink}>open the event fee step</Link>. You will not be charged twice.</p>
        </aside>
      ) : null}
      {app.status === 'awaiting_payment' && payment === 'cancelled' ? (
        <aside className="note" role="note">
          <p className="note-title">You did not finish paying</p>
          <p>We took no money. Your answers and your acceptance are saved, so you can pay when you are ready.</p>
        </aside>
      ) : null}

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
      ) : <Stages app={app} />}

      {app.canEdit ? (
        <p>
          <Link className="button primary" to={setupPath(orgId, appId, STEPS[app.status === 'changes_requested' ? 6 : 0])}>
            {app.status === 'changes_requested' ? 'Make the changes' : 'Continue the setup'}
          </Link>
        </p>
      ) : null}
      {app.status === 'awaiting_payment' && !waiting && app.canPay ? (
        <p><Link className="button primary" to={feeLink}>Pay the event fee</Link></p>
      ) : null}
      {app.status === 'awaiting_payment' && !app.canPay && app.myRole ? (
        <p className="muted">Only an Owner can pay the event fee. Ask an Owner on your team to open this request.</p>
      ) : null}
      {app.payment ? <p className="muted">We received your event fee of {formatFee(app.payment)} on {formatDate(app.payment.paidAt)}.</p> : null}
      {app.acceptance && app.status === 'awaiting_payment' ? (
        <p className="muted">{app.acceptance.name} accepted the agreement on {formatDate(app.acceptance.at)}. We email the Owners when the status changes.</p>
      ) : null}
      {accounts.map((provider) => (
        <div className="section" key={provider}>
          <ConnectionPanel
            provider={provider}
            orgId={orgId}
            appId={appId}
            connections={app.connections}
            errors={provider === choice ? app.errors : {}}
            // Once the answers are with the hosting team, only the account they chose can connect.
            canConnect={app.connections.canChange && (app.canEdit || provider === choice)}
            myRole={app.myRole}
            returnPath={statusPath(orgId, appId)}
            onConnections={load}
            onNotice={setNotice}
          />
        </div>
      ))}
      {app.submittedAt && app.status !== 'awaiting_payment' ? <p className="muted">Sent on {formatDate(app.submittedAt)}. We email the Owners when the status changes.</p> : null}
      {app.canWithdraw ? <div className="section"><Withdraw onWithdraw={withdraw} /></div> : null}
      <p className="section"><Link to={`/organizations/${orgId}`}>Back to your event sites</Link></p>
    </section>
  );
}
