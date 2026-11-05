import { useCallback, useEffect, useRef, useState } from 'react';
import { callApi } from '../api.js';
import ActionFeedback from '../ActionFeedback.jsx';
import { formatDate, hostName } from '../text.js';
import { PROVIDER_COPY, canDisconnectWords, isProviderUrl, rememberConnectReturn } from './connections.js';
import { fieldId } from './Field.jsx';
import { leavePage } from './leavePage.js';
import LoadingState from '../LoadingState.jsx';

const NOT_SAVED = 'We could not save your last change. Try again.';
const CONNECTION_FIELD = 'tickets.connection';
const EVENT_FIELD = 'tickets.event';

/** The result of coming back from a provider's page, as the return page hands it over. */
export function ConnectionNotice({ message }) {
  if (!message) return null;
  if (message.kind === 'error') return <p className="message error" role="alert">{message.text}</p>;
  return <p className={message.kind === 'success' ? 'message success' : 'message'} role="status">{message.text}</p>;
}

/** Disconnect asks once, in place. Cancel returns the focus to Disconnect. */
function Disconnect({ name, warning, onDisconnect, disabled }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const button = useRef(null);
  if (!asking) {
    return <button type="button" className="button danger" ref={button} disabled={disabled} onClick={() => setAsking(true)}>Disconnect</button>;
  }
  return (
    <div className="confirm" role="group" aria-label={`Disconnect your ${name} account`}>
      <span>Disconnect your {name} account?{warning ? ` ${warning}` : ''}</span>
      <button
        type="button"
        className="button danger"
        disabled={busy || disabled}
        onClick={async () => {
          if (busy || disabled) return;
          setBusy(true);
          try { if (await onDisconnect()) setAsking(false); } finally { setBusy(false); }
        }}
      >
        {busy ? 'Disconnecting…' : 'Yes, disconnect'}
      </button>
      <button type="button" className="button" disabled={busy || disabled} autoFocus onClick={() => { setAsking(false); setTimeout(() => button.current?.focus(), 0); }}>
        Cancel
      </button>
    </div>
  );
}

/** The provider's side ended, or was kept because another event site uses the account. */
function disconnectedWords(name, { revoked, shared }, built) {
  if (revoked && built) return `You disconnected your ${name} account. Your site no longer sells paid tickets through it.`;
  if (revoked) return `You disconnected your ${name} account.`;
  if (shared) return `You disconnected your ${name} account from this request. Another event site still uses this account, so it stays connected there.`;
  return `You disconnected your ${name} account, and we deleted our access to it.`;
}

function eventLabel({ name, start }) {
  const date = start ? formatDate(start) : '';
  return date ? `${name}, ${date}` : name;
}

/** The client's Eventbrite events, to pick from. Nothing here is typed. */
function EventPicker({ orgId, appId, chosen, error, onConnections, disabled }) {
  const [events, setEvents] = useState(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const id = fieldId(EVENT_FIELD);

  const load = useCallback(async () => {
    setBusy(true);
    setProblem('');
    try {
      setEvents((await callApi('listEventbriteEvents', { orgId, appId })).events);
    } catch (err) {
      setProblem(err.message);
    }
    setBusy(false);
  }, [orgId, appId]);

  useEffect(() => { load(); }, [load]);

  async function choose(eventId) {
    if (!eventId || busy || disabled) return;
    setBusy(true);
    setProblem('');
    setNotice('');
    try {
      onConnections(await callApi('chooseEventbriteEvent', { orgId, appId, eventId }));
      setNotice('We saved your Eventbrite event.');
    } catch (err) {
      setProblem(err.message);
    }
    setBusy(false);
  }

  const again = <button type="button" className="button" disabled={busy} onClick={load}>Check again</button>;
  if (problem && !events) {
    return <div className="stack"><p className="message error" role="alert">{problem}</p><p>{again}</p></div>;
  }
  if (!events) return <LoadingState>Loading your Eventbrite events.</LoadingState>;
  if (events.length === 0 && !chosen) {
    return (
      <div className="stack">
        {error ? <p id={`${id}-error`} className="field-error">{error}</p> : null}
        <p>We did not find an upcoming event in your Eventbrite account. Make the event on Eventbrite, then check again.</p>
        <p>{again}</p>
      </div>
    );
  }
  // A chosen event stays in the list, even after it has started.
  const options = chosen && !events.some((event) => event.id === chosen.id) ? [chosen, ...events] : events;
  const describedBy = [`${id}-hint`, error ? `${id}-error` : null].filter(Boolean).join(' ');
  return (
    <div className="field">
      <label htmlFor={id}>Your Eventbrite event</label>
      <p id={`${id}-hint`} className="hint">Your site shows the tickets for this event.</p>
      <select
        id={id}
        name={EVENT_FIELD}
        value={chosen?.id || ''}
        disabled={busy || disabled}
        onChange={(e) => choose(e.target.value)}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy}
      >
        <option value="">Choose one</option>
        {options.map((event) => <option key={event.id} value={event.id}>{eventLabel(event)}</option>)}
      </select>
      {error ? <p id={`${id}-error`} className="field-error">{error}</p> : null}
      {problem ? <ActionFeedback kind="error" revealKey={problem}>{problem}</ActionFeedback> : null}
      {notice ? <ActionFeedback revealKey={notice}>{notice}</ActionFeedback> : null}
    </div>
  );
}

/**
 * One provider's account: connect it, see it, disconnect it, and for
 * Eventbrite pick the event. Used by the tickets step and the status page.
 *
 * `onConnections({ connections, errors })` gets the server's new state.
 * `beforeLeave` saves pending answers before the browser leaves for the
 * provider, and returns false when it could not. `returnPath` is where the
 * client comes back to. `connectLabel` names the connect button when the
 * button means something narrower than a first connection.
 */
export default function ConnectionPanel({
  provider, orgId, appId, connections, errors = {}, canConnect = connections.canChange, myRole,
  beforeLeave, returnPath, onConnections, onNotice, connectLabel, preserveResult = false, onResult,
}) {
  const copy = PROVIDER_COPY[provider];
  const account = connections[provider];
  const [error, setError] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [notice, setNotice] = useState('');
  const title = useRef(null);
  const connectError = errors[CONNECTION_FIELD];
  const connectErrorId = `${fieldId(CONNECTION_FIELD)}-error`;
  // A reconnect after the answers froze keeps the chosen event; it asks only when the new account lost it.
  const showPicker = canConnect && (connections.canChange || !account.event);
  const mayDisconnect = connections.canDisconnect || account.canEnd;
  let warning = '';
  if (connections.canChange) warning = 'If your ticket choice uses this account, you will need to connect one again or choose another way to run tickets before we can build your site.';
  if (connections.built) warning = `Your site stays online, but it stops selling paid tickets. Orders and attendees already in your site stay there, and you refund orders from your ${copy.name} account. To connect an account again, ask ${hostName()}.`;

  async function connect() {
    if (leaving || disconnecting) return;
    setError('');
    setNotice('');
    setLeaving(true);
    if (beforeLeave && !(await beforeLeave())) {
      setError(NOT_SAVED);
      setLeaving(false);
      return;
    }
    try {
      const { url } = await callApi('startConnection', { orgId, appId, provider });
      if (!isProviderUrl(url, provider)) throw new Error(`We could not open the ${copy.name} page. Try again.`);
      rememberConnectReturn(returnPath);
      leavePage(url);
    } catch (err) {
      setError(err.message);
      setLeaving(false);
    }
  }

  async function disconnect() {
    if (leaving || disconnecting) return false;
    setError('');
    setNotice('');
    setDisconnecting(true);
    try {
      const reply = await callApi('disconnectAccount', { orgId, appId, provider });
      if (preserveResult) onResult?.();
      onConnections(reply);
      const message = disconnectedWords(copy.name, reply, connections.built);
      if (preserveResult) setNotice(message);
      else onNotice?.(message);
      setTimeout(() => title.current?.focus(), 0);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <section className="note stack" aria-labelledby={`account-${provider}`}>
      <p className="note-title" id={`account-${provider}`} tabIndex={-1} ref={title}>Your {copy.name} account</p>

      {account.connected ? (
        <>
          <p>
            <strong>Connected: {account.displayName || copy.name}</strong>
            {account.connectedAt ? <span className="muted"> since {formatDate(account.connectedAt)}</span> : null}
          </p>
          {connections.canChange && connections.canDisconnect ? <p>{canDisconnectWords(provider)}</p> : null}
          {connections.built && provider === 'eventbrite' ? <p>To disconnect this account, ask {hostName()} to remove it from your site.</p> : null}
          {provider === 'eventbrite' && showPicker ? (
            <EventPicker
              orgId={orgId}
              appId={appId}
              chosen={account.event}
              error={errors[EVENT_FIELD]}
              onConnections={onConnections}
              disabled={leaving || disconnecting}
            />
          ) : null}
          {provider === 'eventbrite' && !showPicker ? (
            <p>Event: {account.event ? eventLabel(account.event) : <span className="muted">Not chosen yet</span>}</p>
          ) : null}
          {canConnect && copy.consent ? <p>{copy.consent}</p> : null}
          {canConnect || mayDisconnect ? (
            <div className="step-actions">
              {canConnect ? <button type="button" className="button" disabled={leaving || disconnecting} onClick={connect}>{leaving ? 'Opening account provider…' : connectLabel || 'Connect again'}</button> : null}
              {mayDisconnect ? <Disconnect name={copy.name} warning={warning} onDisconnect={disconnect} disabled={leaving} /> : null}
            </div>
          ) : null}
        </>
      ) : (
        <>
          {account.unfinished && mayDisconnect ? (
            <>
              <p>An earlier change to this account did not finish, so we may still have access to it. Disconnect to end that access.</p>
              <div className="step-actions"><Disconnect name={copy.name} warning={warning} onDisconnect={disconnect} disabled={leaving} /></div>
            </>
          ) : null}
          {connections.built ? (
            account.unfinished ? null : <p>No account is connected, so your site does not sell paid tickets or receive ticket updates through {copy.name}. To connect one, ask {hostName()}.</p>
          ) : account.available ? (
            <>
              <p>{copy.explain}</p>
              {canConnect && copy.consent ? <p>{copy.consent}</p> : null}
              {connectError ? <p id={connectErrorId} className="field-error">{connectError}</p> : null}
              {canConnect ? (
                <p>
                  <button
                    type="button"
                    className="button primary"
                    disabled={leaving || disconnecting}
                    data-group-error={connectError ? CONNECTION_FIELD : undefined}
                    aria-describedby={connectError ? connectErrorId : undefined}
                    onClick={connect}
                  >
                    {leaving ? 'Opening account provider…' : connectLabel || copy.button}
                  </button>
                </p>
              ) : null}
            </>
          ) : (
            <p>Connecting a {copy.name} account is not available yet. You can choose another way to run tickets, or come back later.</p>
          )}
        </>
      )}

      {error ? <ActionFeedback kind="error" revealKey={error}>{error}</ActionFeedback> : null}
      {notice ? <ActionFeedback revealKey={notice}>{notice}</ActionFeedback> : null}

      {myRole !== 'owner' && !canConnect && !mayDisconnect ? (
        <p className="muted">Only an Owner can change this account.</p>
      ) : null}
    </section>
  );
}
