import { useRef, useState } from 'react';
import { ROLE_HELP, ROLE_LABELS, isEmail } from '../text.js';

/** Invite a teammate by email, as an Owner or an Editor. Owners only. */
export default function TeamInviteForm({ onInvite }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');
  const [fieldError, setFieldError] = useState('');
  const [busy, setBusy] = useState(false);
  const fieldRef = useRef(null);

  async function onSubmit(event) {
    event.preventDefault();
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
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={fieldError ? 'true' : undefined}
            aria-describedby={fieldError ? 'invite-email-error' : undefined}
          />
          {fieldError ? <p id="invite-email-error" className="field-error">{fieldError}</p> : null}
        </div>
        <fieldset className="choices">
          <legend>Role</legend>
          {['editor', 'owner'].map((value) => (
            <label key={value} className="choice">
              <input type="radio" name="invite-role" value={value} checked={role === value} onChange={() => setRole(value)} />
              <span><strong>{ROLE_LABELS[value]}</strong>: {ROLE_HELP[value]}</span>
            </label>
          ))}
        </fieldset>
        <button type="submit" className="button primary" disabled={busy}>Send invite</button>
      </form>
    </section>
  );
}
