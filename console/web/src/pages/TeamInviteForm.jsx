import { useRef, useState } from 'react';
import { ROLE_HELP, ROLE_LABELS, isEmail } from '../text.js';
import { ActionResult } from '../ActionFeedback.jsx';

/** Invite a teammate by email, as an Owner or an Editor. Owners only. */
export default function TeamInviteForm({ onInvite, outcome, disabled, onRefresh, refreshing }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');
  const [fieldError, setFieldError] = useState('');
  const [busy, setBusy] = useState(false);
  const fieldRef = useRef(null);

  async function onSubmit(event) {
    event.preventDefault();
    if (busy || disabled) return;
    if (!isEmail(email)) {
      setFieldError('Enter a valid email address.');
      fieldRef.current?.focus();
      return;
    }
    setFieldError('');
    setBusy(true);
    const address = email.trim().toLowerCase();
    const sent = await onInvite('inviteMember', { email: address, role }, `We sent an invite to ${address}.`);
    setBusy(false);
    if (sent) setEmail('');
  }

  return (
    <section aria-labelledby="invite-title" className="section">
      <h2 id="invite-title">Invite a teammate</h2>
      <p className="muted">We email a link. It works once and expires in 7 days.</p>
      <form noValidate onSubmit={onSubmit} className="stack">
        <div className="field">
          <label htmlFor="invite-email">Email address</label>
          <input
            id="invite-email"
            ref={fieldRef}
            type="email"
            inputMode="email"
            autoComplete="off"
            value={email}
            disabled={busy}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={fieldError ? 'true' : undefined}
            aria-describedby={fieldError ? 'invite-email-error' : undefined}
          />
          {fieldError ? <p id="invite-email-error" className="field-error">{fieldError}</p> : null}
        </div>
        <fieldset className="choices" disabled={busy}>
          <legend>Role</legend>
          {['editor', 'owner'].map((value) => (
            <label key={value} className="choice">
              <input type="radio" name="invite-role" value={value} checked={role === value} onChange={() => setRole(value)} />
              <span><strong>{ROLE_LABELS[value]}</strong>: {ROLE_HELP[value]}</span>
            </label>
          ))}
        </fieldset>
        <button type="submit" className="button primary" disabled={busy || disabled}>{busy ? 'Sending invite…' : 'Send invite'}</button>
        <ActionResult result={outcome} onRefresh={onRefresh} refreshing={refreshing} refreshLabel="Refresh team" />
      </form>
    </section>
  );
}
