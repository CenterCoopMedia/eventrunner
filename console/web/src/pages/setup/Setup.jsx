import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { callApi } from '../../api.js';
import {
  ANSWER_STEPS, STEPS, errorsOfStep, setupPath, statusPath, stepByPath,
} from '../../setup/steps.js';
import { saveStatusText, useAutosave } from '../../setup/useAutosave.js';
import EmailStep from './EmailStep.jsx';
import EventStep from './EventStep.jsx';
import OrganizationStep from './OrganizationStep.jsx';
import ReviewStep from './ReviewStep.jsx';
import TeamStep from './TeamStep.jsx';
import TicketsStep from './TicketsStep.jsx';
import WebAddressStep from './WebAddressStep.jsx';

const STEP_VIEWS = {
  organization: OrganizationStep,
  event: EventStep,
  webAddress: WebAddressStep,
  tickets: TicketsStep,
  email: EmailStep,
};

/** The step list: where the reader is, and which steps are done. */
function StepList({ step, progress, orgId, appId, onGo }) {
  const done = STEPS.filter((s) => progress[s.id]).length;
  return (
    <nav aria-label="Setup steps" className="step-nav">
      <p className="muted" id="step-progress">{done} of {STEPS.length} steps done</p>
      <ol className="steps" aria-describedby="step-progress">
        {STEPS.map((s, i) => {
          const current = s.id === step.id;
          return (
            <li key={s.id} className={current ? 'current' : undefined}>
              <Link
                to={setupPath(orgId, appId, s)}
                aria-current={current ? 'step' : undefined}
                onClick={(e) => onGo(e, s)}
              >
                <span className="step-number" aria-hidden="true">{progress[s.id] ? '✓' : i + 1}</span>
                <span>{s.title}</span>
                {progress[s.id] ? <span className="visually-hidden"> (done)</span> : null}
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Errors to show: for fields the reader touched, or all of them when asked to check. */
function visibleErrors(errors, touched, showAll) {
  if (showAll) return errors;
  return Object.fromEntries(Object.entries(errors).filter(([path]) => touched.has(path)));
}

function useApplication(orgId, appId) {
  const [app, setApp] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    callApi('getApplication', { orgId, appId })
      .then((body) => { if (live) setApp(body.application); })
      .catch((err) => { if (live) setError(err.message); });
    return () => { live = false; };
  }, [orgId, appId]);
  return { app, setApp, error };
}

/**
 * The guided setup (ADR 0007 §3): one step per page at its own address,
 * a step list with progress, Back and Next, and autosave as the client
 * types. A teammate can open the same address and continue.
 */
export default function Setup() {
  const { orgId, appId, step: stepPath } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const step = stepByPath(stepPath);
  const { app, setApp, error } = useApplication(orgId, appId);
  const [touched, setTouched] = useState(() => new Set());
  const showAll = search.get('check') === '1';

  const { queue, flush, status: saveStatus, error: saveError } = useAutosave({
    save: (value) => callApi('saveApplicationStep', { orgId, appId, step: value.step, answers: value.answers }),
    onResult: (result) => setApp((prev) => {
      const others = Object.fromEntries(Object.entries(prev.errors).filter(([path]) => !(path === result.step || path.startsWith(`${result.step}.`))));
      const errors = { ...others, ...result.errors };
      return { ...prev, errors, progress: { ...prev.progress, [result.step]: Object.keys(result.errors).length === 0 } };
    }),
  });

  const touch = useCallback((path) => {
    setTouched((prev) => (prev.has(path) ? prev : new Set(prev).add(path)));
  }, []);

  const onChange = useCallback((value, path) => {
    if (!step || !ANSWER_STEPS.includes(step.id)) return;
    touch(path);
    setApp((prev) => ({ ...prev, answers: { ...prev.answers, [step.id]: value } }));
    queue({ step: step.id, answers: value });
  }, [step, touch, setApp, queue]);

  const onOwnersNeeded = useCallback((ownersNeeded) => {
    setApp((prev) => (prev.ownersNeeded === ownersNeeded ? prev : {
      ...prev, ownersNeeded, progress: { ...prev.progress, team: ownersNeeded === 0 },
    }));
  }, [setApp]);

  // With ?check=1 the first field with an error takes the focus.
  useEffect(() => {
    if (!showAll || !app) return;
    const first = document.querySelector('.step-body [aria-invalid="true"], .step-body [data-group-error]');
    first?.focus?.();
  }, [showAll, app, stepPath]);

  const go = useCallback(async (target) => {
    await flush();
    navigate(setupPath(orgId, appId, target));
  }, [flush, navigate, orgId, appId]);

  const stepErrors = useMemo(() => (app && step ? errorsOfStep(app.errors, step.id) : {}), [app, step]);

  if (!step) return <Navigate to={setupPath(orgId, appId, STEPS[0])} replace />;
  if (error) return <p className="message error" role="alert">{error}</p>;
  if (!app) return <p role="status">Loading your setup.</p>;
  if (!app.canEdit) return <Navigate to={statusPath(orgId, appId)} replace />;

  const index = STEPS.indexOf(step);
  const previous = STEPS[index - 1];
  const next = STEPS[index + 1];
  const View = STEP_VIEWS[step.id];
  const shownErrors = visibleErrors(stepErrors, touched, showAll);

  return (
    <div className="setup">
      <StepList
        step={step}
        progress={app.progress}
        orgId={orgId}
        appId={appId}
        onGo={(e, target) => { e.preventDefault(); go(target); }}
      />
      <section className="step-body" aria-labelledby="step-title">
        <p className="muted">Step {index + 1} of {STEPS.length}</p>
        <h1 id="step-title" tabIndex={-1}>{step.title}</h1>
        {app.status === 'changes_requested' && app.note ? (
          <aside className="note" role="note">
            <p className="note-title">The hosting team asked for changes</p>
            <p className="pre">{app.note}</p>
          </aside>
        ) : null}
        {View ? (
          <View
            value={app.answers[step.id]}
            answers={app.answers}
            errors={shownErrors}
            onChange={onChange}
            onBlur={touch}
            appId={appId}
          />
        ) : null}
        {step.id === 'team' ? <TeamStep orgId={orgId} onOwnersNeeded={onOwnersNeeded} /> : null}
        {step.id === 'review' ? (
          <ReviewStep
            app={app}
            answers={app.answers}
            errors={app.errors}
            ownersNeeded={app.ownersNeeded}
            orgId={orgId}
            appId={appId}
            flush={flush}
            onSubmitted={() => navigate(statusPath(orgId, appId))}
          />
        ) : null}
        <p className="save-status" role="status" aria-live="polite">{saveStatusText(saveStatus, saveError)}</p>
        <div className="step-actions">
          {previous ? <button type="button" className="button" onClick={() => go(previous)}>Back</button> : null}
          {next ? <button type="button" className="button primary" onClick={() => go(next)}>Next</button> : null}
        </div>
        <p><Link to={statusPath(orgId, appId)}>Leave the setup. Your answers are saved.</Link></p>
      </section>
    </div>
  );
}
