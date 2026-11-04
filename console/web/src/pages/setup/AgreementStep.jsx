import { useCallback, useEffect, useState } from 'react';
import { callApi } from '../../api.js';
import { SIGNUPS_CLOSED } from '../../setup/steps.js';
import { TextField } from '../../setup/Field.jsx';

/** Blank lines part the paragraphs. Each one renders as text, so nothing in it can run as HTML. */
function AgreementText({ agreement }) {
  return (
    <article className="agreement" aria-labelledby="agreement-title">
      <h2 id="agreement-title">{agreement.title}</h2>
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
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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
    setNameError('');
    setError('');
    setBusy(true);
    try {
      const result = await callApi('acceptAgreement', {
        orgId, appId, accept: true, name, version: data.agreement.version,
      });
      await onAccepted(result);
    } catch (err) {
      setBusy(false);
      if (err.field === 'name') {
        setNameError(err.message);
        return;
      }
      setError(err.message);
      // The agreement or the request changed: show what is true now.
      await load();
      await onRefresh().catch(() => {});
    }
  }

  if (!data) return error ? <p className="message error" role="alert">{error}</p> : <p role="status">Loading the agreement.</p>;

  const { agreement } = data;
  if (!agreement) return <p className="message error">{SIGNUPS_CLOSED}</p>;

  return (
    <div className="stack">
      <p className="lead">Read the agreement between your organization and the hosting team. When you accept it, we start building your site.</p>
      {error ? <p className="message error" role="alert">{error}</p> : null}
      <AgreementText agreement={agreement} />
      {app.canAccept ? (
        <form noValidate onSubmit={accept} className="stack">
          <TextField
            path="agreement.name"
            label="Your full name"
            hint="Typing your name and selecting Accept the agreement is your signature for your organization. We email you a copy."
            value={name}
            onChange={setName}
            error={nameError}
            autoComplete="name"
            maxLength={200}
          />
          <div><button type="submit" className="button primary" disabled={busy}>Accept the agreement</button></div>
        </form>
      ) : null}
      {!app.canAccept ? (
        <p className="muted">Only an Owner can accept the agreement. Ask an Owner on your team to open this step.</p>
      ) : null}
    </div>
  );
}
