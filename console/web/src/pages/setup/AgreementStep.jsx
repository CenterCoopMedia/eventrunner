import { useCallback, useEffect, useState } from 'react';
import { callApi } from '../../api.js';
import ActionFeedback from '../../ActionFeedback.jsx';
import { SIGNUPS_CLOSED } from '../../setup/steps.js';
import { fieldId, TextField } from '../../setup/Field.jsx';
import LoadingState from '../../LoadingState.jsx';

/** Blank lines part the paragraphs. Each one renders as text, so nothing in it can run as HTML. */
export function AgreementText({ agreement }) {
  return (
    <article className="agreement" aria-labelledby="agreement-title">
      <h2 id="agreement-title" tabIndex={-1}>{agreement.title}</h2>
      <p className="muted">Version {agreement.version}</p>
      {agreement.body.split(/\n\s*\n/).map((paragraph, i) => <p className="pre" key={i}>{paragraph}</p>)}
    </article>
  );
}

/**
 * The full current agreement. An Owner types a name and accepts the version
 * this page shows, which starts the build.
 */
export default function AgreementStep({ app, orgId, appId, onAccepted, onRefresh }) {
  const [data, setData] = useState(null);
  const [signer, setSigner] = useState({ name: '', legalName: '', title: '' });
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    const first = Object.keys(fieldErrors)[0];
    if (first && !busy) document.getElementById(fieldId(`agreement.${first}`))?.focus();
  }, [fieldErrors, busy]);

  const load = useCallback(async () => {
    try {
      setData(await callApi('getAgreement', { orgId, appId }));
    } catch (err) {
      setError(err.message);
    }
  }, [orgId, appId]);

  useEffect(() => {
    load();
  }, [load]);

  async function accept(event) {
    event.preventDefault();
    if (busy) return;
    setFieldErrors({});
    setError('');
    setChanged(false);
    setBusy(true);
    try {
      const result = await callApi('acceptAgreement', {
        orgId, appId, accept: true, ...signer, version: data.agreement.version,
      });
      await onAccepted(result);
    } catch (err) {
      if (err.field in signer) {
        setFieldErrors({ [err.field]: err.message });
        return;
      }
      setError(err.message);
      setChanged(err.code === 'agreement-changed');
      // The agreement or the request changed: show what is true now.
      await load();
      await onRefresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  if (!data) return error ? <p className="message error" role="alert">{error}</p> : <LoadingState>Loading the agreement.</LoadingState>;

  const { agreement } = data;
  if (!agreement) return <p className="message error">{SIGNUPS_CLOSED}</p>;

  return (
    <div className="stack">
      <p className="lead">Read the agreement between your organization and the hosting team. When you accept it, we start building your site. You do not need to wait on the page: we email you when the site is ready.</p>
      <AgreementText agreement={agreement} />
      {app.canAccept ? (
        <form noValidate onSubmit={accept} className="stack">
          <fieldset className="console-feedback-fields stack" disabled={busy}>
          <TextField
            path="agreement.legalName"
            label="Your organization's legal name"
            hint="The name on your contracts. This organization is the party to the agreement."
            value={signer.legalName}
            onChange={(legalName) => setSigner((prev) => ({ ...prev, legalName }))}
            error={fieldErrors.legalName}
            autoComplete="organization"
            maxLength={200}
          />
          <TextField
            path="agreement.title"
            label="Your job title"
            value={signer.title}
            onChange={(title) => setSigner((prev) => ({ ...prev, title }))}
            error={fieldErrors.title}
            autoComplete="organization-title"
            maxLength={200}
          />
          <TextField
            path="agreement.name"
            label="Your full name"
            hint="Typing your name and selecting Accept the agreement is your signature for your organization. We email you a copy."
            value={signer.name}
            onChange={(name) => setSigner((prev) => ({ ...prev, name }))}
            error={fieldErrors.name}
            autoComplete="name"
            maxLength={200}
          />
          <div><button type="submit" className="button primary" disabled={busy}>{busy ? 'Starting the build' : 'Accept the agreement'}</button></div>
          </fieldset>
          {error ? <ActionFeedback kind="error" revealKey={error}>
            <p>{error}</p>
            {changed ? <button type="button" className="button" onClick={() => document.getElementById('agreement-title')?.focus()}>Read the updated agreement</button> : null}
          </ActionFeedback> : null}
        </form>
      ) : null}
      {!app.canAccept ? (
        <>
          {error ? <ActionFeedback kind="error" revealKey={error}>{error}</ActionFeedback> : null}
          <p className="muted">Only an Owner can accept the agreement. Ask an Owner on your team to open this step.</p>
        </>
      ) : null}
    </div>
  );
}
