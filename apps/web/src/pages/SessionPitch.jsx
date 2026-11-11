// /pitch: the session pitch stepper (ADR 0008 §2). Five steps, each at its
// own address (/pitch/session … /pitch/review): the session, its format,
// the presenters, access and notes, then review and submit.
//
// ONE CHECK. Each step runs shared/pitchForm checkPitch on its own fields,
// the same rule submitSessionPitch runs on the whole pitch, so a pitch that
// passes every step is a pitch the server stores. A later step cannot open
// while an earlier one fails; an address that names one sends the reader to
// the first step that needs work.
//
// THE DRAFT stays in this tab's session storage (lib/pitchDraft.js) until
// the pitch is stored. Every edit takes a new submission key, so a retry of
// the same answers cannot become a second pitch and changed answers cannot
// replay an old one.
//
// SIGN-IN is asked for on the Review step only: a verified email is needed
// to submit, not to write. When the reader is signed in, the Presenters
// step names the address the organizers will use.
//
// An external form (config/pitch_call.externalFormUrl) replaces the stepper
// for the whole call, as it replaced the one-page form.
import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { isPitchCallOpen, readClosesAt, readPitchFormUrl } from 'shared/pitch';
import { STEP_FIELDS, checkPitch, readPitchFormOptions } from 'shared/pitchForm';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import SignInPanel, { FormError } from '../components/SignInPanel.jsx';
import { focusFirstError } from '../components/forms/publicForm.jsx';
import { StepHeading, StepList, StepPager, resolveStep, useStepHeadingFocus } from '../components/forms/Stepper.jsx';
import PitchStepFields, { PITCH_STEPS } from '../components/pitch/PitchStepFields.jsx';
import { primaryActionClass, secondaryActionClass, secondaryButtonClass } from '../components/controlClasses.js';
import ExternalLink from '../components/ExternalLink.jsx';
import { useAdminApi } from '../admin/adminApi.js';
import { subscribePitchCall } from '../lib/pitchSource.js';
import { newSubmissionKey } from '../lib/submissionKey.js';
import { blankPitch, clearPitch, restorePitch, savePitch, submissionOf } from '../lib/pitchDraft.js';
import { useMediaQuery, WIDE_VIEWPORT } from '../lib/viewport.js';
import { IS_DEMO } from '../lib/demoMode.js';

const hrefFor = (step) => `/pitch/${step.slug}`;
const FORM_STEPS = PITCH_STEPS.filter((step) => step.slug !== 'review');

/** The step that holds a field the check named: `presenters.1.email` → presenters. */
function stepOfField(field) {
  const base = String(field).split('.')[0];
  return PITCH_STEPS.find((step) => STEP_FIELDS[step.slug].includes(base))?.slug ?? 'session';
}

export default function SessionPitch() {
  const { user, loading, signOut } = useAuth();
  const { eventConfig: event } = useEventConfig();
  const call = useAdminApi();
  const navigate = useNavigate();
  const { stepSlug } = useParams();
  const wide = useMediaQuery(WIDE_VIEWPORT);
  const headingRef = useStepHeadingFocus(stepSlug);
  const [draft, setDraft] = useState(restorePitch);
  const [settings, setSettings] = useState(null);
  const [configError, setConfigError] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState({});
  const [validationAttempt, setValidationAttempt] = useState(0);
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
    if (saved) clearPitch();
    else if (!savePitch(draft)) setStorageError(true);
  }, [draft, saved]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => { if (saved) savedRef.current?.focus(); }, [saved]);
  useEffect(() => { if (validationAttempt) focusFirstError(formRef.current); }, [validationAttempt]);
  // The lead presenter's name starts from the account, once, while it is empty.
  useEffect(() => {
    if (user?.displayName) setDraft((current) => (current.leadName ? current : { ...current, leadName: user.displayName }));
  }, [user?.displayName]);

  const deadline = Date.parse(readClosesAt(settings?.closesAt));
  const open = !configError && isPitchCallOpen(settings, now);
  const externalForm = readPitchFormUrl(settings?.externalFormUrl);
  const modeKnown = IS_DEMO || Boolean(settings);
  const options = readPitchFormOptions(settings);
  const email = user?.emailVerified ? user.email : null;
  const body = submissionOf(draft, options);
  const stepErrors = (slug) => checkPitch(body, { options, submitterEmail: email, fields: STEP_FIELDS[slug] }).errors;
  const firstOpen = FORM_STEPS.findIndex((step) => Object.keys(stepErrors(step.slug)).length > 0);
  const steps = PITCH_STEPS.map((step, index) => {
    if (firstOpen !== -1 && index > firstOpen) return { ...step, state: 'locked' };
    const done = step.slug !== 'review' && draft.visited.includes(step.slug) && Object.keys(stepErrors(step.slug)).length === 0;
    return { ...step, state: done ? 'done' : 'todo' };
  });
  const { index: current, unknown } = resolveStep(PITCH_STEPS, stepSlug, 0);
  const step = steps[current];

  const edit = (field) => (value) => {
    setDraft((previous) => ({ ...previous, [field]: value, submissionKey: newSubmissionKey() }));
    setErrors((previous) => {
      const next = { ...previous };
      for (const key of Object.keys(next)) if (key === field || key.startsWith(`${field}.`)) delete next[key];
      return next;
    });
  };

  function goNext() {
    const found = stepErrors(step.slug);
    setErrors(found);
    if (Object.keys(found).length) { setValidationAttempt((n) => n + 1); return; }
    setDraft((previous) => (previous.visited.includes(step.slug) ? previous : { ...previous, visited: [...previous.visited, step.slug] }));
    navigate(hrefFor(PITCH_STEPS[current + 1]));
  }

  async function submit() {
    if (busy) return;
    setError('');
    const all = checkPitch(body, { options, submitterEmail: email });
    if (!all.ok) {
      const [field] = Object.keys(all.errors);
      setErrors(all.errors);
      setValidationAttempt((n) => n + 1);
      const slug = stepOfField(field);
      if (slug !== 'review') navigate(`/pitch/${slug}`);
      return;
    }
    if (!open) { setError('Pitches are closed right now. Your answers are still here.'); return; }
    if (!email) { setError('Sign in with a verified email address before submitting.'); return; }
    setBusy(true);
    try {
      const result = await call('submitSessionPitch', body);
      setSaved({ id: result.id, email: user.email });
    } catch (err) {
      setError(`${err.message} Your answers are still here. Select Submit pitch again.`);
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <header className="max-w-prose space-y-sm">
      <h1 className="font-heading text-h1 font-semibold text-text-primary">Pitch a session</h1>
      <p className="text-lead text-text-secondary">Share an idea for {event.shortName}. Tell the organizers what people will learn and how you will involve them.</p>
      <section className="space-y-xs border-t-hairline border-rule-hairline pt-sm" aria-labelledby="pitch-call-heading">
        <h2 id="pitch-call-heading" className="sr-only">Call for sessions</h2>
        <p role="status" className="font-semibold">{IS_DEMO ? 'Submissions are disabled in this demo.' : configError ? 'Checking your connection…' : !settings ? 'Checking submissions…' : open ? 'Submissions are open' : 'Submissions are closed'}</p>
        {Number.isFinite(deadline) ? <p className="text-caption text-text-secondary">Deadline: <time dateTime={settings.closesAt}>{new Date(deadline).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time> ({Intl.DateTimeFormat().resolvedOptions().timeZone})</p>
          : open ? <p className="text-caption text-text-secondary">There is no set deadline. The organizers close submissions when they are ready.</p> : null}
        <p className="text-caption text-text-secondary">{externalForm ? 'You do not need a ticket to pitch a session.' : 'A verified email address is required to submit. You do not need a ticket or attendee approval.'}</p>
      </section>
    </header>
  );

  if (!modeKnown) return <article className="w-full space-y-lg">{header}</article>;

  if (externalForm) {
    return (
      <article className="w-full space-y-lg">
        {header}
        <section className="max-w-prose space-y-sm border-hairline border-rule-hairline bg-surface-alt p-md sm:p-lg" aria-labelledby="pitch-form-heading">
          <h2 id="pitch-form-heading" className="font-heading text-h2 font-semibold">Pitch form</h2>
          {open ? <>
            <p className="text-text-secondary">The organizers collect pitches with a separate form. Its own privacy terms apply.</p>
            <ExternalLink href={externalForm} className={primaryActionClass}>Open the pitch form</ExternalLink>
          </> : <p className="text-text-secondary">The pitch form is not available now.</p>}
        </section>
      </article>
    );
  }

  if (saved) {
    return (
      <article className="w-full space-y-lg">
        {header}
        <section ref={savedRef} tabIndex={-1} className="space-y-sm border-hairline border-rule-hairline bg-surface-alt p-lg">
          <h2 className="font-heading text-h2 font-semibold">Your pitch is saved</h2>
          <p role="status">The organizers will review it and let you know by email whether it is accepted.</p>
          <p className="text-text-secondary">Submitted as {saved.email}.</p>
          <button type="button" className={secondaryButtonClass} onClick={() => { setDraft(blankPitch()); setSaved(null); navigate('/pitch/session'); }}>Pitch another session</button>
        </section>
      </article>
    );
  }

  if (unknown) return <Navigate to="/pitch" replace />;
  if (step.state === 'locked') return <Navigate to={hrefFor(PITCH_STEPS[firstOpen])} replace />;

  const review = step.slug === 'review';
  const submitControl = (
    <div className="flex flex-col items-end gap-xs">
      {email ? (
        <button type="button" className={primaryActionClass} onClick={submit} disabled={busy || !open} aria-busy={busy || undefined}>
          {busy ? 'Saving pitch…' : 'Submit pitch'}
        </button>
      ) : null}
    </div>
  );

  return (
    <article className="w-full space-y-lg">
      {header}
      <div className="grid items-start gap-lg lg:grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)]">
        <StepList steps={steps} current={current} hrefFor={hrefFor} wide={wide} label="Pitch steps" />
        <section className="min-w-0 space-y-md border-hairline border-rule-hairline bg-surface-alt p-md sm:p-lg" aria-labelledby="pitch-step-heading">
          <StepHeading index={current} total={PITCH_STEPS.length} title={step.title} headingRef={headingRef} headingId="pitch-step-heading" />
          <FormError message={error} errorRef={errorRef} />
          {!open && !IS_DEMO && settings && !configError ? (
            <p className="border-hairline border-rule-hairline bg-surface p-sm text-caption">Submissions are closed. You cannot submit a pitch now. Your answers stay in this browser tab.</p>
          ) : null}
          <form ref={formRef} noValidate className="space-y-md" onSubmit={(e) => { e.preventDefault(); if (review) submit(); else goNext(); }}>
            <fieldset disabled={busy} className="min-w-0 space-y-md">
              <PitchStepFields slug={step.slug} draft={draft} edit={edit} errors={errors} options={options} hrefFor={hrefFor} email={email} />
            </fieldset>
          </form>
          {/* Outside the step form: the sign-in panel holds a form of its own. */}
          {review ? (
            <section className="space-y-sm border-t-hairline border-rule-hairline pt-sm" aria-labelledby="pitch-identity-heading">
              <h3 id="pitch-identity-heading" className="font-heading text-h3 font-semibold">Your sign-in</h3>
              {loading ? <p role="status">Checking your sign-in…</p>
                : email ? <><p className="break-all text-caption text-text-secondary">Submitting as {email}</p><button type="button" className={secondaryButtonClass} onClick={signOut}>Use another account</button></>
                  : <><p className="text-caption text-text-secondary">{user ? 'We need to confirm your email. Sign out, then sign in with an emailed code.' : 'Sign in to submit. Your answers stay here.'}</p>{user ? <button type="button" className={secondaryButtonClass} onClick={signOut}>Sign out</button> : <SignInPanel />}</>}
            </section>
          ) : null}
          <StepPager
            previous={PITCH_STEPS[current - 1]}
            next={review ? null : PITCH_STEPS[current + 1]}
            hrefFor={hrefFor}
            backClass={secondaryActionClass}
            nextClass={primaryActionClass}
            onNext={goNext}
            last={review ? submitControl : null}
          />
          <p className="text-caption text-text-secondary">{storageError ? 'Keep this tab open. Your browser cannot save your answers if you close it.' : 'Your answers stay in this browser tab until you submit.'}</p>
        </section>
      </div>
    </article>
  );
}
