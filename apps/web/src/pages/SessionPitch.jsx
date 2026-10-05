import { readClosesAt } from 'shared/pitch';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import SignInPanel, { FormError } from '../components/SignInPanel.jsx';
import { Checkbox } from '../components/forms/Choice.jsx';
import { TextField, TextAreaField, focusFirstError } from '../components/forms/publicForm.jsx';
import { primaryButtonClass, secondaryButtonClass } from '../components/controlClasses.js';
import { useAdminApi } from '../admin/adminApi.js';
import { subscribePitchCall } from '../lib/pitchSource.js';
import { newSubmissionKey } from '../lib/submissionKey.js';
import { IS_DEMO } from '../lib/demoMode.js';

const STORAGE_KEY = 'session-pitch-draft-v1';
const blank = () => ({ title: '', description: '', organization: '', format: '', consent: false, submissionKey: newSubmissionKey() });
function restore() {
  try {
    const value = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
    if (value && typeof value.title === 'string' && typeof value.description === 'string'
      && typeof value.organization === 'string' && typeof value.format === 'string'
      && /^[A-Za-z0-9_-]{8,128}$/.test(value.submissionKey)) return { ...value, consent: value.consent === true };
  } catch { /* Storage may be unavailable; the mounted form still retains entries. */ }
  return blank();
}

export default function SessionPitch() {
  const { user, loading, signOut } = useAuth();
  const { eventConfig: event } = useEventConfig();
  const call = useAdminApi();
  const [pitch, setPitch] = useState(restore);
  const [settings, setSettings] = useState(null);
  const [configError, setConfigError] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState({});
  const [validationAttempt, setValidationAttempt] = useState(0);
  const [newPitchAttempt, setNewPitchAttempt] = useState(0);
  const [storageError, setStorageError] = useState(false);
  const formRef = useRef(null);
  const errorRef = useRef(null);
  const savedRef = useRef(null);
  useEffect(() => {
    if (IS_DEMO) return undefined;
    return subscribePitchCall((value) => { setSettings(value); setConfigError(false); }, () => setConfigError(true));
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    try {
      if (saved) sessionStorage.removeItem(STORAGE_KEY);
      else sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pitch));
    } catch { setStorageError(true); }
  }, [pitch, saved]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => { if (saved) savedRef.current?.focus(); }, [saved]);
  useEffect(() => { if (validationAttempt) focusFirstError(formRef.current); }, [validationAttempt]);

  useEffect(() => { if (newPitchAttempt) formRef.current?.querySelector('input')?.focus(); }, [newPitchAttempt]);

  const deadline = Date.parse(readClosesAt(settings?.closesAt));
  const open = !configError && settings?.enabled === true && Number.isFinite(deadline) && deadline > now;
  function edit(field, value) {
    setPitch((previous) => ({ ...previous, [field]: value, submissionKey: newSubmissionKey() }));
    setErrors((previous) => ({ ...previous, [field]: null }));
  }
  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setError('');
    const invalid = {};
    if (!pitch.title.trim()) invalid.title = 'Enter a session title.';
    if (!pitch.description.trim()) invalid.description = 'Describe your session idea.';
    if (!pitch.consent) invalid.consent = 'Agree to organizer review before submitting.';
    setErrors(invalid);
    if (Object.keys(invalid).length) setValidationAttempt((n) => n + 1);
    if (Object.keys(invalid).length) return;
    if (!open) { setError('Session pitch submissions are closed or cannot be checked. Your entries are still here.'); return; }
    if (!user?.emailVerified) { setError('Sign in with a verified email address before submitting.'); return; }
    setBusy(true);
    try {
      const result = await call('submitSessionPitch', {
        ...pitch, title: pitch.title.trim(), description: pitch.description.trim(),
        organization: pitch.organization.trim() || null, format: pitch.format.trim() || null,
      });
      setSaved({ id: result.id, email: user.email });
    } catch (err) { setError(`${err.message} Your entries are still here. Retry the same pitch to avoid a duplicate.`); }
    finally { setBusy(false); }
  }

  return (
    <article className="mx-auto max-w-5xl space-y-lg">
      <header className="max-w-prose space-y-sm">
        <h1 className="font-heading text-h1 font-semibold text-text-primary">Pitch a session</h1>
        <p className="text-body-lg text-text-secondary">Share an idea for {event.shortName}. Tell the organizers what people will learn and how you will involve them.</p>
            <section className="space-y-xs border-t-hairline border-rule-hairline pt-sm" aria-labelledby="pitch-call-heading">
              <h2 id="pitch-call-heading" className="sr-only">Call for sessions</h2>
              <p role="status" className="font-semibold">{IS_DEMO ? 'Submissions are disabled in this demo.' : configError ? 'Cannot check submissions. Reconnecting…' : !settings ? 'Checking submissions…' : open ? 'Submissions are open' : 'Submissions are closed'}</p>
              {Number.isFinite(deadline) ? <p className="text-caption text-text-secondary">Deadline: <time dateTime={settings.closesAt}>{new Date(deadline).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZoneName: undefined })}</time> ({Intl.DateTimeFormat().resolvedOptions().timeZone})</p> : null}
              <p className="text-caption text-text-secondary">A verified email address is required. You do not need a ticket or attendee approval.</p>
            </section>
      </header>
      {saved ? (
        <section ref={savedRef} tabIndex={-1} className="space-y-sm border-hairline border-rule-hairline bg-surface-alt p-lg">
          <h2 className="font-heading text-h2 font-semibold">Your pitch is saved</h2>
          <p role="status">The organizers can now review it. Submission does not confirm a place on the schedule.</p>
          <p className="break-all font-data text-caption text-text-secondary">Reference: {saved.id}</p>
          <p className="text-text-secondary">Submitted as {saved.email}. This confirmation does not mean an email was sent.</p>
          <button className={secondaryButtonClass} onClick={() => { setPitch(blank()); setSaved(null); setNewPitchAttempt((n) => n + 1); }}>Pitch another session</button>
        </section>
      ) : (
        <div className="grid items-start gap-lg lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <section className="min-w-0 space-y-md border-hairline border-rule-hairline bg-surface-alt p-md sm:p-lg" aria-labelledby="pitch-idea-heading">
            <h2 id="pitch-idea-heading" className="font-heading text-h2 font-semibold">Your session idea</h2>
            <p className="text-caption text-text-secondary">Title, description, and review consent are required. Organization and format are optional.</p>
            <FormError message={error} errorRef={errorRef} />
            <form ref={formRef} onSubmit={submit} noValidate className="space-y-md">
              <fieldset disabled={busy} className="min-w-0 space-y-md">
                <TextField label="Session title" required maxLength={160} value={pitch.title} onChange={(v) => edit('title', v)} error={errors.title} />
                <TextAreaField label="Session description" required maxLength={5000} rows={6} value={pitch.description} onChange={(v) => edit('description', v)} error={errors.description} hint="Describe the topic, audience, takeaways, and any proposed speakers." />
                <div className="grid gap-md sm:grid-cols-2">
                  <TextField label="Organization (optional)" maxLength={200} value={pitch.organization} onChange={(v) => edit('organization', v)} />
                  <TextField label="Format (optional)" maxLength={120} value={pitch.format} onChange={(v) => edit('format', v)} hint="For example, panel or workshop." />
                </div>
                <Checkbox checked={pitch.consent} onChange={(e) => edit('consent', e.target.checked)} required error={errors.consent}
                  label="I agree that organizers may store my pitch and sign-in email to review this proposal and contact me about it."
                  description="Your proposal stays private until staff explicitly create, edit, and publish event content." />
              </fieldset>
              <button type="submit" className={primaryButtonClass} disabled={busy || !open || !user?.emailVerified} aria-busy={busy || undefined}>{busy ? 'Saving pitch…' : 'Submit pitch'}</button>
              <p className="text-caption text-text-secondary">{storageError ? 'Keep this page open: Browser storage is unavailable.' : 'Entries stay in this browser tab until you submit. You can sign in without leaving this page.'}</p>
            </form>
          </section>
          <aside className="min-w-0 space-y-lg border-t-strong border-rule-strong pt-md">
            <section className="space-y-sm" aria-labelledby="pitch-identity-heading">
              <h2 id="pitch-identity-heading" className="font-heading text-h3 font-semibold">Your sign-in</h2>
              {loading ? <p role="status">Checking your sign-in…</p> : user?.emailVerified ? <><p className="break-all text-caption text-text-secondary">Submitting as {user.email}</p><button type="button" className={secondaryButtonClass} onClick={signOut}>Use another account</button></> : <><p className="text-caption text-text-secondary">{user ? 'This account needs a verified email. Sign out and use Google or an emailed code.' : 'Use Google or an emailed code. Your session idea stays in the form.'}</p>{user ? <button className={secondaryButtonClass} onClick={signOut}>Sign out</button> : <SignInPanel />}</>}
            </section>
          </aside>
        </div>
      )}
    </article>
  );
}
