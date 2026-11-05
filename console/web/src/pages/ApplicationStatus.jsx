import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { callApi } from '../api.js';
import LoadingState from '../LoadingState.jsx';
import WaitingBuddy from '../WaitingBuddy.jsx';
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
  // The last stage is an end state: once reached, the whole list is done.
  const finished = at === STAGES.length - 1;
  return (
    <ol className="stages">
      {STAGES.map((stage, i) => {
        const stopped = i === at && app.build?.failed;
        let state = 'Not started';
        if (i < at) state = 'Done';
        if (i === at) state = stopped ? 'Did not finish' : 'Now';
        if (finished && i === at) state = 'Done';
        const now = i === at && !finished;
        return (
          <li key={stage.label} className={`stage ${now ? 'now' : ''} ${state === 'Done' ? 'done' : ''}`.trim()}
            aria-current={i === at ? 'step' : undefined}>
            <svg className="stage-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <circle cx="12" cy="12" r="9" />
              {state === 'Done' ? <path d="m8 12 3 3 5-6" /> : null}
              {now ? <circle className="stage-current-dot" cx="12" cy="12" r="3" /> : null}
            </svg>
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
    <aside className="note build-note" role="note">
      <WaitingBuddy />
      <div className="stack">
        <p className="note-title">You can close this page</p>
        <p>Most sites take about an hour and a half to build. Setting up your web address takes the longest.</p>
        <p>{app.myRole === 'owner' ? 'You' : 'The Owners'} will receive an email when your site is ready, with a link to finish setting it up.</p>
        <p role="status" aria-atomic="true" className="visually-hidden">{now ? <>Now: {now}.{next ? ` Next: ${next}.` : ''}</> : 'The build is in progress.'}</p>
        <ol className="build-steps" aria-label="Build steps">
          {BUILD_PHASES.map((phase, i) => {
            const state = i < at ? 'done' : i === at ? 'now' : 'later';
            return (
              <li key={phase.label} className={`build-step ${state}`} aria-current={state === 'now' ? 'step' : undefined}>
                <svg className="build-step-mark" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                  <circle cx="10" cy="10" r="7.5" />
                  {state === 'done' ? <path d="m6.5 10 2.5 2.5 4.5-5" /> : null}
                  {state === 'now' ? <circle className="build-step-dot" cx="10" cy="10" r="3" /> : null}
                </svg>
                <span className="build-step-text">
                  <span className="build-step-label">{phase.label}<span className="visually-hidden">{state === 'done' ? ', done' : state === 'now' ? ', happening now' : ''}</span></span>
                  {state === 'now' ? <span className="build-step-detail">{phase.detail}</span> : null}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </aside>
  );
}

const PROVIDERS = TICKET_CHOICES.filter((choice) => choice.connect).map((choice) => choice.value);

/** A result stays at its action; recovery only refreshes the current record. */
function ActionNotice({ result, onRefresh, refreshing, focus = false }) {
  const element = useRef(null);
  useEffect(() => {
    if (!result || !element.current) return;
    if (focus && result.kind === 'success') element.current.focus();
    const box = element.current.getBoundingClientRect();
    if (box.top < 0 || box.bottom > window.innerHeight) element.current.scrollIntoView?.({ block: 'nearest' });
  }, [result, focus]);
  if (!result) return null;
  return (
    <div className={`message ${result.kind}`} role={result.kind === 'error' ? 'alert' : 'status'} ref={element} tabIndex={-1}>
      <p>{result.message}</p>
      {result.refreshError ? <>
        <p>{result.refreshError}</p>
        <button type="button" className="button" disabled={refreshing} onClick={onRefresh}>{refreshing ? 'Refreshing…' : 'Refresh request'}</button>
      </> : null}
    </div>
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
      <span>Withdraw this request? We will not build the site, the web address becomes free, and your signup link stops working. To start again, you need a new link from {hostName()}.</span>
      <button type="button" className="button danger" disabled={busy}
        onClick={async () => {
          if (busy) return;
          setBusy(true);
          try { if (await onWithdraw()) setAsking(false); } finally { setBusy(false); }
        }}>
        {busy ? 'Withdrawing…' : 'Yes, withdraw'}
      </button>
      <button type="button" className="button" disabled={busy} autoFocus onClick={() => { setAsking(false); setTimeout(() => button.current?.focus(), 0); }}>
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
function BuildFailed({ app, provider, retrying, onRetry, disabled }) {
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
          <button type="button" className="button primary" disabled={retrying || disabled} onClick={onRetry}>
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
  const [withdrawResult, setWithdrawResult] = useState(null);
  const [retryResult, setRetryResult] = useState(null);
  const [connectionResults, setConnectionResults] = useState({});
  const [refreshing, setRefreshing] = useState('');
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(async ({ quiet = false } = {}) => {
    try {
      setApp((await callApi('getApplication', { orgId, appId })).application);
      setError('');
      return '';
    } catch (err) {
      if (!quiet) setError(err.message);
      return err.message;
    }
  }, [orgId, appId]);

  // Live state: read again while the page is open.
  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  async function withdraw() {
    if (withdrawResult?.kind === 'success') return false;
    setWithdrawResult(null);
    try {
      await callApi('withdrawApplication', { orgId, appId });
      setApp((current) => ({ ...current, status: 'withdrawn', canWithdraw: false, canEdit: false, canAccept: false }));
      setWithdrawResult({ kind: 'success', message: 'You withdrew the request.' });
      const problem = await load({ quiet: true });
      setWithdrawResult({ kind: 'success', message: 'You withdrew the request.',
        refreshError: problem ? `The request is withdrawn, but we could not refresh its details. ${problem}` : '' });
      return true;
    } catch (err) {
      setWithdrawResult({ kind: 'error', message: err.message });
      return false;
    }
  }

  async function retry() {
    if (retrying || retryResult?.refreshError) return;
    setRetryResult(null);
    setRetrying(true);
    try {
      const { started } = await callApi('retryBuild', { orgId, appId });
      const problem = await load({ quiet: true });
      setRetryResult({ kind: started ? 'success' : 'error',
        message: started ? 'We started the build again.' : 'The build did not start. Try again in a few minutes.',
        refreshError: problem ? `We could not refresh the request. ${problem}` : '' });
    } catch (err) {
      setRetryResult({ kind: 'error', message: err.message });
    } finally {
      setRetrying(false);
    }
  }

  async function refreshResult(key) {
    setRefreshing(key);
    const problem = await load({ quiet: true });
    const update = (current) => current ? { ...current, refreshError: problem ? `We could not refresh the request. ${problem}` : '' } : current;
    if (key === 'withdraw') setWithdrawResult(update);
    else if (key === 'retry') setRetryResult(update);
    else setConnectionResults((current) => ({ ...current, [key]: update(current[key]) }));
    setRefreshing('');
  }

  async function refreshConnection(provider) {
    const problem = await load({ quiet: true });
    if (problem) setConnectionResults((current) => ({ ...current, [provider]: {
      ...(current[provider] || { kind: 'success', message: 'The account change is saved.' }),
      refreshError: `The change is saved, but we could not refresh the request. ${problem}`,
    } }));
  }

  if (!app) return error ? <p className="message error console-workspace" role="alert">{error}</p> : <LoadingState long className="console-workspace">Loading your request.</LoadingState>;

  const title = app.answers.event.name || 'New event site';
  const closed = ['withdrawn', 'declined'].includes(app.status);
  const choice = app.answers.tickets.choice;
  const accounts = PROVIDERS.filter((provider) => connectionResults[provider] || app.connections[provider].connected || app.connections[provider].unfinished || (provider === choice && !closed));
  // An account that is gone blocks a retry whichever step failed, so it needs the same way back.
  const reconnectProvider = app.build?.failed && PROVIDERS.includes(choice) && (app.build.needsReconnect || !app.connections[choice].connected) ? choice : null;
  const canReconnect = Boolean(reconnectProvider) && app.myRole === 'owner';
  const underway = ['approved', 'building'].includes(app.status) && !app.build?.failed;
  const live = ['ready', 'launched'].includes(app.status);
  return (
    <section aria-labelledby="status-title" className="console-workspace application-workspace">
      <div className={`application-layout${closed ? ' application-closed' : ''}`}>
        <div className="application-summary">
          <header className="workspace-heading">
            <h1 id="status-title" tabIndex={-1}>{title}</h1>
            <p className="lead application-state">{app.build?.failed ? BUILD_FAILED_LABEL : STATUS_LABELS[app.status]}</p>
          </header>
          {/* The address shows once the site answers there, so nobody opens it to a hosting error page mid-build. */}
          {live && app.address ? (
            <p className="application-address"><span>Web address</span><strong><a href={`https://${app.address}`}>{app.address}</a></strong></p>
          ) : null}

          <ConnectionNotice message={state?.connectionMessage} />
          {error ? <p className="message error" role="alert">{error}</p> : null}

          {state?.copyFailed ? <p className="message error">We could not email your copy of the agreement. Your acceptance is saved, and you can read it below.</p> : null}
          {app.build?.failed ? <BuildFailed app={app} provider={reconnectProvider} retrying={retrying} onRetry={retry} disabled={Boolean(retryResult?.refreshError)} /> : null}
          <ActionNotice result={retryResult} onRefresh={() => refreshResult('retry')} refreshing={refreshing === 'retry'} />
          {underway ? <BuildUnderway app={app} /> : null}
          {app.status === 'declined' && app.note ? (
            <aside className="note" role="note">
              <p className="note-title">Note from {hostName()}</p>
              <p className="pre">{app.note}</p>
            </aside>
          ) : null}

          {closed ? (
            <p>{app.status === 'withdrawn' ? `This request is withdrawn. We will not build this site. To start again, ask ${hostName()} for a new signup link.` : 'This request is closed.'}</p>
          ) : null}

          <div className="application-actions">
            {live && app.address ? (
              <p><a className="button primary" href={`https://${app.address}/admin`}>Open your admin panel</a></p>
            ) : null}
            {app.canEdit ? (
              <p><Link className="button primary" to={setupPath(orgId, appId, STEPS[0])}>Continue the setup</Link></p>
            ) : null}
            <p><Link className="button" to={`/organizations/${orgId}`}>Back to your event sites</Link></p>
          </div>
        </div>
        {closed ? null : (
          <aside className="application-progress" aria-labelledby="progress-title">
            <h2 id="progress-title">Setup progress</h2>
            <Stages app={app} />
          </aside>
        )}
        <div className="application-details">
          {app.acceptance ? (
            <section className="application-agreement" aria-labelledby="accepted-agreement-title">
              <h2 id="accepted-agreement-title">Agreement</h2>
              <p className="muted">{app.acceptance.name} accepted the agreement on {formatDate(app.acceptance.at)}. <Link to={`${statusPath(orgId, appId)}/accepted-agreement`}>Read the agreement</Link>.{underway ? '' : ' We email the Owners when the status changes.'}</p>
            </section>
          ) : null}
          {accounts.map((provider) => (
            <div className="section" key={provider}>
              <fieldset className="application-account-controls" disabled={Boolean(connectionResults[provider]?.refreshError)}>
              <ConnectionPanel
                provider={provider}
                orgId={orgId}
                appId={appId}
                connections={app.connections}
                errors={provider === choice ? app.errors : {}}
                // Once the answers are frozen, only the account they chose can connect, and only to recover a failed build.
                canConnect={(app.connections.canChange && app.canEdit && (provider === choice || app.connections[provider].connected || app.connections[provider].unfinished)) || (canReconnect && provider === reconnectProvider)}
                connectLabel={provider === reconnectProvider && canReconnect ? 'Reconnect' : undefined}
                myRole={app.myRole}
                returnPath={statusPath(orgId, appId)}
                onConnections={() => refreshConnection(provider)}
                onNotice={(message) => setConnectionResults((current) => ({ ...current, [provider]: { kind: 'success', message } }))}
              />
              </fieldset>
              <ActionNotice result={connectionResults[provider]} onRefresh={() => refreshResult(provider)} refreshing={refreshing === provider} />
            </div>
          ))}
          {((app.canWithdraw && withdrawResult?.kind !== 'success') || withdrawResult) ? <div className="section">
            {app.canWithdraw && withdrawResult?.kind !== 'success' ? <Withdraw onWithdraw={withdraw} /> : null}
            <ActionNotice result={withdrawResult} onRefresh={() => refreshResult('withdraw')} refreshing={refreshing === 'withdraw'} focus />
          </div> : null}
        </div>
      </div>
    </section>
  );
}
