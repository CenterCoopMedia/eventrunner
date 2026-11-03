// "Set up your event" (ADR 0007 §6): the launch-readiness rows as a
// checklist a new client works through after the first sign-in.
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
// that field. Nothing else on the page writes.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useAdminApi } from '../adminApi.js';
import { OWNER_WORDS, joinSetupSteps } from '../setupSteps.js';
import {
  CheckboxField,
  FieldError,
  Notice,
  Panel,
  primaryButtonClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import AdminPageHeader, { AdminLoadingState, StatusBadge } from '../components/adminChrome.jsx';

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

/** One step: its title, state, owner, what to do, and where to go. */
function SetupStep({ step, isOperator, onLegalSaved }) {
  const headingId = `setup-step-${step.id}`;
  const showLink = step.link && (!step.link.operator || isOperator);
  return (
    <li aria-labelledby={headingId} className="flex flex-col gap-xs border-admin-rule-hairline border-b-admin-hairline py-sm last:border-b-0">
      <div className="flex flex-wrap items-center gap-xs">
        <h3 id={headingId} className="font-admin-ui text-admin-base font-bold text-admin-ink">
          {step.title}
        </h3>
        <StatusBadge tone={step.ready ? 'ok' : 'caution'}>{step.ready ? 'Done' : 'To do'}</StatusBadge>
        <StatusBadge tone="neutral">{OWNER_WORDS[step.owner] ?? OWNER_WORDS.host}</StatusBadge>
      </div>
      <p className="max-w-[65ch] text-admin-sm text-admin-ink">{step.ready ? step.done : step.todo}</p>
      {!step.ready && step.link && !showLink ? (
        <p className="text-admin-sm text-admin-ink-secondary">An operator completes this step.</p>
      ) : null}
      {!step.ready && showLink ? (
        <div>
          <Link to={step.link.to} className={secondaryButtonClass}>{step.link.label}</Link>
        </div>
      ) : null}
      {!step.ready && step.id === 'legal' && isOperator ? <LegalSignOff onSaved={onLegalSaved} /> : null}
    </li>
  );
}

export default function AdminSetup() {
  const call = useAdminApi();
  const { isOperator } = useAuth();
  const [checks, setChecks] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

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

      {checks ? (
        <Panel title="Steps" description="Each step shows who does it. A step changes to Done when the server sees the result.">
          <ol className="flex flex-col" aria-label="Setup steps">
            {steps.map((step) => (
              <SetupStep key={step.id} step={step} isOperator={isOperator} onLegalSaved={refresh} />
            ))}
          </ol>
        </Panel>
      ) : null}
    </div>
  );
}
