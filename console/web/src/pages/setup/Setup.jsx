import PageHeading from '../../PageHeading.jsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
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
import ReviewStep, { Problems } from './ReviewStep.jsx';
import TeamStep from './TeamStep.jsx';
import TicketsStep from './TicketsStep.jsx';
import WebAddressStep from './WebAddressStep.jsx';
import LoadingState from '../../LoadingState.jsx';
import IconControl from '../../IconControl.jsx';
import StepList from '../../setup/StepList.jsx';

const STEP_VIEWS = {
  organization: OrganizationStep,
  event: EventStep,
  webAddress: WebAddressStep,
  tickets: TicketsStep,
  email: EmailStep,
};

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
    try {
      setApp((await callApi('getApplication', { orgId, appId })).application);
      setError('');
    } catch (err) {
      setError(err.message);
      throw err;
    }
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
  const applicationNow = useRef(app);
  applicationNow.current = app;
  const [navigating, setNavigating] = useState(false);
  const navigationPending = useRef(false);
  const actionArea = useRef(null);
  // Steps whose last save the server refused (saved: false), for example a
  // taken web address. The server keeps the older answer, so the review
  // holds the request until a new answer saves.
  const [refused, setRefused] = useState(() => []);
  // The same list, readable right after a save inside go().
  const refusedNow = useRef([]);
  const showAll = search.get('check') === '1';
  const fromReview = search.get('from') === 'review' && (ANSWER_STEPS.includes(step?.id) || step?.id === 'team');

  const { queue, flush, status: saveStatus, error: saveError } = useAutosave({
    save: (value) => callApi('saveApplicationStep', { orgId, appId, step: value.step, answers: value.answers }),
    onResult: (result) => {
      const others = refusedNow.current.filter((id) => id !== result.step);
      refusedNow.current = result.saved === false ? [...others, result.step] : others;
      setRefused(refusedNow.current);
      // go() needs the save response before React renders the new errors.
      applicationNow.current = withStepErrors(applicationNow.current, result.step, result.errors);
      setApp((prev) => withStepErrors(prev, result.step, result.errors));
    },
  });

  const onChange = useCallback((value) => {
    if (!step || !ANSWER_STEPS.includes(step.id)) return;
    setApp((prev) => ({ ...prev, answers: { ...prev.answers, [step.id]: value } }));
    queue({ step: step.id, answers: value });
  }, [step, setApp, queue]);

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

  // Next checks the latest server errors after saving. Returning to Review
  // skips validation but keeps an answer here until the server saves it.
  const go = useCallback(async (target, action = 'next') => {
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
    if (action === 'next' && Object.keys(errorsOfStep(applicationNow.current?.errors, step?.id)).length > 0) {
      navigate(`${setupPath(orgId, appId, step)}?check=1`);
      return;
    }
    if (action !== 'leave' && refusedNow.current.includes(step?.id)) {
      actionArea.current?.focus();
      if (action === 'review') navigate(`${setupPath(orgId, appId, step)}?check=1&from=review`);
      return;
    }
    navigate(target);
  }, [flush, navigate, orgId, appId, step]);

  const stepErrors = useMemo(() => (app && step ? errorsOfStep(app.errors, step.id) : {}), [app, step]);

  if (!step) return <Navigate to={setupPath(orgId, appId, STEPS[0])} replace />;
  if (error && !app) return <ActionFeedback kind="error"><p>{error}</p><IconControl icon="refresh" label="Reload setup" onClick={() => reload().catch(() => {})} /></ActionFeedback>;
  if (!app) return <LoadingState long>Loading your setup.</LoadingState>;
  if (!app.canEdit) return <Navigate to={statusPath(orgId, appId)} replace />;
  const open = openStepIds(app, refused);
  if (!open.includes(step.id)) return <Navigate to={setupPath(orgId, appId, stepById(open.at(-1)))} replace />;

  const index = STEPS.indexOf(step);
  const previous = open.includes(STEPS[index - 1]?.id) ? STEPS[index - 1] : null;
  const next = open.includes(STEPS[index + 1]?.id) ? STEPS[index + 1] : null;
  const View = STEP_VIEWS[step.id];
  const shownErrors = showAll ? stepErrors : {};

  return (
    <div className="setup">
      <StepList
        step={step}
        progress={app.progress}
        open={open}
        orgId={orgId}
        appId={appId}
        disabled={navigating}
        onGo={(e, target) => { e.preventDefault(); go(setupPath(orgId, appId, target), 'leave'); }}
      />
      <section className="step-body" aria-labelledby="step-title">
        <p className="muted">Step {index + 1} of {STEPS.length}</p>
        <div className="step-heading">
          <PageHeading id="step-title" tabIndex={-1}>{step.title}</PageHeading>
          <IconControl icon="close" label="Close setup" to={statusPath(orgId, appId)} aria-disabled={navigating || undefined}
            onClick={(event) => { event.preventDefault(); go(statusPath(orgId, appId), 'leave'); }} />
        </div>
        {error ? <ActionFeedback kind="error"><p>{error}</p><IconControl icon="refresh" label="Reload setup" onClick={() => reload().catch(() => {})} /></ActionFeedback> : null}
        {View && showAll ? <Problems fields={shownErrors} orgId={orgId} appId={appId} fromReview={fromReview} /> : null}
        <fieldset disabled={navigating} className="console-feedback-fields">
        {View ? (
          <View
            value={app.answers[step.id]}
            answers={app.answers}
            errors={shownErrors}
            onChange={onChange}
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
            {previous ? <button type="button" className="button" disabled={navigating} onClick={() => go(setupPath(orgId, appId, previous), 'leave')}>Back</button> : null}
            {fromReview ? <button type="button" className="button primary" disabled={navigating} onClick={() => go(setupPath(orgId, appId, stepById('review')), 'review')}>Back to Review</button>
              : next ? <button type="button" className="button primary" disabled={navigating} onClick={() => go(setupPath(orgId, appId, next))}>Next</button> : null}
            {saveStatus === 'error' ? <button type="button" className="button" disabled={navigating} onClick={async () => { await flush(); actionArea.current?.focus(); }}>Save</button> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
