import { useEffect, useRef, useState } from 'react';
import { firstSettingError } from '../../reviewText.js';
import SettingsFields from './SettingsFields.jsx';

const FIELDS = ['gcpFolder', 'billingAccount', 'region', 'projectId', 'environment'];

/**
 * Approve with the build settings. Each value starts from the console
 * settings or the web-address name, and the operator can change it.
 * Approval records the settings; the build is a later step.
 */
export default function ApproveForm({ defaults, onSubmit, onCancel }) {
  const [values, setValues] = useState(() => ({ ...defaults }));
  const [fieldError, setFieldError] = useState(null);
  const [busy, setBusy] = useState(false);
  const fieldRefs = useRef({});

  // The form opens with the focus on its first field.
  useEffect(() => {
    fieldRefs.current[FIELDS[0]]?.focus();
  }, []);

  useEffect(() => {
    if (fieldError) fieldRefs.current[fieldError.field]?.focus();
  }, [fieldError]);

  async function submit(event) {
    event.preventDefault();
    const invalid = firstSettingError(values, FIELDS);
    setFieldError(invalid);
    if (invalid) return;
    setBusy(true);
    const result = await onSubmit(values);
    if (result !== true) {
      setBusy(false);
      if (result?.field && FIELDS.includes(result.field)) setFieldError(result);
    }
  }

  return (
    <form noValidate onSubmit={submit} className="stack decision" aria-labelledby="approve-title">
      <h3 id="approve-title" tabIndex={-1}>Approve this request</h3>
      <p>Approval records these settings and emails the Owners: “We are building your site”. Check each value. The values come from the console settings and the web address.</p>
      <SettingsFields fields={FIELDS} values={values} onChange={(field, value) => setValues((v) => ({ ...v, [field]: value }))} error={fieldError} fieldRefs={fieldRefs} idPrefix="approve" />
      <div className="row-actions">
        <button type="submit" className="button primary" disabled={busy}>Approve</button>
        <button type="button" className="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
