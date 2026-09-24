// The event's milestones (issue #180): config/event.milestones, edited on
// the event settings page and listed on the overview with the days left
// until each one.
//
// `milestones` is `{ label, date }[]`, at most MAX_MILESTONES of them
// (shared/config). The overview sorts them, so the order here is only the
// order they were typed in.
//
// The rows follow the repeater the Days and the social accounts use: a
// labelled field per value, an add control in the panel head, a remove
// control per row, and focus moved to a control that still exists after a
// row goes. "Add milestone" moves focus into the new row's name field;
// "Remove" moves it to the name field of the row that takes the removed
// row's place, else the row above, else "Add milestone". At the limit the
// add control stays focusable and says why it does nothing: aria-disabled,
// a refused press, and a hint that names the limit (interface guidelines,
// Disabled).
//
// THE CHECK RUNS AT SUBMIT (issue #219), the way the social accounts' does:
// validateMilestoneRows below is called from AdminEventSettings's submit,
// which marks the fields, moves focus to the first one, and sends nothing.
// The server's refusals (`milestones[0].date: …`) mark the same fields,
// because both are keyed by the path the shared validator names.
//
// config/event is public: anyone can read it, and the site bundle carries
// it. The panel says so, so a private note never goes in a milestone name.
import { useId, useRef, useState } from 'react';
import { MAX_MILESTONES, MAX_MILESTONE_LABEL_LENGTH } from 'shared/config';
import {
  FieldError,
  Panel,
  TextField,
  dangerButtonClass,
  fieldHintClass,
  secondaryButtonClass,
  unavailableButtonClass,
} from './formControls.jsx';

const EMPTY_MILESTONES = Object.freeze([]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const blankMilestone = () => ({ label: '', date: '' });

/**
 * The stored milestones as form rows: every value a string, so each field
 * is controlled from the first render.
 *
 * @param {unknown} milestones config/event.milestones
 * @returns {Array<{ label: string, date: string }>}
 */
export function normalizeMilestones(milestones) {
  if (!Array.isArray(milestones)) return [];
  return milestones
    .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
    .map((entry) => ({
      label: typeof entry.label === 'string' ? entry.label : '',
      date: typeof entry.date === 'string' ? entry.date : '',
    }));
}

/**
 * The rows as the stored list, each name trimmed. An empty list is sent as
 * an empty list, which clears the stored one.
 *
 * @param {Array<{ label: string, date: string }>} rows
 * @returns {Array<{ label: string, date: string }>}
 */
export function milestonesPayload(rows) {
  return (rows ?? []).map((row) => ({
    label: String(row.label ?? '').trim(),
    date: String(row.date ?? '').trim(),
  }));
}

/**
 * Every problem with the rows, keyed by the field path the server names, so
 * a server refusal and this one mark the same field.
 *
 * @param {Array<{ label: string, date: string }>} rows
 * @returns {Map<string, string>} field path → message
 */
export function validateMilestoneRows(rows) {
  const errors = new Map();
  for (const [index, row] of (rows ?? []).entries()) {
    const at = `milestones[${index}]`;
    const label = String(row.label ?? '').trim();
    if (!label) {
      errors.set(`${at}.label`, 'Enter a name for this milestone.');
    } else if (label.length > MAX_MILESTONE_LABEL_LENGTH) {
      errors.set(`${at}.label`, `Use ${MAX_MILESTONE_LABEL_LENGTH} characters or fewer.`);
    }
    if (!DATE_RE.test(String(row.date ?? '').trim())) {
      errors.set(`${at}.date`, 'Enter the date of this milestone.');
    }
  }
  return errors;
}

function afterRender(callback) {
  setTimeout(callback, 0);
}

/**
 * @param {object} props
 * @param {Array<{ label: string, date: string }>} props.milestones the form's rows
 * @param {(rows: Array<object>) => void} props.onChange replaces the rows
 * @param {(field: string) => string|undefined} props.errorFor
 */
export default function MilestonesEditor({ milestones, onChange, errorFor }) {
  const [notice, setNotice] = useState('');
  const listRef = useRef(null);
  const addRef = useRef(null);
  const limitId = useId();
  const rows = milestones ?? EMPTY_MILESTONES;
  const full = rows.length >= MAX_MILESTONES;

  const nameFieldAt = (index) =>
    listRef.current?.children?.[index]?.querySelector('input') ?? null;

  const changeRow = (index, patch) =>
    onChange(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));

  const addRow = () => {
    // Refused at the limit, whatever activated it: the control stays
    // focusable so the hint under it can say why.
    if (full) return;
    const index = rows.length;
    onChange([...rows, blankMilestone()]);
    setNotice('');
    afterRender(() => nameFieldAt(index)?.focus());
  };

  const removeRow = (index) => {
    onChange(rows.filter((_, rowIndex) => rowIndex !== index));
    setNotice('The milestone will be removed when you save.');
    afterRender(() => (nameFieldAt(index) ?? nameFieldAt(index - 1) ?? addRef.current)?.focus());
  };

  return (
    <Panel
      title="Milestones"
      description="Dates the overview counts down to, such as the day proposals close. Anyone can read these dates and names. Keep private notes out of them."
      actions={
        <button
          ref={addRef}
          type="button"
          className={`${secondaryButtonClass} ${unavailableButtonClass}`}
          onClick={addRow}
          aria-disabled={full || undefined}
          aria-describedby={full ? limitId : undefined}
        >
          Add milestone
        </button>
      }
    >
      <div className="flex flex-col gap-sm">
        {full ? (
          <p id={limitId} className={fieldHintClass}>
            An event can list {MAX_MILESTONES} milestones. Remove one to add another.
          </p>
        ) : null}
        <FieldError message={errorFor('milestones')} />
        {notice ? (
          <p role="status" className="text-admin-sm text-admin-ink-secondary">
            {notice}
          </p>
        ) : null}
        {rows.length === 0 ? (
          <p className="text-admin-sm text-admin-ink-secondary">No milestones yet.</p>
        ) : (
          <ol ref={listRef} className="flex flex-col">
            {rows.map((row, index) => (
              <li
                key={index}
                className="mt-sm border-admin-rule-hairline border-t-admin-hairline pt-sm first:mt-0 first:border-t-0 first:pt-0"
              >
                <div className="grid gap-sm sm:grid-cols-2">
                  <TextField
                    label={`Milestone ${index + 1} name`}
                    value={row.label}
                    onChange={(value) => changeRow(index, { label: value })}
                    error={errorFor(`milestones[${index}].label`) ?? errorFor(`milestones[${index}]`)}
                    maxLength={MAX_MILESTONE_LABEL_LENGTH}
                    hint="Such as Proposals close."
                  />
                  <TextField
                    label={`Milestone ${index + 1} date`}
                    type="date"
                    value={row.date}
                    onChange={(value) => changeRow(index, { date: value })}
                    error={errorFor(`milestones[${index}].date`)}
                  />
                </div>
                <button
                  type="button"
                  className={`${dangerButtonClass} mt-sm`}
                  onClick={() => removeRow(index)}
                >
                  Remove milestone {index + 1}
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Panel>
  );
}
