import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { callApi } from '../../api.js';
import { firstSettingError } from '../../reviewText.js';
import AgreementSettings from './AgreementSettings.jsx';
import FeeSettings from './FeeSettings.jsx';
import HostingOnly, { isNotOperator } from './HostingOnly.jsx';
import SettingsFields from './SettingsFields.jsx';

const FIELDS = ['gcpFolder', 'billingAccount', 'region'];

/** The defaults every approval starts from, the event fee and the agreement. Hosting team only. */
export default function ConsoleSettings() {
  const [values, setValues] = useState(null);
  const [fee, setFee] = useState(null);
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
        setFee(body.fee || null);
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
  if (!values) return <p role="status">Loading the settings.</p>;

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
      setNotice('The settings are saved. New approvals use them.');
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
      {!fee || !agreement ? (
        <aside className="note" role="note">
          <p className="note-title">Sign-ups are closed</p>
          <p>Clients cannot move past Review until both the event fee and the agreement are saved.</p>
        </aside>
      ) : null}
      <p>Each approval starts from these values. You can change them on each request before you approve it.</p>
      <div aria-live="polite" className="live">
        {notice ? <p className="message success">{notice}</p> : null}
      </div>
      {error ? <p className="message error" role="alert">{error}</p> : null}
      <form noValidate onSubmit={onSubmit} className="stack">
        <SettingsFields fields={FIELDS} values={values} onChange={change} error={fieldError} fieldRefs={fieldRefs} idPrefix="settings" />
        <button type="submit" className="button primary" disabled={busy}>Save settings</button>
      </form>
      <FeeSettings fee={fee} onSaved={setFee} />
      <AgreementSettings agreement={agreement} onSaved={setAgreement} />
      <p><Link to="/review">Go to the review queue</Link></p>
    </section>
  );
}
