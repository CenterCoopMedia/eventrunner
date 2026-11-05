import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { callApi } from '../../api.js';
import {
  ANSWER_STEPS, STEPS, errorsOfStep, openStepIds, setupPath, statusPath, stepById, stepByPath,
} from '../../setup/steps.js';
import { saveStatusText, useAutosave } from '../../setup/useAutosave.js';
import ActionFeedback from '../../ActionFeedback.jsx';
import AgreementStep from './AgreementStep.jsx';
import EmailStep from './EmailStep.jsx';
import EventStep from './EventStep.jsx';
import OrganizationStep from './OrganizationStep.jsx';
import ReviewStep from './ReviewStep.jsx';
import TeamStep from './TeamStep.jsx';
import TicketsStep from './TicketsStep.jsx';
import WebAddressStep from './WebAddressStep.jsx';
import LoadingState from '../../LoadingState.jsx';

const STEP_VIEWS = {
  organization: OrganizationStep,
  event: EventStep,
  webAddress: WebAddressStep,
  tickets: TicketsStep,
  email: EmailStep,
};

/** The step list: where the reader is, which steps are done, and which are open now. */
function StepList({ step, progress, open, orgId, appId, onGo, disabled }) {
  const done = STEPS.filter((s) => progress[s.id]).length;
  return (
    <nav aria-label="Setup steps" className="step-nav">
      <p className="muted" id="step-progress">{done} of {STEPS.length} steps done</p>
      <ol className="steps" aria-describedby="step-progress">
        {STEPS.map((s, i) => {
          const current = s.id === step.id;
          if (!open.includes(s.id)) {
            return (
              <li key={s.id}>
                <span className="step-locked">
                  <span className="step-number" aria-hidden="true">{progress[s.id] ? '✓' : i + 1}</span>
                  <span>{s.title}</span>
                  <span className="visually-hidden"> {progress[s.id] ? '(done)' : '(not open yet)'}</span>
                </span>
              </li>
            );
          }
          return (
            <li key={s.id} className={current ? 'current' : undefined}>
              <Link
                to={setupPath(orgId, appId, s)}
                aria-current={current ? 'step' : undefined}
                aria-disabled={disabled || undefined}
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
  const reload = useCallback(async () => {
    setApp((await callApi('getApplication', { orgId, appId })).application);
  }, [orgId, appId]);
  return { app, setApp, error, reload };
}

/** The application with one step's errors replaced by the server's new ones. */
function withStepErrors(app, step, stepErrors) {
  const others = Object.fromEntries(Object.entries(app.errors).filter(([path]) => !(path === step || path.startsWith(`${step}.`))));
  return {
    ...app,
    errors: { ...others, ...stepErrors },
    progress: { ...app.progress, [step]: Object.keys(stepErrors).length === 0 },
  };
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
  const location = useLocation();
  const step = stepByPath(stepPath);
  const { app, setApp, error, reload } = useApplication(orgId, appId);
  const [touched, setTouched] = useState(() => new Set());
  const [navigating, setNavigating] = useState(false);
  const navigationPending = useRef(false);
  const actionArea = useRef(null);
  // Steps whose last save the server refused (saved: false), for example a
  // taken web address. The server keeps the older answer, so the review
  // holds the request until a new answer saves.
  const [refused, setRefused] = useState(() => []);
  const showAll = search.get('check') === '1';

  const { queue, flush, status: saveStatus, error: saveError } = useAutosave({
    save: (value) => callApi('saveApplicationStep', { orgId, appId, step: value.step, answers: value.answers }),
    onResult: (result) => {
      setRefused((prev) => {
        const others = prev.filter((id) => id !== result.step);
        return result.saved === false ? [...others, result.step] : others;
      });
      setApp((prev) => withStepErrors(prev, result.step, result.errors));
    },
  });

  const touch = useCallback((path) => {
    setTouched((prev) => (prev.has(path) ? prev : new Set(prev).add(path)));
  }, []);

  const onChange = useCallback((value, path) => {
    if (!step || !ANSWER_STEPS.includes(step.id)) return;
    touch(path);
    // The field's old error no longer applies. The save brings the current ones.
    setApp((prev) => {
      const { [path]: _edited, ...errors } = prev.errors;
      return { ...prev, errors, answers: { ...prev.answers, [step.id]: value } };
    });
    queue({ step: step.id, answers: value });
  }, [step, touch, setApp, queue]);

  const onConnections = useCallback(({ connections, errors }) => {
    setApp((prev) => ({ ...withStepErrors(prev, 'tickets', errors), connections }));
  }, [setApp]);

  const onOwnersNeeded = useCallback((ownersNeeded) => {
    setApp((prev) => (prev.ownersNeeded === ownersNeeded ? prev : { ...prev, ownersNeeded }));
  }, [setApp]);

  // With ?check=1 the first field with an error takes the focus, once for
  // each visit to the step. Later saves and keystrokes leave the focus alone.
  const focusedVisit = useRef(null);
  useEffect(() => {
    if (!showAll || !app || focusedVisit.current === location.key) return;
    focusedVisit.current = location.key;
    const first = document.querySelector('.step-body [aria-invalid="true"], .step-body [data-group-error]');
    first?.focus?.();
  }, [showAll, app, location.key]);

  const go = useCallback(async (target) => {
    if (navigationPending.current) return;
    navigationPending.current = true;
    setNavigating(true);
    const saved = await flush();
    navigationPending.current = false;
    setNavigating(false);
    if (!saved) {
      // A top step link can be far from the save result on a long form.
      actionArea.current?.focus();
      return;
    }
    navigate(target);
  }, [flush, navigate]);

  const stepErrors = useMemo(() => (app && step ? errorsOfStep(app.errors, step.id) : {}), [app, step]);

  if (!step) return <Navigate to={setupPath(orgId, appId, STEPS[0])} replace />;
  if (error) return <p className="message error" role="alert">{error}</p>;
  if (!app) return <LoadingState long>Loading your setup.</LoadingState>;
  if (!app.canEdit) return <Navigate to={statusPath(orgId, appId)} replace />;
  const open = openStepIds(app, refused);
  if (!open.includes(step.id)) return <Navigate to={setupPath(orgId, appId, stepById(open.at(-1)))} replace />;

  const index = STEPS.indexOf(step);
  const previous = open.includes(STEPS[index - 1]?.id) ? STEPS[index - 1] : null;
  const next = open.includes(STEPS[index + 1]?.id) ? STEPS[index + 1] : null;
  const View = STEP_VIEWS[step.id];
  const shownErrors = visibleErrors(stepErrors, touched, showAll);

  return (
    <div className="setup">
      <StepList
        step={step}
        progress={app.progress}
        open={open}
        orgId={orgId}
        appId={appId}
        disabled={navigating}
        onGo={(e, target) => { e.preventDefault(); go(setupPath(orgId, appId, target)); }}
      />
      <section className="step-body" aria-labelledby="step-title">
        <p className="muted">Step {index + 1} of {STEPS.length}</p>
        <h1 id="step-title" tabIndex={-1}>{step.title}</h1>
        <fieldset disabled={navigating} className="console-feedback-fields">
        {View ? (
          <View
            value={app.answers[step.id]}
            answers={app.answers}
            errors={shownErrors}
            onChange={onChange}
            onBlur={touch}
            app={app}
            orgId={orgId}
            appId={appId}
            flush={flush}
            onConnections={onConnections}
          />
        ) : null}
        {step.id === 'team' ? <TeamStep orgId={orgId} onOwnersNeeded={onOwnersNeeded} /> : null}
        {step.id === 'review' ? (
          <ReviewStep
            app={app}
            answers={app.answers}
            errors={app.errors}
            ownersNeeded={app.ownersNeeded}
            refusedSteps={refused}
            orgId={orgId}
            appId={appId}
          />
        ) : null}
        {step.id === 'agreement' ? (
          <AgreementStep
            app={app}
            orgId={orgId}
            appId={appId}
            onRefresh={reload}
            onAccepted={(result) => navigate(statusPath(orgId, appId), { state: { copyFailed: result.copySent === false } })}
          />
        ) : null}
        </fieldset>
        <div className="console-feedback-actions" ref={actionArea} tabIndex={-1} aria-label="Save and continue">
          {saveStatus === 'error' || saveStatus === 'unsaved' ? (
            <ActionFeedback kind="error">{saveStatusText(saveStatus, saveError)}</ActionFeedback>
          ) : <p className="save-status" role="status" aria-live="polite">{saveStatusText(saveStatus, saveError)}</p>}
          <div className="step-actions">
            {previous ? <button type="button" className="button" disabled={navigating} onClick={() => go(setupPath(orgId, appId, previous))}>Back</button> : null}
            {next ? <button type="button" className="button primary" disabled={navigating} onClick={() => go(setupPath(orgId, appId, next))}>Next</button> : null}
            {saveStatus === 'error' ? <button type="button" className="button" disabled={navigating} onClick={async () => { await flush(); actionArea.current?.focus(); }}>Retry save</button> : null}
          </div>
          <p><Link to={statusPath(orgId, appId)} aria-disabled={navigating || undefined}
            onClick={(event) => { event.preventDefault(); go(statusPath(orgId, appId)); }}>Leave the setup</Link></p>
        </div>
      </section>
    </div>
  );
}
