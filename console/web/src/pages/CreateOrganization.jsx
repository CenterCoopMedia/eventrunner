import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { callApi } from '../api.js';

const NAME_MIN = 2;
const NAME_MAX = 100;

export default function CreateOrganization() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fieldRef = useRef(null);

  async function onSubmit(event) {
    event.preventDefault();
    const clean = name.trim().replace(/\s+/g, ' ');
    if (clean.length < NAME_MIN || clean.length > NAME_MAX) {
      setFieldError(`Enter a name of ${NAME_MIN} to ${NAME_MAX} characters.`);
      fieldRef.current?.focus();
      return;
    }
    setFieldError('');
    setError('');
    setBusy(true);
    try {
      const { organization } = await callApi('createOrganization', { name: clean });
      navigate(`/organizations/${organization.id}/team`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <section className="panel narrow" aria-labelledby="create-title">
      <h1 id="create-title" tabIndex={-1}>Name your organization</h1>
      <p className="lead">Use the name your audience knows. One organization can run more than one event.</p>
      {error ? <p className="message error" role="alert">{error}</p> : null}
      <form noValidate onSubmit={onSubmit} className="stack">
        <div className="field">
          <label htmlFor="org-name">Organization name</label>
          <input
            id="org-name"
            ref={fieldRef}
            type="text"
            autoComplete="organization"
            maxLength={NAME_MAX + 20}
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={fieldError ? 'true' : undefined}
            aria-describedby={fieldError ? 'org-name-error' : undefined}
          />
          {fieldError ? <p id="org-name-error" className="field-error">{fieldError}</p> : null}
        </div>
        <button type="submit" className="button primary" disabled={busy}>Create organization</button>
      </form>
    </section>
  );
}
