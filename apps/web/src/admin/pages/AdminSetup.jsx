// "Set up your event" (ADR 0007 §7): the launch-readiness rows as a stepper.
// One step shows at a time, at its own address (/admin/setup/<slug>), with a
// list of every step beside it and Back and Next under it. /admin/setup
// opens the first step that is not done.
//
// THE STATE COMES FROM THE SERVER. The page calls webMcpCheckEventReadiness
// (functions/src/admin/webMcpDiagnostics.cjs), which runs the same policy as
// `init-event.cjs --check` (shared/readiness). The page never decides that a
// row is met. It only says what each row means and where to go
// (../setupSteps.js). `init-event.cjs --check` stays the launch gate.
//
// THE ONE WRITE on this page is the legal sign-off: an operator confirms
// that counsel approved the privacy policy and terms, and the page saves
// `legal.reviewRequired: false` through updateEventConfig, the endpoint the
// Event settings form uses. config/event merges, so the save changes only
// that field.
//
// THE STEPPER PARTS are shared with the public forms
// (components/forms/Stepper.jsx, ADR 0008 §1).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { StepHeading, StepList, StepPager, resolveStep, useStepHeadingFocus } from '../../components/forms/Stepper.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useMediaQuery } from '../../lib/viewport.js';
import { useAdminApi } from '../adminApi.js';
import { ADMIN_DESKTOP_VIEWPORT } from '../AdminLayout.jsx';
import { OWNER_WORDS, firstOpenStep, joinSetupSteps } from '../setupSteps.js';
import {
  CheckboxField,
  FieldError,
  Notice,
  primaryButtonClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import AdminPageHeader, { AdminLoadingState, StatusBadge } from '../components/adminChrome.jsx';

const stepPath = (step) => `/admin/setup/${step.slug}`;

/** The legal sign-off: a confirmation box and one save. Operators only. */
function LegalSignOff({ onSaved }) {
  const call = useAdminApi();
  const [confirmed, setConfirmed] = useState(false);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const busyRef = useRef(false);

  const save = async () => {
    if (busyRef.current) return;
    if (!confirmed) {
      setMissing(true);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await call('updateEventConfig', { event: { legal: { reviewRequired: false } } });
      await onSaved();
    } catch (err) {
      setError(err);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-xs">
      <CheckboxField
        label="Our counsel reviewed and approved the privacy policy and the terms."
        checked={confirmed}
        onChange={(next) => {
          setConfirmed(next);
          if (next) setMissing(false);
        }}
        aria-invalid={missing || undefined}
        aria-errormessage={missing ? 'setup-legal-missing' : undefined}
      />
      <FieldError id="setup-legal-missing" message={missing ? 'Tick the box to confirm the review first.' : null} />
      <div>
        <button
          type="button"
          className={primaryButtonClass}
          onClick={save}
          aria-busy={busy || undefined}
          aria-disabled={busy || undefined}
        >
          {busy ? 'Saving…' : 'Mark the review complete'}
        </button>
      </div>
      {error ? <Notice tone="error" message={error.message} /> : null}
    </div>
  );
}

/** One step: its place, title, state, owner, what to do, and where to go. */
function SetupStep({ steps, index, isOperator, onLegalSaved, headingRef }) {
  const step = steps[index];
  const previous = steps[index - 1];
  const next = steps[index + 1];
  const showLink = step.link && (!step.link.operator || isOperator);
  return (
    <section className="admin-setup-detail admin-panel rounded-admin-panel border-admin-hairline border-admin-rule-hairline bg-admin-ground-raised p-md" aria-labelledby="setup-step-heading">
      <StepHeading index={index} total={steps.length} title={step.title} headingRef={headingRef} headingId="setup-step-heading" tier="admin" />
      <div className="flex flex-wrap items-center gap-xs">
        <StatusBadge tone={step.ready ? 'ok' : 'caution'}>{step.ready ? 'Done' : 'To do'}</StatusBadge>
        <StatusBadge tone="neutral">{OWNER_WORDS[step.owner] ?? OWNER_WORDS.host}</StatusBadge>
      </div>
      <p className="max-w-[65ch] text-admin-base text-admin-ink">{step.ready ? step.done : step.todo}</p>
      {!step.ready && step.link && !showLink ? (
        <p className="text-admin-sm text-admin-ink-secondary">An operator completes this step.</p>
      ) : null}
      {!step.ready && showLink ? (
        <div>
          <Link to={step.link.to} className={secondaryButtonClass}>{step.link.label}</Link>
        </div>
      ) : null}
      {!step.ready && step.id === 'legal' && isOperator ? <LegalSignOff onSaved={onLegalSaved} /> : null}
      <StepPager
        previous={previous}
        next={next}
        hrefFor={stepPath}
        backClass={secondaryButtonClass}
        nextClass={primaryButtonClass}
        tier="admin"
      />
    </section>
  );
}

export default function AdminSetup() {
  const call = useAdminApi();
  const { isOperator } = useAuth();
  const { stepSlug } = useParams();
  const wide = useMediaQuery(ADMIN_DESKTOP_VIEWPORT);
  const [checks, setChecks] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const headingRef = useStepHeadingFocus(stepSlug);

  const refresh = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await call('webMcpCheckEventReadiness', {});
      setChecks(Array.isArray(result?.checks?.items) ? result.checks.items : []);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [call]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const steps = checks ? joinSetupSteps(checks) : [];
  const doneCount = steps.filter((step) => step.ready).length;
  const allDone = checks !== null && steps.length > 0 && doneCount === steps.length;
  const { index: current, unknown } = resolveStep(steps, stepSlug, firstOpenStep(steps));
  const listed = steps.map((step) => ({ ...step, state: step.ready ? 'done' : 'todo' }));

  if (checks && unknown) return <Navigate to="/admin/setup" replace />;

  return (
    <div className="admin-setup flex flex-col gap-md">
      <AdminPageHeader
        title="Set up your event"
        identifiers={checks ? `${doneCount} of ${steps.length} steps done` : null}
        description="Complete these steps before your site goes live. Some steps are yours. The hosting team does the others. When every step is done, the hosting team runs the launch check and publishes the site."
        actions={
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={refresh}
            aria-busy={busy || undefined}
            aria-disabled={busy || undefined}
          >
            {busy ? 'Checking…' : 'Check again'}
          </button>
        }
      />

      {!checks && !error ? <AdminLoadingState label="Checking the setup steps…" /> : null}
      {error ? (
        <Notice
          tone={checks ? 'caution' : 'error'}
          message={checks ? 'We could not check again. These are the results of the last check.' : error.message}
        />
      ) : null}
      {allDone ? (
        <Notice tone="ok" message="Every step is done. Tell the hosting team that the site is ready for the launch check." />
      ) : null}

      {checks && current !== -1 ? (
        <div className="admin-setup-layout">
          <StepList steps={listed} current={current} hrefFor={stepPath} wide={wide} label="Setup steps" tier="admin" />
          <SetupStep
            steps={steps}
            index={current}
            isOperator={isOperator}
            onLegalSaved={refresh}
            headingRef={headingRef}
          />
        </div>
      ) : null}
    </div>
  );
}
