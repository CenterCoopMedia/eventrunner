import { useRef, useState } from 'react';
import { NOTE_MAX } from '../../reviewText.js';

/**
 * A decision that needs a note to the client. The note goes in the email
 * to the Owners and in the history.
 */
export default function NoteForm({ id, title, help, submitLabel, danger = false, onSubmit, onCancel }) {
  const [note, setNote] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [busy, setBusy] = useState(false);
  const fieldRef = useRef(null);
  const fieldId = `${id}-note`;

  async function submit(event) {
    event.preventDefault();
    const text = note.trim();
    let problem = '';
    if (!text) problem = 'Write a note to the client.';
    else if (text.length > NOTE_MAX) problem = `Shorten the note to ${NOTE_MAX.toLocaleString('en-US')} characters or fewer.`;
    setFieldError(problem);
    if (problem) {
      fieldRef.current?.focus();
      return;
    }
    setBusy(true);
    const done = await onSubmit(text);
    if (!done) setBusy(false);
  }

  return (
    <form noValidate onSubmit={submit} className="stack decision" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>{title}</h3>
      <div className="field">
        <label htmlFor={fieldId}>Note to the client</label>
        <p id={`${fieldId}-hint`} className="hint">{help} Up to {NOTE_MAX.toLocaleString('en-US')} characters.</p>
        <textarea
          id={fieldId}
          ref={fieldRef}
          rows={5}
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          aria-invalid={fieldError ? 'true' : undefined}
          aria-describedby={[`${fieldId}-hint`, fieldError ? `${fieldId}-error` : null].filter(Boolean).join(' ')}
        />
        {fieldError ? <p id={`${fieldId}-error`} className="field-error">{fieldError}</p> : null}
      </div>
      <div className="row-actions">
        <button type="submit" className={`button ${danger ? 'danger' : 'primary'}`} disabled={busy}>{submitLabel}</button>
        <button type="button" className="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
