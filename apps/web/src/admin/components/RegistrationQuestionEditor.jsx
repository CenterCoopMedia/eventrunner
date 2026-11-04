// One custom registration question in the operator's editor (ADR 0008 §4).
// Choices are written one per line; the shared check trims them and refuses
// a repeat or a list shorter than two.
import { CUSTOM_KINDS, LIMITS, MAX_CHOICES } from 'shared/registrationForm';
import { CheckboxField, SelectField, TextAreaField, TextField, ghostButtonClass } from './formControls.jsx';

export const KIND_LABELS = Object.freeze({
  short_text: 'Short answer',
  long_text: 'Long answer',
  one_choice: 'One choice',
  many_choices: 'Several choices',
  yes_no: 'Yes or no',
});

export const isChoiceKind = (kind) => kind === 'one_choice' || kind === 'many_choices';

/** A new question with a fresh id the shared check accepts. */
export function newQuestion() {
  const id = `q_${Math.random().toString(36).slice(2, 10).padEnd(8, '0')}`;
  return { id, kind: 'short_text', label: '', help: '', choices: [], required: false, choicesText: '' };
}

/**
 * @param {{ question: object, index: number, count: number, errorFor: (field: string) => string|undefined,
 *           onChange: (patch: object) => void, onMove: (by: number) => void, onRemove: () => void }} props
 */
export default function RegistrationQuestionEditor({ question, index, count, errorFor, onChange, onMove, onRemove }) {
  const at = `custom.${index}`;
  const name = question.label.trim() || `Question ${index + 1}`;
  return (
    <li className="flex flex-col gap-sm border-admin-rule-hairline border-b-admin-hairline pb-md last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-xs">
        <h3 className="font-admin-ui text-admin-base font-semibold text-admin-ink">{index + 1}. {name}</h3>
        <div className="flex flex-wrap gap-2xs" role="group" aria-label={`Arrange ${name}`}>
          <button type="button" className={ghostButtonClass} onClick={() => onMove(-1)} disabled={index === 0} aria-label={`Move ${name} up`}>Move up</button>
          <button type="button" className={ghostButtonClass} onClick={() => onMove(1)} disabled={index === count - 1} aria-label={`Move ${name} down`}>Move down</button>
          <button type="button" className={ghostButtonClass} onClick={onRemove} aria-label={`Remove ${name}`}>Remove</button>
        </div>
      </div>
      <div className="grid gap-sm sm:grid-cols-2">
        <TextField label="Question" value={question.label} onChange={(label) => onChange({ label })} maxLength={LIMITS.label} required error={errorFor(`${at}.label`)} />
        <SelectField
          label="Answer type"
          value={question.kind}
          onChange={(kind) => onChange({ kind })}
          options={CUSTOM_KINDS.map((kind) => ({ value: kind, label: KIND_LABELS[kind] }))}
          error={errorFor(`${at}.kind`)}
        />
      </div>
      <TextField label="Help text (optional)" value={question.help} onChange={(help) => onChange({ help })} maxLength={LIMITS.help} error={errorFor(`${at}.help`)} />
      {isChoiceKind(question.kind) ? (
        <TextAreaField
          label="Choices"
          hint={`One per line, 2 to ${MAX_CHOICES}.`}
          rows={4}
          value={question.choicesText}
          onChange={(choicesText) => onChange({ choicesText })}
          error={errorFor(`${at}.choices`)}
        />
      ) : null}
      <CheckboxField label="Required" checked={question.required} onChange={(required) => onChange({ required })} />
    </li>
  );
}
