// The attendee's view of the registration questions (ADR 0008 §4), drawn
// from the unsaved form so an operator sees each change at once. It shows
// the questions, their order, help text, choices and which are required.
// The site's own style applies on the live page; inside the admin only
// admin tokens render (AdminLayout.jsx).
//
// The controls work, so an operator can try an answer, and "Check answers"
// runs the same shared check the server will. Nothing here is saved.
import { useState } from 'react';
import { DIRECTORY_CHOICES, activeQuestions, checkAnswers } from 'shared/registrationForm';
import { FieldError, Notice, TextAreaField, TextField, fieldHintClass, fieldLabelClass, secondaryButtonClass } from './formControls.jsx';

function ChoiceGroup({ question, value, onChange, multiple, error }) {
  const name = `preview-${question.id}`;
  const picked = multiple ? (Array.isArray(value) ? value : []) : value;
  return (
    <fieldset aria-describedby={error ? `${name}-error` : undefined}>
      <legend className={fieldLabelClass}>{question.label}{question.required ? ' (required)' : ''}</legend>
      {question.help ? <p className={fieldHintClass}>{question.help}</p> : null}
      <div className="mt-2xs flex flex-col gap-3xs">
        {question.choices.map((choice) => (
          <label key={choice} className="flex items-center gap-xs text-admin-base text-admin-ink">
            <input
              type={multiple ? 'checkbox' : 'radio'}
              name={name}
              checked={multiple ? picked.includes(choice) : picked === choice}
              onChange={() => onChange(multiple
                ? (picked.includes(choice) ? picked.filter((item) => item !== choice) : [...picked, choice])
                : choice)}
            />
            {choice}
          </label>
        ))}
      </div>
      <FieldError id={`${name}-error`} message={error} />
    </fieldset>
  );
}

/** The value checkAnswers expects, from what the preview controls hold. */
function answerOf(question, value) {
  if (question.kind === 'directory') {
    return DIRECTORY_CHOICES.find((choice) => choice.label === value)?.id;
  }
  if (question.kind === 'yes_no') return value === 'Yes' ? true : value === 'No' ? false : undefined;
  return value;
}

function Question({ question, value, onChange, error }) {
  const label = `${question.label}${question.required ? ' (required)' : ''}`;
  switch (question.kind) {
    case 'short_text':
      return <TextField label={label} hint={question.help || undefined} value={value ?? ''} onChange={onChange} error={error} />;
    case 'long_text':
      return <TextAreaField label={label} hint={question.help || undefined} rows={3} value={value ?? ''} onChange={onChange} error={error} />;
    case 'yes_no':
      return <ChoiceGroup question={{ ...question, choices: ['Yes', 'No'] }} value={value} onChange={onChange} error={error} />;
    case 'one_choice':
    case 'directory':
      return <ChoiceGroup question={question} value={value} onChange={onChange} error={error} />;
    case 'many_choices':
      return <ChoiceGroup question={question} value={value} onChange={onChange} multiple error={error} />;
    case 'dietary': {
      const current = value ?? { choices: [], other: '' };
      return (
        <div className="flex flex-col gap-xs">
          <ChoiceGroup question={question} value={current.choices} onChange={(choices) => onChange({ ...current, choices })} multiple error={error} />
          {current.choices.includes('Other') ? (
            <TextField label="Other dietary need" value={current.other} onChange={(other) => onChange({ ...current, other })} />
          ) : null}
        </div>
      );
    }
    default:
      return null;
  }
}

/** @param {{ form: object }} props the unsaved form */
export default function RegistrationFormPreview({ form }) {
  const questions = activeQuestions(form);
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState(null);
  if (!questions.length) {
    return <p className={fieldHintClass}>No questions are asked. Attendees give their name and email only.</p>;
  }
  function check() {
    const answers = Object.fromEntries(questions.map((question) => [question.id, answerOf(question, values[question.id])]));
    const result = checkAnswers(answers, form);
    setErrors(result.ok ? {} : result.errors);
  }
  return (
    // A section, not a form: the preview sits inside the editor's form.
    <section className="flex flex-col gap-md" aria-label="Preview of the attendee's questions">
      <p className={fieldHintClass}>
        Each attendee on a ticket answers these. Answers about diet and access are private to staff. Nothing you enter here is saved.
      </p>
      {questions.map((question) => (
        <Question
          key={question.id}
          question={question}
          value={values[question.id]}
          onChange={(value) => { setValues((previous) => ({ ...previous, [question.id]: value })); setErrors(null); }}
          error={errors?.[question.id]}
        />
      ))}
      {errors && !Object.keys(errors).length ? <Notice tone="ok" message="These answers pass. An attendee could continue." /> : null}
      <div><button type="button" className={secondaryButtonClass} onClick={check}>Check answers</button></div>
    </section>
  );
}

