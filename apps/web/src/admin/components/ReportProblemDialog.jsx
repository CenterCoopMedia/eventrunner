// "Report a problem" for the admin panel. The report goes to the Event Runner
// console, which checks the signed-in account against this site's project and
// passes it to the hosting team. The console adds nothing it is not sent.
import { useId, useState } from 'react';
import { auth } from '../../firebase.js';
import { recentMessages } from '../../lib/recentMessages.js';
import ModalShell from './media/ModalShell.jsx';
import { Notice, TextAreaField, fieldLabelClass, primaryButtonClass, secondaryButtonClass } from './formControls.jsx';

const CONSOLE_ORIGIN = (import.meta.env.VITE_CONSOLE_ORIGIN || 'https://console.eventrunner.org').replace(/\/+$/, '');
const KINDS = [
  { value: 'bug', label: 'Something is broken' },
  { value: 'suggestion', label: 'An idea or a change' },
  { value: 'question', label: 'A question' },
];

/** The client's name from its eventrunner.org address, or '' on another host. */
function siteName(hostname) {
  const match = /^([a-z0-9-]{1,63})\.eventrunner\.org$/.exec(hostname);
  return match ? match[1] : '';
}

async function sendReport(body) {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in to send a report.');
  const token = await user.getIdToken();
  let response;
  try {
    response = await fetch(`${CONSOLE_ORIGIN}/api/reportProblem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('We could not reach the server. Check your connection and try again.');
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(typeof payload?.error?.message === 'string' ? payload.error.message : 'Something went wrong. Try again.');
    error.field = payload?.error?.field;
    throw error;
  }
  return payload;
}

export default function ReportProblemDialog({ onClose, returnFocusRef }) {
  const id = useId();
  const [kind, setKind] = useState('bug');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);

  async function send(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await sendReport({
        category: kind,
        description,
        url: window.location.href,
        surface: 'admin',
        site: siteName(window.location.hostname),
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
    <ModalShell
      title="Report a problem"
      description={sent ? null : 'Tell us what happened and what you expected. We include this page’s address and recent error messages so we can find the problem.'}
      onClose={onClose}
      busy={busy}
      returnFocusRef={returnFocusRef}
    >
      {sent ? (
        <div className="flex flex-col gap-sm">
          <Notice tone="ok" message="Thanks. The hosting team has your report and will follow up by email." />
          <div><button type="button" className={primaryButtonClass} onClick={onClose}>Close</button></div>
        </div>
      ) : (
        <form onSubmit={send} noValidate className="flex flex-col gap-sm">
          <fieldset disabled={busy} className="flex flex-col gap-2xs">
            <legend className={fieldLabelClass}>What is it?</legend>
            {KINDS.map((option) => (
              <label key={option.value} className="flex min-h-admin-control items-center gap-xs text-admin-base text-admin-ink">
                <input type="radio" name={`${id}-kind`} value={option.value} checked={kind === option.value} onChange={() => setKind(option.value)} />
                <span>{option.label}</span>
              </label>
            ))}
          </fieldset>
          <TextAreaField
            label="What happened?"
            value={description}
            onChange={setDescription}
            error={descriptionError}
            rows={5}
            maxLength={4000}
            disabled={busy}
          />
          {error && !descriptionError ? <Notice tone="error" message={error.message} /> : null}
          <div className="flex flex-wrap gap-xs">
            <button type="submit" className={primaryButtonClass} disabled={busy}>{busy ? 'Sending report…' : 'Send report'}</button>
            <button type="button" className={secondaryButtonClass} disabled={busy} onClick={onClose}>Cancel</button>
          </div>
        </form>
      )}
    </ModalShell>
  );
}
