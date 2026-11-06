import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { callApi } from '../api.js';
import { useAuth } from '../auth.jsx';
import { STEPS, setupPath, statusPath } from '../setup/steps.js';
import { ORGANIZATION_NAME_ERROR, cleanOrganizationName } from '../text.js';
import { tokenFrom } from './AcceptInvite.jsx';
import { browserTimeZone } from './setup/EventStep.jsx';
import LoadingState from '../LoadingState.jsx';

/** Refusals about the link itself. Trying again cannot help; the message says to ask for a new one. */
const LINK_REFUSALS = ['link-invalid', 'link-used', 'link-revoked', 'link-expired'];

function Panel({ children }) {
  return (
    <section className="panel narrow" aria-labelledby="start-title">
      <h1 id="start-title" tabIndex={-1}>Start your event site</h1>
      {children}
    </section>
  );
}

/** /start/:linkId#token=… : the page a signup link opens. */
export default function StartEvent() {
  const { linkId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const auth = useAuth();
  const [token] = useState(() => tokenFrom(location.hash));
  const [link, setLink] = useState(null);
  const [refusal, setRefusal] = useState(null);
  const [name, setName] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fieldRef = useRef(null);

  const load = useCallback(async () => {
    setRefusal(null);
    try {
      const body = await callApi('getSignupLink', { linkId, token });
      setLink(body);
      setName(body.organizationName || '');
    } catch (err) {
      setRefusal({ code: err.code, message: err.message });
    }
  }, [linkId, token]);

  useEffect(() => {
    if (token) load();
  }, [token, load]);

  async function onSubmit(event) {
    event.preventDefault();
    if (busy) return;
    const clean = cleanOrganizationName(name);
    if (!clean) {
      setFieldError(ORGANIZATION_NAME_ERROR);
      fieldRef.current?.focus();
      return;
    }
    setFieldError('');
    setError('');
    setBusy(true);
    try {
      const { orgId, appId } = await callApi('redeemSignupLink', { linkId, token, organizationName: clean, timezone: browserTimeZone() });
      navigate(setupPath(orgId, appId, STEPS[0]), { replace: true });
    } catch (err) {
      setBusy(false);
      if (LINK_REFUSALS.includes(err.code)) setRefusal({ code: err.code, message: err.message });
      else if (err.field === 'organizationName') {
        setFieldError(err.message);
        fieldRef.current?.focus();
      } else setError(err.message);
    }
  }

  if (!token) {
    return (
      <Panel>
        <p className="message error" role="alert">You are signed in. Open the signup link in your email again to continue.</p>
      </Panel>
    );
  }

  if (refusal) {
    return (
      <Panel>
        <p>You are signed in as {auth.user?.email}.</p>
        <div className="stack">
          <p className="message error" role="alert">{refusal.message}</p>
          {refusal.code === 'link-used' ? (
            <div><button type="button" className="button" onClick={() => auth.signOut()}>Sign out</button></div>
          ) : null}
          {LINK_REFUSALS.includes(refusal.code) ? null : (
            <div><button type="button" className="button" onClick={load}>Try again</button></div>
          )}
        </div>
      </Panel>
    );
  }

  if (!link) return <LoadingState long>Checking your signup link.</LoadingState>;
  if (link.status === 'used') return <Navigate to={statusPath(link.orgId, link.appId)} replace />;

  return (
    <Panel>
      <p className="lead">Set up an event site for your organization.</p>
      {error ? <p className="message error" role="alert">{error}</p> : null}
      <form noValidate onSubmit={onSubmit} className="stack">
        <div className="field">
          <label htmlFor="start-org-name">Organization name</label>
          <p id="start-org-name-hint" className="hint">Use the name your audience knows.</p>
          <input
            id="start-org-name"
            ref={fieldRef}
            type="text"
            autoComplete="organization"
            maxLength={120}
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={fieldError ? 'true' : undefined}
            aria-describedby={['start-org-name-hint', fieldError ? 'start-org-name-error' : null].filter(Boolean).join(' ')}
          />
          {fieldError ? <p id="start-org-name-error" className="field-error">{fieldError}</p> : null}
        </div>
        <div><button type="submit" className="button primary" disabled={busy}>{busy ? 'Starting…' : 'Start'}</button></div>
      </form>
    </Panel>
  );
}
