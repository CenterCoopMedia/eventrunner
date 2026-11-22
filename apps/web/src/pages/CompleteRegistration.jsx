// Complete your registration (ADR 0008 §5) — /registration.
//
// After sign-in an attendee answers the event's registration questions:
// one Questions step for each valid ticket they hold (or one for their
// account when the event sells no tickets), then Review. Each Next checks
// the answers with the shared check first, so most mistakes show on the
// field without a round trip, then saves through saveTicketAnswers.
//
// The questions are pinned when the page loads, so they do not shift while
// someone types. When the server says they changed, the page takes the new
// form and keeps every answer whose question is still asked.
import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { PublicLink as Link } from '../components/PublicLink.jsx';
import { activeQuestions, answerText, answeredQuestions, checkAnswers, readRegistrationForm } from 'shared/registrationForm';
import { useAuth } from '../contexts/AuthContext.jsx';
import { usePublicLanguage } from '../contexts/PublicLanguageContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import SignInPanel from '../components/SignInPanel.jsx';
import { StepHeading, StepList, StepPager, resolveStep, useStepHeadingFocus } from '../components/forms/Stepper.jsx';
import { focusFirstError } from '../components/forms/publicForm.jsx';
import RegistrationQuestionFields from '../components/registration/RegistrationQuestionFields.jsx';
import { primaryActionClass, secondaryActionClass } from '../components/controlClasses.js';
import { saveRegistrationAnswers } from '../lib/registrationAnswersApi.js';
import { newSubmissionKey } from '../lib/submissionKey.js';
import { useDocumentTitle } from '../lib/useDocumentTitle.js';
import useLoadingStage from '../lib/useLoadingStage.js';
import { useRegistrationTargets } from '../lib/useRegistrationTargets.js';
import { useMediaQuery, WIDE_VIEWPORT } from '../lib/viewport.js';

const hrefFor = (step) => `/registration/${step.slug}`;
const noteClass = 'border-hairline border-rule-hairline bg-surface-alt px-sm py-xs font-data text-caption text-text-primary';
const FORM_CHANGED_NOTE = 'The questions changed while you were answering. Check the questions below, then continue. Your answers to questions that are still asked are kept.';

/** Only the answers the form still asks, so a removed question is never sent. */
function pick(values, form) {
  const ids = new Set(activeQuestions(form).map((question) => question.id));
  return Object.fromEntries(Object.entries(values ?? {}).filter(([id]) => ids.has(id)));
}

/** `answers.<id>: reason; ...` from the server, as errors per question. */
function fieldErrorsOf(message) {
  const errors = {};
  for (const part of String(message ?? '').split(/;\s*/)) {
    const match = /^answers\.([^:]+):\s*(.+)$/.exec(part.trim());
    if (match) errors[match[1]] = match[2];
  }
  return Object.keys(errors).length ? errors : null;
}

/** A saved record's answers, each read with the question as it was answered. */
function AnswerList({ form, record }) {
  const answered = Array.isArray(record?.questions) ? record.questions : [];
  return (
    <dl className="space-y-xs">
      {activeQuestions(form).map((question) => (
        <div key={question.id}>
          <dt className="font-data text-caption font-semibold text-text-secondary">{question.label}</dt>
          <dd className="text-body text-text-primary">{answerText(question, record?.answers?.[question.id], answered.find((entry) => entry.id === question.id)) || 'Not answered'}</dd>
        </div>
      ))}
    </dl>
  );
}

function Shell({ children }) {
  return (
    <article className="w-full space-y-lg">
      <header className="space-y-xs">
        <h1 className="wrap-anywhere font-heading text-h1 font-semibold text-text-primary">Complete your registration</h1>
        <p className="max-w-prose text-body text-text-secondary">The organizers ask everyone attending a few questions. Each step saves when you move on.</p>
      </header>
      {children}
    </article>
  );
}

export default function CompleteRegistration() {
  useDocumentTitle('Complete your registration');
  const { language } = usePublicLanguage();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { stepSlug } = useParams();
  const wide = useMediaQuery(WIDE_VIEWPORT);
  const headingRef = useStepHeadingFocus(stepSlug);
  const data = useRegistrationTargets(user);
  const [pinnedForm, setPinnedForm] = useState(null);
  const [formStale, setFormStale] = useState(false);
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState('');
  const [closed, setClosed] = useState(false);
  const [saving, setSaving] = useState(null);
  const [saveUnconfirmed, setSaveUnconfirmed] = useState(null);
  const [errorTick, setErrorTick] = useState(0);
  const formRef = useRef(null);
  const saveRef = useRef(null);
  const currentStep = useRef(stepSlug);
  currentStep.current = stepSlug;
  const { stage: saveStage } = useLoadingStage({ active: Boolean(saving), phase: saving, action: true, report: false });
  const saveUnknown = saveUnconfirmed ?? (saveStage === 'prolonged' ? saving?.attempt : null);
  const form = pinnedForm ?? data.form;

  useEffect(() => {
    setSaving(null);
    setSaveUnconfirmed(null);
    return () => { saveRef.current = null; };
  }, [user?.uid]);

  useEffect(() => {
    if (!pinnedForm && data.form) setPinnedForm(data.form);
  }, [pinnedForm, data.form]);

  // After a form-changed refusal, take the live form once it is newer.
  useEffect(() => {
    if (!formStale || !data.form) return;
    if (readRegistrationForm(data.form).revision !== readRegistrationForm(pinnedForm).revision) {
      setPinnedForm(data.form);
      setFormStale(false);
    }
  }, [formStale, data.form, pinnedForm]);

  useEffect(() => {
    if (errorTick) focusFirstError(formRef.current);
  }, [errorTick]);

  if (loading) return <div className="mt-lg"><LoadingState label="Checking your sign-in…" /></div>;

  if (!user) {
    // Inline, like the speaker profile: signing in re-renders this page.
    return (
      <article className="mx-auto max-w-md">
        <h1 className="font-heading text-h1 font-semibold text-text-primary">Sign in to continue</h1>
        <p className="mt-xs max-w-prose text-body text-text-secondary text-pretty">
          Your registration answers belong to your account. Sign in below to answer the organizers’ questions.
        </p>
        <div className="mt-lg"><SignInPanel /></div>
      </article>
    );
  }

  // A form that asks nothing needs no tickets read first.
  if (data.form !== undefined && form !== null && !activeQuestions(form).length && data.status !== 'error') {
    return <NothingToAnswer />;
  }
  if (data.status === 'error') {
    return (
      <EmptyState
        title="Your registration could not be loaded"
        description={data.error}
        action={<button type="button" className={primaryActionClass} onClick={data.retry}>Try again</button>}
      />
    );
  }
  if (data.status === 'loading') return (
    <div className="mt-lg"><LoadingState label="Loading your registration…" phase={data.form === undefined} recover onRetry={data.retry} /></div>
  );
  if (!form || !activeQuestions(form).length) return <NothingToAnswer />;

  const { targets, saved } = data;
  if (!targets.length) {
    return (
      <EmptyState
        title="You need a ticket first"
        description="The questions are answered for each ticket you hold. Claim or buy a ticket, then come back here."
        action={<Link to="/tickets/mine" className={primaryActionClass}>Go to your tickets</Link>}
      />
    );
  }

  const valuesFor = (target) => values[target.id] ?? saved[target.id]?.answers ?? {};
  const allSaved = targets.every((target) => saved[target.id]);

  if (closed) {
    return (
      <Shell>
        <p role="status" className={noteClass}>Registration has closed, so answers can no longer be changed. These are the answers the organizers have.</p>
        {targets.map((target) => (
          <section key={target.id} className="space-y-sm">
            <h2 className="font-heading text-h3 font-semibold text-text-primary">{target.label}</h2>
            {saved[target.id] ? <AnswerList form={form} record={saved[target.id]} /> : <p className="text-body text-text-secondary">No answers were saved.</p>}
          </section>
        ))}
      </Shell>
    );
  }

  const steps = [
    ...targets.map((target, index) => ({
      slug: `answers-${index + 1}`,
      title: targets.length === 1 ? 'Your answers' : target.label,
      target,
      state: saved[target.id] ? 'done' : 'todo',
    })),
    { slug: 'review', title: 'Review', state: allSaved ? 'done' : 'todo' },
  ];
  const { index: current, unknown } = resolveStep(steps, stepSlug, 0);
  if (unknown) return <Navigate to="/registration" replace />;
  const step = steps[current];
  const review = step.slug === 'review';

  const setAnswer = (target, id, value) => {
    setValues((previous) => ({ ...previous, [target.id]: { ...(previous[target.id] ?? saved[target.id]?.answers ?? {}), [id]: value } }));
    setErrors((previous) => {
      if (!previous[target.id]?.[id]) return previous;
      const { [id]: _cleared, ...rest } = previous[target.id];
      return { ...previous, [target.id]: rest };
    });
  };

  function showErrors(target, fieldErrors) {
    setErrors((previous) => ({ ...previous, [target.id]: fieldErrors }));
    setErrorTick((value) => value + 1);
  }

  async function sendSave(attempt) {
    const { target, request, submittedForm, submittedStep, next } = attempt;
    const send = { attempt };
    saveRef.current = send;
    setSaving(send);
    setSaveUnconfirmed(null);
    try {
      const result = await saveRegistrationAnswers(request);
      if (saveRef.current !== send) return;
      // A connection can drop after the response headers. The API client
      // returns an empty object when it cannot parse a successful response.
      if (result?.formRevision !== request.formRevision || result.answerRevision !== (request.expectedAnswerRevision ?? 0) + 1
          || !result.answers || typeof result.answers !== 'object' || Array.isArray(result.answers)) {
        setSaveUnconfirmed(attempt);
        return;
      }
      const { answers, formRevision, answerRevision } = result;
      // Keep the questions as answered even if the live form has changed.
      data.setSaved(target.id, { answers, formRevision, answerRevision, questions: answeredQuestions(submittedForm, answers) });
      setErrors((previous) => ({ ...previous, [target.id]: {} }));
      setNotice('');
      if (currentStep.current === submittedStep) navigate(next);
    } catch (error) {
      if (saveRef.current !== send) return;
      if (error?.code === 'network' || error?.status >= 500) {
        setSaveUnconfirmed(attempt);
        return;
      }
      if (error?.code === 'form-changed') {
        setNotice(FORM_CHANGED_NOTE);
        setFormStale(true);
      } else if (error?.code === 'registration-closed') {
        setClosed(true);
      } else if (error?.code === 'bad-request' && fieldErrorsOf(error.message)) {
        showErrors(target, fieldErrorsOf(error.message));
      } else {
        setFailure(`${error?.message || 'Your answers could not be saved.'} Your answers are still here.`);
      }
    } finally {
      if (saveRef.current === send) {
        saveRef.current = null;
        setSaving(null);
      }
    }
  }

  function goNext() {
    if (saveRef.current || saveUnconfirmed || review) return;
    const { target } = step;
    setFailure('');
    const checked = checkAnswers(pick(valuesFor(target), form), form);
    if (!checked.ok) { showErrors(target, checked.errors); return; }
    const record = saved[target.id];
    sendSave({
      target, submittedForm: form, submittedStep: stepSlug, next: hrefFor(steps[current + 1]),
      request: {
        user, ticketId: target.ticketId, account: target.account, answers: checked.answers, language,
        formRevision: readRegistrationForm(form).revision, requestId: newSubmissionKey(),
        expectedAnswerRevision: record ? (record.answerRevision ?? 0) : null,
      },
    });
  }

  return (
    <Shell>
      <div className="grid items-start gap-lg lg:grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)]">
        <StepList steps={steps} current={current} hrefFor={hrefFor} wide={wide} label="Registration steps" />
        <section className="min-w-0 space-y-md border-hairline border-rule-hairline bg-surface-alt p-md sm:p-lg" aria-labelledby="registration-step-heading">
          <StepHeading index={current} total={steps.length} title={step.title} headingRef={headingRef} headingId="registration-step-heading" />
          {notice ? <p role="status" className={noteClass}>{notice}</p> : null}
          {failure ? <p role="alert" className="font-data text-caption text-danger">{failure}</p> : null}
          {saveUnknown ? (
            <div className="space-y-xs">
              <p role="status" className={noteClass}>We don’t know whether your answers were saved. Your entries are still on this page.</p>
              <button type="button" className={secondaryActionClass} onClick={() => {
                if (saveRef.current === saving) sendSave(saveUnknown);
              }}>Try saving again</button>
              {saveUnknown.target.ticketId ? (
                <Link to="/tickets/mine" target="_blank" rel="noopener" className={secondaryActionClass}>View your tickets (opens in a new tab)</Link>
              ) : null}
            </div>
          ) : null}
          {review ? (
            <div className="space-y-lg">
              {allSaved && !saveUnknown ? <p role="status" className={noteClass}>Your answers are saved. You can change them until registration closes.</p> : null}
              {steps.filter((item) => item.target).map((item) => (
                <section key={item.slug} className="space-y-sm">
                  {targets.length > 1 ? <h3 className="font-heading text-h3 font-semibold text-text-primary">{item.target.label}</h3> : null}
                  {saved[item.target.id] ? (
                    <AnswerList form={form} record={saved[item.target.id]} />
                  ) : (
                    <p className="text-body text-text-secondary">
                      {saveUnknown ? 'No saved answers shown.' : 'Not saved yet.'} <Link to={hrefFor(item)} className="font-medium text-accent hover:underline">Answer these questions</Link>
                    </p>
                  )}
                </section>
              ))}
            </div>
          ) : (
            <form ref={formRef} noValidate onSubmit={(event) => { event.preventDefault(); goNext(); }}>
              <fieldset disabled={Boolean(saving || saveUnconfirmed)} className="min-w-0">
                <RegistrationQuestionFields
                  key={step.slug}
                  form={form}
                  values={valuesFor(step.target)}
                  errors={errors[step.target.id]}
                  onChange={(id, value) => setAnswer(step.target, id, value)}
                />
              </fieldset>
            </form>
          )}
          <StepPager
            previous={steps[current - 1]}
            next={review || saving || saveUnconfirmed ? null : steps[current + 1]}
            hrefFor={hrefFor}
            backClass={secondaryActionClass}
            nextClass={primaryActionClass}
            onNext={goNext}
            last={review ? <Link to="/dashboard" className={primaryActionClass}>Back to your dashboard</Link>
              : saving && !saveUnknown ? <p role="status">Saving your answers…</p> : null}
          />
        </section>
      </div>
    </Shell>
  );
}

function NothingToAnswer() {
  return (
    <EmptyState
      title="Nothing to answer"
      description="The organizers have not asked any registration questions."
      action={<Link to="/dashboard" className={primaryActionClass}>Go to your dashboard</Link>}
    />
  );
}
