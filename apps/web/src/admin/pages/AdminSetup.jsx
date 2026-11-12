import HelpTooltip from '../components/HelpTooltip.jsx';
// "Set up your event" (ADR 0007 §7): client tasks and read-only hosting status.
// One step shows at a time, at its own address (/admin/setup/<slug>), with a
// list of every step beside it and Back and Next under it. /admin/setup
// opens the first step that is not done.
//
// THE STATE COMES FROM THE SERVER. The page calls webMcpCheckEventReadiness
// (functions/src/admin/webMcpDiagnostics.cjs), which runs the same policy as
// `init-event.cjs --check` (shared/readiness). The page never decides that a
// row is met. It only says what each row means and where to go
// (../setupSteps.js). `init-event.cjs --check` stays the launch gate.
// The mailing-address status is advisory and does not enter that gate.
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
import AdminIconControl from '../components/AdminIconControl.jsx';

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
    } catch {
      setError(new Error('The legal review could not be approved. Try again.'));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-xs">
      <CheckboxField data-help-skip="The label states the complete legal-review confirmation."
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
          {busy ? 'Saving…' : 'Approve'}
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
      <p className="text-admin-base text-admin-ink">{step.ready ? step.done : step.todo}</p>
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
  const [mailingAddressReady, setMailingAddressReady] = useState(null);
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
      setMailingAddressReady(typeof result?.mailingAddressReady === 'boolean' ? result.mailingAddressReady : null);
      setError(null);
    } catch {
      setError(new Error('The setup could not be checked. Try again.'));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [call]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const rows = checks ? joinSetupSteps(checks) : [];
  const steps = rows.filter((row) => row.owner === 'you' || row.owner === 'both');
  const hosting = rows.filter((row) => row.owner === 'host');
  if (checks) hosting.push({
    id: 'mailing-address',
    title: 'Email mailing address',
    ready: mailingAddressReady === true,
    done: 'A mailing address is set for announcement and reminder emails.',
    todo: mailingAddressReady === null
      ? 'The mailing address could not be checked. Select Check again.'
      : 'Announcements and reminders need your mailing address in the email footer. Contact the Event Runner team to set it.',
  });
  const doneCount = steps.filter((step) => step.ready).length;
  const clientDone = steps.length > 0 && doneCount === steps.length;
  const allDone = rows.length > 0 && rows.every((row) => row.ready) && !error && !busy;
  const { index: current, unknown } = resolveStep(steps, stepSlug, firstOpenStep(steps));
  const listed = steps.map((step) => ({ ...step, state: step.ready ? 'done' : 'todo' }));

  if (checks && unknown) return <Navigate to="/admin/setup" replace />;

  return (
    <div className="admin-setup flex flex-col gap-md">
      <AdminPageHeader help="Complete your setup tasks before you share your site. Hosting status shows the checks managed by the Event Runner team."
        title="Set up your event"
        identifiers={checks ? `${doneCount} of ${steps.length} steps done` : null}
        description="Complete your setup tasks before you share your site. Hosting status shows the checks managed by the Event Runner team."
        actions={
          <AdminIconControl
            icon="refresh"
            label={busy ? 'Checking…' : 'Check again'}
            busy={busy}
            className={secondaryButtonClass}
            onClick={refresh}
            aria-busy={busy || undefined}
            aria-disabled={busy || undefined}
          />
        }
      />

      {!checks && !error ? <AdminLoadingState label="Checking the setup steps…" /> : null}
      {error ? (
        <Notice
          tone={checks ? 'caution' : 'error'}
          message={checks ? 'The setup could not be checked. Showing the last results; check your connection and try again.' : error.message}
        />
      ) : null}
      {allDone ? (
        <Notice tone="ok" message="Your setup tasks and launch checks are ready. Your site is ready to share." />
      ) : null}
      {clientDone && !allDone && !error && !busy ? (
        <Notice tone="caution" message="Your setup tasks are done. Awaiting Event Runner setup before you share your site." />
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
      {hosting.length > 0 ? (
        <section className="admin-panel flex min-w-0 flex-col gap-sm rounded-admin-panel border-admin-hairline border-admin-rule-hairline bg-admin-ground-raised p-md" aria-labelledby="setup-hosting-heading">
          <div className="flex items-center gap-2xs"><h2 id="setup-hosting-heading" className="font-admin-ui text-admin-lg font-bold text-admin-ink">Hosting status</h2><HelpTooltip label="Hosting status">Review the setup checks managed by the Event Runner team.</HelpTooltip></div>
          <p className="text-admin-base text-admin-ink-secondary">The Event Runner team manages these checks.</p>
          <ul className="flex flex-col gap-md" aria-label="Hosting checks">
            {hosting.map((check) => (
              <li key={check.id} className="flex flex-col gap-xs">
                <div className="flex flex-wrap items-center gap-xs">
                  <div className="flex items-center gap-2xs"><h3 className="text-admin-base font-semibold text-admin-ink">{check.title}</h3><HelpTooltip label="this section">Review this hosting check and any action described below it.</HelpTooltip></div>
                  <StatusBadge tone={check.ready ? 'ok' : 'caution'}>{check.ready ? 'Ready' : 'Awaiting Event Runner setup'}</StatusBadge>
                </div>
                <p className="text-admin-base text-admin-ink">{check.ready ? check.done : check.todo}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
