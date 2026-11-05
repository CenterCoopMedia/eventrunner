import { useEffect, useId, useRef, useState } from 'react';
import { callApi } from './api.js';
import { recentMessages } from './recentMessages.js';

const KINDS = [
  { value: 'bug', label: 'Something is broken' },
  { value: 'suggestion', label: 'An idea or a change' },
  { value: 'question', label: 'A question' },
];

/** "Report a problem": a short form that goes straight to the hosting team. */
export default function ReportProblem() {
  const dialog = useRef(null);
  const field = useRef(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState('bug');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) {
      if (typeof node.showModal === 'function') node.showModal();
      else node.setAttribute('open', '');
      field.current?.focus();
    } else if (!open && node.open) {
      if (typeof node.close === 'function') node.close();
      else node.removeAttribute('open');
    }
  }, [open]);

  function start() {
    setKind('bug');
    setDescription('');
    setError(null);
    setSent(false);
    setOpen(true);
  }

  async function send(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await callApi('reportProblem', {
        category: kind,
        description,
        url: window.location.href,
        surface: 'console',
        site: '',
        version: import.meta.env.VITE_BUILD_ID || '',
        consoleLogs: recentMessages(),
      });
      setSent(true);
    } catch (err) {
      setError({ message: err.message, field: err.field });
    } finally {
      setBusy(false);
    }
  }

  const descriptionError = error?.field === 'description' ? error.message : null;
  return (
    <>
      <button type="button" className="button quiet" onClick={start}>Report a problem</button>
      <dialog ref={dialog} className="report-dialog" aria-labelledby={`${id}-title`} onClose={() => setOpen(false)}>
        <h2 id={`${id}-title`}>Report a problem</h2>
        {sent ? (
          <>
            <p className="message success" role="status">Thanks. The hosting team has your report and will follow up by email.</p>
            <div className="report-actions">
              <button type="button" className="button primary" onClick={() => setOpen(false)}>Close</button>
            </div>
          </>
        ) : (
          <form onSubmit={send} noValidate>
            <p className="muted">Tell us what happened and what you expected. We include this page’s address and recent error messages so we can find the problem.</p>
            <fieldset className="choices" disabled={busy}>
              <legend>What is it?</legend>
              {KINDS.map((option) => (
                <label key={option.value} className="choice">
                  <input type="radio" name={`${id}-kind`} value={option.value} checked={kind === option.value} onChange={() => setKind(option.value)} />
                  <span>{option.label}</span>
                </label>
              ))}
            </fieldset>
            <div className="field">
              <label htmlFor={`${id}-description`}>What happened?</label>
              <textarea
                id={`${id}-description`}
                ref={field}
                value={description}
                maxLength={4000}
                disabled={busy}
                aria-invalid={descriptionError ? 'true' : undefined}
                aria-describedby={descriptionError ? `${id}-description-error` : undefined}
                onChange={(event) => setDescription(event.target.value)}
              />
              {descriptionError ? <p id={`${id}-description-error`} className="field-error">{descriptionError}</p> : null}
            </div>
            {error && !descriptionError ? <p className="message error" role="alert">{error.message}</p> : null}
            <div className="report-actions">
              <button type="submit" className="button primary" disabled={busy}>{busy ? 'Sending report…' : 'Send report'}</button>
              <button type="button" className="button" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
