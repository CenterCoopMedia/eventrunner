// The registration questions an attendee answers (ADR 0008 §4, §5), on the
// public form controls. The logic mirrors the admin preview
// (admin/components/RegistrationFormPreview.jsx); the styling is the site's.
//
// Values are held in the shape checkAnswers reads, so no conversion sits
// between what is typed and what is saved: a directory id, true or false
// for yes or no, { choices, other } for diet, a list for many choices.
import { useId } from 'react';
import { DIRECTORY_CHOICES, LIMITS, activeQuestions, answerText } from 'shared/registrationForm';
import { Checkbox, Radio } from '../forms/Choice.jsx';
import { TextAreaField, TextField } from '../forms/publicForm.jsx';

const YES_NO = [{ value: true, label: 'Yes' }, { value: false, label: 'No' }];

const labelOf = (question) => `${question.label}${question.required ? ' (required)' : ''}`;

/** A fieldset of radios or checkboxes, with its help and its error under it. */
function ChoiceGroup({ question, options, multiple, value, onChange, error, children }) {
  const id = useId();
  const picked = multiple ? (Array.isArray(value) ? value : []) : value;
  const Control = multiple ? Checkbox : Radio;
  const described = [question.help ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ');
  return (
    <fieldset className="min-w-0 space-y-2xs" aria-describedby={described || undefined}>
      <legend className="font-data text-caption font-semibold text-text-primary">{labelOf(question)}</legend>
      {question.help ? <p id={`${id}-hint`} className="text-caption text-text-secondary">{question.help}</p> : null}
      <div className="flex flex-col">
        {options.map((option) => (
          <Control
            key={String(option.value)}
            name={id}
            label={option.label}
            aria-invalid={error ? 'true' : undefined}
            checked={multiple ? picked.includes(option.value) : picked === option.value}
            onChange={() => onChange(multiple
              ? (picked.includes(option.value) ? picked.filter((item) => item !== option.value) : [...picked, option.value])
              : option.value)}
          />
        ))}
      </div>
      {children}
      {error ? <p id={`${id}-error`} className="text-caption text-danger">{error}</p> : null}
    </fieldset>
  );
}

const plain = (choices) => choices.map((choice) => ({ value: choice, label: choice }));

function Question({ question, value, onChange, error }) {
  const hint = question.help || undefined;
  switch (question.kind) {
    case 'phone':
      return <TextField label={labelOf(question)} hint={hint} type="tel" autoComplete="tel" maxLength={LIMITS.phone} value={typeof value === 'string' ? value : answerText(question, value)} onChange={onChange} error={error} />;
    case 'short_text':
      return <TextField label={labelOf(question)} hint={hint} value={value ?? ''} onChange={onChange} error={error} />;
    case 'long_text':
      return <TextAreaField label={labelOf(question)} hint={hint} rows={4} value={value ?? ''} onChange={onChange} error={error} />;
    case 'yes_no':
      return <ChoiceGroup question={question} options={YES_NO} value={value} onChange={onChange} error={error} />;
    case 'directory':
      return <ChoiceGroup question={question} options={DIRECTORY_CHOICES.map((choice) => ({ value: choice.id, label: choice.label }))} value={value} onChange={onChange} error={error} />;
    case 'one_choice':
      return <ChoiceGroup question={question} options={plain(question.choices)} value={value} onChange={onChange} error={error} />;
    case 'many_choices':
      return <ChoiceGroup question={question} options={plain(question.choices)} multiple value={value} onChange={onChange} error={error} />;
    case 'dietary': {
      const current = { choices: [], other: '', ...(value ?? {}) };
      return (
        <ChoiceGroup question={question} options={plain(question.choices)} multiple value={current.choices} onChange={(choices) => onChange({ ...current, choices })} error={error}>
          {current.choices.includes('Other') ? (
            <TextField label="Other dietary need" value={current.other ?? ''} onChange={(other) => onChange({ ...current, other })} />
          ) : null}
        </ChoiceGroup>
      );
    }
    default:
      return null;
  }
}

/**
 * @param {{ form: object, values: object, onChange: (id: string, value: unknown) => void, errors?: Record<string, string> }} props
 */
export default function RegistrationQuestionFields({ form, values, onChange, errors = {} }) {
  return (
    <div className="space-y-lg">
      {activeQuestions(form).map((question) => (
        <Question
          key={question.id}
          question={question}
          value={values?.[question.id]}
          onChange={(value) => onChange(question.id, value)}
          error={errors?.[question.id]}
        />
      ))}
    </div>
  );
}
