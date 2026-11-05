import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { callApi } from '../../api.js';
import LoadingState from '../../LoadingState.jsx';
import { firstSettingError } from '../../reviewText.js';
import AgreementSettings from './AgreementSettings.jsx';
import HostingOnly, { isNotOperator } from './HostingOnly.jsx';
import SettingsFields from './SettingsFields.jsx';

const FIELDS = ['gcpFolder', 'billingAccount', 'region'];

/** The settings every build uses, and the agreement. Hosting team only. */
export default function ConsoleSettings() {
  const [values, setValues] = useState(null);
  const [saved, setSaved] = useState(null);
  const [agreement, setAgreement] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [fieldError, setFieldError] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const fieldRefs = useRef({});

  useEffect(() => {
    let live = true;
    callApi('getConsoleSettings', {})
      .then((body) => {
        if (!live) return;
        setValues(body.settings);
        setSaved(body.settings);
        setAgreement(body.agreement || null);
      })
      .catch((err) => { if (live) setLoadError(err); });
    return () => { live = false; };
  }, []);

  // Focus the field an error is about once it shows.
  useEffect(() => {
    if (fieldError) fieldRefs.current[fieldError.field]?.focus();
  }, [fieldError]);

  if (isNotOperator(loadError)) return <HostingOnly />;
  if (loadError) return <p className="message error" role="alert">{loadError.message}</p>;
  if (!values) return <LoadingState>Loading the settings.</LoadingState>;

  function change(field, value) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  async function onSubmit(event) {
    event.preventDefault();
    setNotice('');
    setError('');
    const invalid = firstSettingError(values, FIELDS);
    setFieldError(invalid);
    if (invalid) return;
    setBusy(true);
    try {
      const body = await callApi('saveConsoleSettings', { settings: values });
      setValues(body.settings);
      setSaved(body.settings);
      setNotice('The settings are saved. New builds use them.');
    } catch (err) {
      if (err.field && FIELDS.includes(err.field)) setFieldError({ field: err.field, message: err.message });
      else setError(err.message);
    }
    setBusy(false);
  }

  return (
    <section aria-labelledby="settings-title" className="narrow">
      <p className="folio">Hosting team</p>
      <h1 id="settings-title" tabIndex={-1}>Console settings</h1>
      {!agreement || !FIELDS.every((field) => saved?.[field]) ? (
        <aside className="note" role="note">
          <p className="note-title">Sign-ups are closed</p>
          <p>Signup links do not work until the Google Cloud folder, billing account, region and agreement are saved.</p>
        </aside>
      ) : null}
      <p>Every new build uses these values.</p>
      <div aria-live="polite" className="live">
        {notice ? <p className="message success">{notice}</p> : null}
      </div>
      {error ? <p className="message error" role="alert">{error}</p> : null}
      <form noValidate onSubmit={onSubmit} className="stack">
        <SettingsFields fields={FIELDS} values={values} onChange={change} error={fieldError} fieldRefs={fieldRefs} idPrefix="settings" />
        <button type="submit" className="button primary" disabled={busy}>Save settings</button>
      </form>
      <AgreementSettings agreement={agreement} onSaved={setAgreement} />
      <p><Link to="/review">Go to the review queue</Link></p>
    </section>
  );
}
