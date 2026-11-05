import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { callApi } from '../api.js';
import ConnectionPanel, { ConnectionNotice } from '../setup/ConnectionPanel.jsx';
import { PROVIDER_COPY } from '../setup/connections.js';
import { BUILD_FAILED_LABEL, BUILD_PHASES, STATUS_LABELS, STEPS, TICKET_CHOICES, setupPath, statusPath } from '../setup/steps.js';
import { HostName, formatDate, hostName } from '../text.js';

const REFRESH_MS = 30000;

/** The plain steps (ADR 0007, amendment 2026-11-04), and the statuses that reach each one. */
const STAGES = [
  { label: 'Answer the setup questions and accept the agreement', reached: ['draft'] },
  { label: 'We are building your site', reached: ['approved', 'building'] },
  { label: 'Your site is ready', reached: ['ready', 'launched'] },
];

function Stages({ app }) {
  const at = STAGES.findIndex((stage) => stage.reached.includes(app.status));
  return (
    <ol className="stages">
      {STAGES.map((stage, i) => {
        const stopped = i === at && app.build?.failed;
        let state = 'Not started';
        if (i < at) state = 'Done';
        if (i === at) state = stopped ? 'Did not finish' : 'Now';
        return (
          <li key={stage.label} className={`stage ${i === at ? 'now' : ''} ${state === 'Done' ? 'done' : ''}`.trim()}
            aria-current={i === at ? 'step' : undefined}>
            <span className="stage-label">{stopped ? 'We started building your site' : stage.label}</span>
            <span className="tag">{state}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** A build takes a while, so this says the client can leave, then what is happening and what comes next. */
function BuildUnderway({ app }) {
  const current = app.build?.current;
  const at = current ? BUILD_PHASES.findIndex((phase) => phase.steps.includes(current)) : -1;
  const now = current ? BUILD_PHASES[at]?.label : 'Starting the build';
  const next = !current || at >= 0 ? BUILD_PHASES[at + 1]?.label : null;
  return (
    <aside className="note stack" role="note">
      <p className="note-title">You can close this page</p>
      <p>{app.myRole === 'owner' ? 'You' : 'The Owners'} will receive an email when your site is ready, with a link to finish setting it up.</p>
      {now ? <p>Now: {now}.{next ? ` Next: ${next}.` : ''}</p> : null}
    </aside>
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
      <span>Withdraw this request? We will not build the site, the web address becomes free, and your signup link stops working. To start again, you need a new link from {hostName()}.</span>
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

/**
 * A build that did not finish, in plain words (#608). Never the error text:
 * the client gets the next step, and the hosting team reads the record.
 * Reconnect comes first when the ticket account is why, so a retry that
 * cannot work does not use up the Owner's daily retries.
 */
function BuildFailed({ app, provider, retrying, onRetry }) {
  const name = provider ? PROVIDER_COPY[provider].name : null;
  const mayRetry = app.myRole === 'owner' || app.operator;
  const waitsForAccount = Boolean(provider) && !app.connections[provider].connected;
  let words = 'We did not finish building your site. You can retry the build. The steps that finished are not done twice.';
  if (provider) {
    words = waitsForAccount
      ? `We did not finish building your site, because we could not use your ${name} account. Reconnect the account below. You can then retry the build.`
      : `We did not finish building your site, because we could not use your ${name} account. Reconnect the account below if you have not, then retry the build.`;
  }
  return (
    <aside className="note stack" role="note">
      <p className="note-title">The build did not finish</p>
      <p>{words}</p>
      <p>{HostName()} is told about every build that does not finish.</p>
      {mayRetry && !waitsForAccount ? (
        <div>
          <button type="button" className="button primary" disabled={retrying} onClick={onRetry}>
            {retrying ? 'Starting the build' : 'Retry the build'}
          </button>
        </div>
      ) : null}
      {mayRetry ? null : <p className="muted">Only an Owner can reconnect an account or retry the build. Ask an Owner on your team to open this page.</p>}
    </aside>
  );
}

/** The live state of one request, with the note from the hosting team. */
export default function ApplicationStatus() {
  const { orgId, appId } = useParams();
  const { state } = useLocation();
  const [app, setApp] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [retrying, setRetrying] = useState(false);

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

  async function retry() {
    setNotice('');
    setError('');
    setRetrying(true);
    try {
      const { started } = await callApi('retryBuild', { orgId, appId });
      if (started) setNotice('We started the build again.');
      else setError('The build did not start. Try again in a few minutes.');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setRetrying(false);
    }
  }

  if (!app) return error ? <p className="message error" role="alert">{error}</p> : <p role="status">Loading your request.</p>;

  const title = app.answers.event.name || 'New event site';
  const closed = ['withdrawn', 'declined'].includes(app.status);
  const choice = app.answers.tickets.choice;
  const accounts = PROVIDERS.filter((provider) => app.connections[provider].connected || app.connections[provider].unfinished || (provider === choice && !closed));
  // An account that is gone blocks a retry whichever step failed, so it needs the same way back.
  const reconnectProvider = app.build?.failed && PROVIDERS.includes(choice) && (app.build.needsReconnect || !app.connections[choice].connected) ? choice : null;
  const canReconnect = Boolean(reconnectProvider) && app.myRole === 'owner';
  const underway = ['approved', 'building'].includes(app.status) && !app.build?.failed;
  return (
    <section aria-labelledby="status-title">
      <h1 id="status-title" tabIndex={-1}>{title}</h1>
      <p className="lead">{app.build?.failed ? BUILD_FAILED_LABEL : STATUS_LABELS[app.status]}</p>
      {app.address ? <p>Web address: <strong>{app.address}</strong></p> : null}

      {notice ? null : <ConnectionNotice message={state?.connectionMessage} />}
      <div aria-live="polite" className="live">
        {notice ? <p className="message success">{notice}</p> : null}
      </div>
      {error ? <p className="message error" role="alert">{error}</p> : null}

      {state?.copyFailed ? <p className="message error">We could not email your copy of the agreement. Your acceptance is saved, and you can read it below.</p> : null}
      {app.build?.failed ? <BuildFailed app={app} provider={reconnectProvider} retrying={retrying} onRetry={retry} /> : null}
      {underway ? <BuildUnderway app={app} /> : null}
      {app.status === 'declined' && app.note ? (
        <aside className="note" role="note">
          <p className="note-title">Note from {hostName()}</p>
          <p className="pre">{app.note}</p>
        </aside>
      ) : null}

      {closed ? (
        <p>{app.status === 'withdrawn' ? `This request is withdrawn. We will not build this site. To start again, ask ${hostName()} for a new signup link.` : 'This request is closed.'}</p>
      ) : <Stages app={app} />}

      {['ready', 'launched'].includes(app.status) && app.address ? (
        <p><a className="button primary" href={`https://${app.address}/admin`}>Open your admin panel</a></p>
      ) : null}
      {app.canEdit ? (
        <p><Link className="button primary" to={setupPath(orgId, appId, STEPS[0])}>Continue the setup</Link></p>
      ) : null}
      {app.acceptance ? (
        <p className="muted">{app.acceptance.name} accepted the agreement on {formatDate(app.acceptance.at)}. <Link to={`${statusPath(orgId, appId)}/accepted-agreement`}>Read the agreement</Link>.{underway ? '' : ' We email the Owners when the status changes.'}</p>
      ) : null}
      {accounts.map((provider) => (
        <div className="section" key={provider}>
          <ConnectionPanel
            provider={provider}
            orgId={orgId}
            appId={appId}
            connections={app.connections}
            errors={provider === choice ? app.errors : {}}
            // Once the answers are frozen, only the account they chose can connect, and only to recover a failed build.
            canConnect={(app.connections.canChange && app.canEdit) || (canReconnect && provider === reconnectProvider)}
            connectLabel={provider === reconnectProvider && canReconnect ? 'Reconnect' : undefined}
            myRole={app.myRole}
            returnPath={statusPath(orgId, appId)}
            onConnections={load}
            onNotice={setNotice}
          />
        </div>
      ))}
      {app.canWithdraw ? <div className="section"><Withdraw onWithdraw={withdraw} /></div> : null}
      <p className="section"><Link to={`/organizations/${orgId}`}>Back to your event sites</Link></p>
    </section>
  );
}
