import { useEffect, useRef, useState } from 'react';
import { callApi } from '../../api.js';
import { SETTING_FIELDS, firstSettingError } from '../../reviewText.js';
import { formatFee } from '../../text.js';
import SettingsFields from './SettingsFields.jsx';

const FIELDS = ['feeAmount', 'feeCurrency'];

/** The event fee clients pay. It is read only from the stored settings. */
export default function FeeSettings({ fee, onSaved }) {
  const [values, setValues] = useState({ feeAmount: fee ? String(fee.amount) : '', feeCurrency: fee?.currency || '' });
  const [fieldError, setFieldError] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const fieldRefs = useRef({});

  useEffect(() => {
    if (fieldError) fieldRefs.current[fieldError.field]?.focus();
  }, [fieldError]);

  const valid = FIELDS.every((field) => SETTING_FIELDS[field].valid(values[field]));
  const preview = valid ? formatFee({ amount: Number(values.feeAmount), currency: values.feeCurrency }) : '';

  async function onSubmit(event) {
    event.preventDefault();
    setNotice('');
    setError('');
    const invalid = firstSettingError(values, FIELDS);
    setFieldError(invalid);
    if (invalid) return;
    setBusy(true);
    try {
      const body = await callApi('saveEventFee', { fee: { amount: Number(values.feeAmount), currency: values.feeCurrency.trim() } });
      setValues({ feeAmount: String(body.fee.amount), feeCurrency: body.fee.currency });
      onSaved(body.fee);
      setNotice('The fee is saved. New payment pages use it.');
    } catch (err) {
      if (FIELDS.includes(err.field)) setFieldError({ field: err.field, message: err.message });
      else setError(err.message);
    }
    setBusy(false);
  }

  return (
    <section aria-labelledby="fee-title" className="section">
      <h2 id="fee-title">Event fee</h2>
      <div aria-live="polite" className="live">
        {notice ? <p className="message success">{notice}</p> : null}
      </div>
      {error ? <p className="message error" role="alert">{error}</p> : null}
      <form noValidate onSubmit={onSubmit} className="stack">
        <SettingsFields
          fields={FIELDS}
          values={values}
          onChange={(field, value) => setValues((current) => ({ ...current, [field]: value }))}
          error={fieldError}
          fieldRefs={fieldRefs}
          idPrefix="fee"
        />
        {preview ? <p className="muted">Clients pay {preview}.</p> : null}
        <div><button type="submit" className="button primary" disabled={busy}>Save the fee</button></div>
      </form>
    </section>
  );
}
