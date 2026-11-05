import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { callApi } from '../../api.js';
import ActionFeedback, { ActionResult } from '../../ActionFeedback.jsx';
import { LINK_STATUS_LABELS, formatDateTime } from '../../reviewText.js';
import { ORGANIZATION_NAME_ERROR, cleanOrganizationName, formatDate } from '../../text.js';
import HostingOnly, { isNotOperator } from './HostingOnly.jsx';

/** The new link. The server gives it once, so it lives only in this page's memory. */
function NewLink({ created }) {
  const [copied, setCopied] = useState(null);
  const title = useRef(null);

  useEffect(() => { title.current?.focus(); }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(created.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="note stack" aria-labelledby="new-link-title">
      <p className="note-title" id="new-link-title" tabIndex={-1} ref={title}>The link for {created.link.organizationName}</p>
      <p>Copy it now and send it to the client. We will not show it again. It works once and expires on {formatDate(created.link.expiresAt)}.</p>
      <div className="field">
        <label htmlFor="new-link-url">Signup link</label>
        <input id="new-link-url" type="text" readOnly value={created.url} onFocus={(e) => e.target.select()} />
      </div>
      <div><button type="button" className="button primary" onClick={copy}>Copy</button></div>
      <p role="status">
        {copied === true ? 'Copied.' : null}
        {copied === false ? 'We could not copy the link. Select it and copy it yourself.' : null}
      </p>
    </section>
  );
}

/** Revoke asks once, in place. Cancel returns the focus to Revoke. */
function Revoke({ name, onRevoke, disabled }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const button = useRef(null);
  if (!asking) {
    return <button type="button" className="button danger" ref={button} disabled={disabled} title={`Revoke the link for ${name}`} onClick={() => setAsking(true)}>Revoke</button>;
  }
  return (
    <div className="confirm" role="group" aria-label={`Revoke the link for ${name}`}>
      <span>Revoke this link? It stops working, and you cannot undo this.</span>
      <button type="button" className="button danger" disabled={busy || disabled}
        onClick={async () => {
          if (busy || disabled) return;
          setBusy(true);
          try { if (await onRevoke()) setAsking(false); } finally { setBusy(false); }
        }}>
        {busy ? 'Revoking…' : 'Yes, revoke'}
      </button>
      <button type="button" className="button" autoFocus disabled={busy || disabled} onClick={() => { setAsking(false); setTimeout(() => button.current?.focus(), 0); }}>
        Cancel
      </button>
    </div>
  );
}

/** Signup links: one per client whose invoice is paid. Hosting team only. */
export default function SignupLinks() {
  const [links, setLinks] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [created, setCreated] = useState(null);
  const [name, setName] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState('');
  const [results, setResults] = useState({});
  const [refreshing, setRefreshing] = useState('');
  const fieldRef = useRef(null);
  const resultRefs = useRef({});

  useEffect(() => {
    if (fieldError && !busy) fieldRef.current?.focus();
  }, [fieldError, busy]);

  const load = useCallback(async () => {
    try {
      setLinks((await callApi('listSignupLinks', {})).links);
      setLoadError(null);
      return '';
    } catch (err) {
      setLoadError(err);
      return err.message;
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function onSubmit(event) {
    event.preventDefault();
    if (busy || pending) return;
    setError(null);
    const clean = cleanOrganizationName(name);
    if (!clean) {
      setFieldError(ORGANIZATION_NAME_ERROR);
      fieldRef.current?.focus();
      return;
    }
    setFieldError('');
    setBusy(true);
    try {
      const body = await callApi('createSignupLink', { organizationName: clean });
      setCreated(body);
      setName('');
      await load();
    } catch (err) {
      if (err.field === 'organizationName') {
        setFieldError(err.message);
      } else setError(err);
    }
    setBusy(false);
  }

  async function revoke(link) {
    if (busy || pending) return false;
    setPending(link.id);
    setResults((current) => ({ ...current, [link.id]: null }));
    try {
      await callApi('revokeSignupLink', { linkId: link.id });
      if (created?.link.id === link.id) setCreated(null);
      // The server confirmed revocation. A failed read must not offer it again.
      setLinks((current) => current.map((item) => item.id === link.id ? { ...item, status: 'revoked' } : item));
      const problem = await load();
      setResults((current) => ({ ...current, [link.id]: { kind: 'success', message: `You revoked the link for ${link.organizationName}.`,
        refreshError: problem ? `The link is revoked, but we could not refresh the list. ${problem}` : '' } }));
      setTimeout(() => resultRefs.current[link.id]?.current?.focus(), 0);
      return true;
    } catch (err) {
      setResults((current) => ({ ...current, [link.id]: { kind: 'error', message: err.message } }));
      return false;
    } finally {
      setPending('');
    }
  }

  async function refreshLink(id) {
    setRefreshing(id);
    const problem = await load();
    setResults((current) => ({ ...current, [id]: { ...current[id], refreshError: problem ? `We could not refresh the list. ${problem}` : '' } }));
    setRefreshing('');
  }

  if (isNotOperator(loadError)) return <HostingOnly />;

  return (
    <section aria-labelledby="links-title">
      <p className="folio">Hosting team</p>
      <h1 id="links-title" tabIndex={-1}>Signup links</h1>
      <p>Create a link once the client's invoice is paid. The client signs in, enters their details and accepts the agreement, and the build starts. Anyone who holds the link can use it, once, for 30 days.</p>

      <form noValidate onSubmit={onSubmit} className="stack section">
        <div className="field">
          <label htmlFor="link-org-name">Organization name</label>
          <p id="link-org-name-hint" className="hint">The client can change it when they open the link.</p>
          <input
            id="link-org-name"
            ref={fieldRef}
            type="text"
            autoComplete="off"
            maxLength={120}
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={fieldError ? 'true' : undefined}
            aria-describedby={['link-org-name-hint', fieldError ? 'link-org-name-error' : null].filter(Boolean).join(' ')}
          />
          {fieldError ? <p id="link-org-name-error" className="field-error">{fieldError}</p> : null}
        </div>
        <div><button type="submit" className="button primary" disabled={busy || Boolean(pending)}>{busy ? 'Creating link…' : 'Create the link'}</button></div>
        {error ? <ActionFeedback kind="error" revealKey={error.message}>
          {error.message}
          {error.code === 'signups-closed' ? <> <Link to="/review/settings">Open the console settings</Link></> : null}
        </ActionFeedback> : null}
      </form>

      {created ? <NewLink key={created.link.id} created={created} /> : null}

      <h2 id="links-list-title" tabIndex={-1} className="section">Links</h2>
      {loadError && !Object.values(results).some((result) => result?.refreshError) ? <ActionFeedback kind="error">
        <p>{loadError.message}</p><button type="button" className="button" onClick={load}>Refresh links</button>
      </ActionFeedback> : null}
      {!links && !loadError ? <p role="status">Loading the links.</p> : null}
      {links && links.length === 0 ? <p>No links yet.</p> : null}
      {links && links.length > 0 ? (
        <ul className="cards" aria-labelledby="links-list-title">
          {links.map((link) => (
            <li key={link.id} className="card console-feedback-row" aria-label={link.organizationName}>
              <span className="card-title">{link.organizationName}</span>
              <span className="tag">{LINK_STATUS_LABELS[link.status] || link.status}</span>
              <span className="muted">Created {formatDate(link.createdAt)}</span>
              {link.status === 'open' ? <span className="muted">Expires {formatDate(link.expiresAt)}</span> : null}
              {link.status === 'used' ? <span className="muted break">Used by {link.usedEmail}, {formatDateTime(link.usedAt)}</span> : null}
              {link.appId ? <Link to={`/review/${link.appId}`}>Open the request</Link> : null}
              {link.status === 'open' ? <Revoke name={link.organizationName} onRevoke={() => revoke(link)} disabled={busy || Boolean(pending)} /> : null}
              <ActionResult result={results[link.id]} focusRef={resultRefs.current[link.id] ||= { current: null }}
                onRefresh={() => refreshLink(link.id)} refreshing={refreshing === link.id} refreshLabel="Refresh links" />
            </li>
          ))}
        </ul>
      ) : null}

      <p className="section"><Link to="/review">Go to the review queue</Link></p>
    </section>
  );
}
