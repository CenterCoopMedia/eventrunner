import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { callApi } from '../../api.js';
import LoadingState from '../../LoadingState.jsx';
import IconControl from '../../IconControl.jsx';
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
  const [refreshKey, setRefreshKey] = useState(0);
  const [fieldError, setFieldError] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const fieldRefs = useRef({});
  const resultRef = useRef(null);

  useEffect(() => {
    let live = true;
    setLoadError(null);
    callApi('getConsoleSettings', {})
      .then((body) => {
        if (!live) return;
        setValues(body.settings);
        setSaved(body.settings);
        setAgreement(body.agreement || null);
      })
      .catch((err) => { if (live) setLoadError(err); });
    return () => { live = false; };
  }, [refreshKey]);

  // Focus the field an error is about once it shows.
  useEffect(() => {
    if (fieldError && !busy) fieldRefs.current[fieldError.field]?.focus();
  }, [fieldError, busy]);

  useEffect(() => {
    if (!resultRef.current || (!notice && !error)) return;
    const box = resultRef.current.getBoundingClientRect();
    if (box.top < 0 || box.bottom > window.innerHeight) resultRef.current.scrollIntoView?.({ block: 'nearest' });
  }, [notice, error]);

  if (isNotOperator(loadError)) return <HostingOnly />;
  if (loadError) return <div className="stack"><p className="message error" role="alert">{loadError.message}</p><IconControl icon="refresh" label="Refresh settings" onClick={() => setRefreshKey((value) => value + 1)} /></div>;
  if (!values) return <LoadingState>Loading the settings.</LoadingState>;

  function change(field, value) {
    setValues((current) => ({ ...current, [field]: value }));
    setNotice('');
    setError('');
    setFieldError((current) => current?.field === field ? null : current);
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (busy) return;
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
      setNotice('Settings saved. New sites will use them.');
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
          <p>Save hosting settings and an agreement to open sign-ups.</p>
        </aside>
      ) : null}
      <p>Choose the hosting settings for new sites.</p>
      <form noValidate onSubmit={onSubmit} className="stack">
        <SettingsFields fields={FIELDS} values={values} onChange={change} error={fieldError} fieldRefs={fieldRefs} idPrefix="settings" disabled={busy} />
        <button type="submit" className="button primary" aria-label="Save settings" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        {notice ? <p className="message success" role="status" ref={resultRef}>{notice}</p> : null}
        {error ? <p className="message error" role="alert" ref={resultRef}>{error}</p> : null}
      </form>
      <AgreementSettings agreement={agreement} onSaved={setAgreement} />
      <p><Link to="/review">Go to the review queue</Link></p>
    </section>
  );
}
