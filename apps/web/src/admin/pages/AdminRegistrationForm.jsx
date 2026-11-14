import { plannerError } from '../plannerErrors.js';
import '../plannerFields.css';
// /admin/registration-form: the questions each attendee answers (ADR 0008
// §4). An operator turns the standard questions on or off and makes them
// required, and writes up to 10 questions of their own. The preview beside
// the editor shows the attendee's view of the unsaved form.
//
// SAVING. The shared check (shared/registrationForm) runs here first, so a
// mistake is named on its field without a round trip; the server runs the
// same check. A save carries the revision this page loaded. When someone
// else saved first, the server refuses it and the page offers the current
// version; the unsaved edits stay on the page until then.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MAX_CUSTOM_QUESTIONS, STANDARD_QUESTIONS, readRegistrationForm, validateRegistrationForm,
} from 'shared/registrationForm';
import { subscribeRegistrationForm } from '../../lib/registrationFormSource.js';
import { useAdminApi } from '../adminApi.js';
import AdminPageHeader, { AdminLoadingState } from '../components/adminChrome.jsx';
import RegistrationFormPreview from '../components/RegistrationFormPreview.jsx';
import RegistrationQuestionEditor, { isChoiceKind, newQuestion } from '../components/RegistrationQuestionEditor.jsx';
import {
  CheckboxField, Notice, Panel, SaveStatus, ServerErrorSummary, fieldHintClass, primaryButtonClass, secondaryButtonClass,
} from '../components/formControls.jsx';

const FORM_ID = 'registration-form-editor';

/** The stored form as editor state: custom choices as one line each. */
function toDraft(stored) {
  const form = readRegistrationForm(stored);
  return {
    revision: form.revision,
    standard: form.standard,
    custom: form.custom.map((question) => ({ ...question, choicesText: question.choices.join('\n') })),
  };
}

/** Editor state as the form the shared check and the server read. */
function toForm(draft) {
  return {
    standard: draft.standard,
    custom: draft.custom.map(({ choicesText, ...question }) => ({
      ...question,
      choices: isChoiceKind(question.kind) ? choicesText.split('\n').map((line) => line.trim()).filter(Boolean) : [],
    })),
  };
}

/** `field: reason` segments, as the admin error summary reads them. */
/** The wording attendees see, when it adds to the question's name. */
function attendeeWording({ name, label, help }) {
  return [label === name ? '' : `“${label}”`, help].filter(Boolean).join(' ');
}

function clientError(errors) {
  const fieldErrors = errors.map((segment) => {
    const [field, ...parts] = segment.split(':');
    const question = field.match(/^custom\.(\d+)/);
    const name = question ? `Question ${Number(question[1]) + 1}` : 'Registration form';
    const reason = parts.join(':').trim();
    return { field, message: `${name}: ${reason === 'required' ? 'Enter a question.' : reason.replace(/^./, (letter) => letter.toUpperCase())}` };
  });
  return { message: fieldErrors.map((entry) => entry.message).join(' '), fieldErrors };
}

export default function AdminRegistrationForm() {
  const call = useAdminApi();
  const [live, setLive] = useState(undefined);
  const [listError, setListError] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState('');
  const errorRef = useRef(null);
  useEffect(() => subscribeRegistrationForm((data) => { setLive(data); setListError(null); }, setListError), []);
  // The first snapshot seeds the editor; later ones only raise the notice.
  useEffect(() => { if (live !== undefined && draft === null) setDraft(toDraft(live)); }, [live, draft]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  const fieldErrors = useMemo(() => {
    const map = new Map();
    for (const segment of error?.fieldErrors ?? []) if (segment.field && !map.has(segment.field)) map.set(segment.field, segment.message);
    return map;
  }, [error]);
  // A choice's own error (custom.0.choices.1) shows on its choices box.
  const errorFor = (field) => fieldErrors.get(field) ?? [...fieldErrors].find(([key]) => key.startsWith(`${field}.`))?.[1];

  if (live === undefined || draft === null) return listError
    ? <Notice tone="caution" message="The registration form did not load. Check your connection. Reconnecting…" />
    : <AdminLoadingState label="Loading the registration form…" />;

  const liveRevision = readRegistrationForm(live).revision;
  const conflict = liveRevision !== draft.revision;
  const form = toForm(draft);
  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(toDraft(live)));

  const edit = (patch) => { setDraft((previous) => ({ ...previous, ...patch })); setResult(''); };
  const setStandard = (id, patch) => edit({ standard: { ...draft.standard, [id]: { ...draft.standard[id], ...patch } } });
  // A saved question that changes its answer type becomes a new question
  // with a new id: answers already given to the old one keep their meaning.
  const savedIds = new Set(readRegistrationForm(live).custom.map((question) => question.id));
  const setCustom = (index, patch) => edit({
    custom: draft.custom.map((question, i) => {
      if (i !== index) return question;
      const retyped = patch.kind && patch.kind !== question.kind && savedIds.has(question.id);
      return { ...question, ...patch, ...(retyped ? { id: newQuestion().id } : {}) };
    }),
  });
  const moveCustom = (index, by) => {
    const custom = [...draft.custom];
    const [moved] = custom.splice(index, 1);
    custom.splice(index + by, 0, moved);
    edit({ custom });
  };

  async function save(event) {
    event.preventDefault();
    if (busy || conflict) return;
    const checked = validateRegistrationForm(form);
    if (!checked.ok) { setError(clientError(checked.errors)); return; }
    setBusy(true); setError(null); setResult('');
    try {
      const response = await call('updateRegistrationForm', { expectedRevision: draft.revision, form: checked.form });
      setDraft((previous) => ({ ...previous, revision: response.revision }));
      setResult('Registration form saved.');
    } catch (err) { setError(plannerError(err)); } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-md [overflow-wrap:anywhere]">
      <AdminPageHeader
        title="Registration form"
        description="The questions each attendee answers when they register. Phone numbers, diet and access answers are private to staff."
        // The editor form is named here: the preview sits outside it, so Enter
        // in a preview answer can never save the form.
        actions={<button type="submit" form={FORM_ID} className={primaryButtonClass} disabled={busy || conflict || !dirty}>{busy ? 'Saving…' : 'Save'}</button>}
      />
      <p className={fieldHintClass}>For Stripe tickets, attendees answer the Registration form questions at checkout after you publish tickets; other attendees answer on Complete your registration.</p>
      {listError ? <Notice tone="caution" message="The saved form did not load. Trying again…" /> : null}
      {conflict ? (
        <div className="flex flex-col gap-xs">
          <Notice tone="caution" message="Someone saved the registration form after you opened it. Your unsaved changes are still below. Load the current version to continue." />
          <div><button type="button" className={secondaryButtonClass} onClick={() => { setDraft(toDraft(live)); setError(null); setResult('Current version loaded.'); }}>Load the current version</button></div>
        </div>
      ) : null}
      <ServerErrorSummary error={error} errorRef={errorRef} title="The form could not be saved" />
      {result ? <SaveStatus message={result} /> : null}

      <div className="planner-fields grid items-start gap-md xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <form id={FORM_ID} onSubmit={save} noValidate className="min-w-0">
        <fieldset disabled={busy} className="flex min-w-0 flex-col gap-md">
          <Panel title="Standard questions" description="Choose which questions to ask and which answers are required.">
            <ul className="flex flex-col gap-sm">
              {STANDARD_QUESTIONS.map((question) => {
                const entry = draft.standard[question.id];
                return (
                  <li key={question.id} className="flex flex-col gap-2xs border-admin-rule-hairline border-b-admin-hairline pb-sm last:border-b-0 last:pb-0">
                    <p className="font-semibold text-admin-ink">{question.name}{question.sensitive ? ' (private to staff)' : ''}</p>
                    {attendeeWording(question) ? <p className={fieldHintClass}>{attendeeWording(question)}</p> : null}
                    {/* The question's name shows once, above. Screen readers hear it on each box. */}
                    <div className="flex flex-wrap gap-md">
                      <CheckboxField label="Ask" aria-label={`Ask: ${question.name}`} checked={entry.enabled} onChange={(enabled) => setStandard(question.id, { enabled, required: enabled && entry.required })} />
                      <CheckboxField label="Required" aria-label={`Required: ${question.name}`} checked={entry.required} disabled={!entry.enabled} onChange={(required) => setStandard(question.id, { required })} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel
            title="Your questions"
            description={`Up to ${MAX_CUSTOM_QUESTIONS}. Attendees see them after the standard questions, in this order.`}
            actions={(
              <button type="button" className={secondaryButtonClass} disabled={draft.custom.length >= MAX_CUSTOM_QUESTIONS} onClick={() => edit({ custom: [...draft.custom, newQuestion()] })}>
                Add a question
              </button>
            )}
          >
            {draft.custom.length ? (
              <ol className="flex flex-col gap-md" aria-label="Your questions">
                {draft.custom.map((question, index) => (
                  <RegistrationQuestionEditor
                    key={question.id}
                    question={question}
                    index={index}
                    count={draft.custom.length}
                    errorFor={errorFor}
                    onChange={(patch) => setCustom(index, patch)}
                    onMove={(by) => moveCustom(index, by)}
                    onRemove={() => edit({ custom: draft.custom.filter((_, i) => i !== index) })}
                  />
                ))}
              </ol>
            ) : <p className={fieldHintClass}>Add a question to ask attendees about your event.</p>}
          </Panel>
        </fieldset>
        </form>

        <Panel title="Preview" description="Try the questions as an attendee.">
          <RegistrationFormPreview form={form} />
        </Panel>
      </div>
    </div>
  );
}
