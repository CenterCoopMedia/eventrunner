import { useEffect, useState } from 'react';
import ActionFeedback from '../../ActionFeedback.jsx';
import { callApi } from '../../api.js';
import { TextField } from '../../setup/Field.jsx';
import { formatDateTime } from '../../reviewText.js';

const TITLE_MAX = 200;
const BODY_MAX = 200000;

/** The agreement clients accept. Each changed text saves as a new version, and a saved version never changes. */
export default function AgreementSettings({ agreement, onSaved }) {
  const [title, setTitle] = useState(agreement?.title || '');
  const [body, setBody] = useState(agreement?.body || '');
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const first = Object.keys(errors)[0];
    if (first && !busy) document.getElementsByName(first)[0]?.focus();
  }, [errors, busy]);

  async function onSubmit(event) {
    event.preventDefault();
    if (busy) return;
    setNotice('');
    setError('');
    setErrors({});
    setBusy(true);
    try {
      const result = await callApi('saveAgreement', { agreement: { title, body } });
      setTitle(result.agreement.title);
      setBody(result.agreement.body);
      onSaved(result.agreement);
      setNotice(result.created
        ? `Version ${result.agreement.version} is saved. New acceptances use it.`
        : `This is the same text as version ${result.agreement.version}, so nothing changed.`);
    } catch (err) {
      if (err.field) {
        setErrors({ [err.field]: err.message });
      } else setError(err.message);
    }
    setBusy(false);
  }

  return (
    <section aria-labelledby="agreement-settings-title" className="section">
      <h2 id="agreement-settings-title">Agreement</h2>
      <p>
        {agreement ? `The current text is version ${agreement.version}, saved ${formatDateTime(agreement.savedAt)}. ` : 'No agreement is saved. '}
        Saving a changed text makes a new version. A saved version never changes, and a client who accepted one keeps it.
      </p>
      <form noValidate onSubmit={onSubmit} className="stack">
        <fieldset className="console-feedback-fields stack" disabled={busy}>
        <TextField path="agreementTitle" label="Title" value={title} onChange={(value) => { setTitle(value); setNotice(''); }} error={errors.agreementTitle} maxLength={TITLE_MAX} />
        <TextField
          path="agreementBody"
          label="Text"
          hint="Plain text. A blank line starts a new paragraph."
          value={body}
          onChange={(value) => { setBody(value); setNotice(''); }}
          error={errors.agreementBody}
          multiline
          maxLength={BODY_MAX}
          className="agreement-text-field"
        />
        <div><button type="submit" className="button primary" disabled={busy}>{busy ? 'Saving agreement…' : 'Save as a new version'}</button></div>
        </fieldset>
        {notice ? <ActionFeedback revealKey={notice}>{notice}</ActionFeedback> : null}
        {error ? <ActionFeedback kind="error" revealKey={error}>{error}</ActionFeedback> : null}
      </form>
    </section>
  );
}
