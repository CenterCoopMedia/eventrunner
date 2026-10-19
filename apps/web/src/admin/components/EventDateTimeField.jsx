import { useEffect, useId, useRef, useState } from 'react';
import { Radio } from '../../components/forms/Choice.jsx';
import {
  describeEventDateTime, describeTimeZone, formatCalendarDate, formatShift, formatUtcOffset,
  formatWallClock, isKnownTimeZone, resolveEventDateTime, splitEventDateTime, toStoredInstant,
} from '../../lib/eventDateTime.js';
import { FieldError, fieldHintClass, fieldLabelClass, inputClass, secondaryButtonClass } from './formControls.jsx';

// A date and a time on the event's clock, stored as one RFC3339 instant
// (issue #476). Staff pick an ordinary date and time; the line under the
// inputs names the event's zone, and the summary states the result in words
// with the zone and the UTC offset in force on the chosen date.
//
// The control never moves a time on its own. A time the clocks skip is
// refused with the reason. A time the clocks pass twice asks which one.
// Until either is settled the control reports a problem, and the form that
// owns it refuses to save (validate on submit, focus the field).

const NO_FIELDS = { date: '', time: '', choice: null };
// The legend names the instant; the two part labels sit one step under it.
const partLabelClass = 'text-admin-sm font-medium text-admin-ink';

function fieldsFrom(value, timeZone) {
  const split = splitEventDateTime(value, timeZone);
  if (!split) return NO_FIELDS;
  const resolved = resolveEventDateTime(split.date, split.time, timeZone);
  // A stored instant inside a repeated hour already says which one it is.
  const choice = resolved.status === 'overlap' ? resolved.candidates.find((candidate) => toStoredInstant(candidate.instant) === new Date(Date.parse(value)).toISOString())?.offset ?? null : null;
  return { ...split, choice };
}

/**
 * Read the fields: the instant they name, or the problem that stops a save.
 *
 * @returns {{ value: string|null, instant: Date|null, problem: string|null, state: object|null }}
 */
export function readEventDateTimeFields({ date, time, choice }, timeZone, { required = false } = {}) {
  if (!date && !time) return { value: null, instant: null, problem: required ? 'Enter a date and a time.' : null, state: null };
  if (!date) return { value: null, instant: null, problem: 'Enter a date.', state: null };
  if (!time) return { value: null, instant: null, problem: 'Enter a time.', state: null };
  const state = resolveEventDateTime(date, time, timeZone);
  if (state.status === 'ok') return { value: toStoredInstant(state.instant), instant: state.instant, problem: null, state };
  if (state.status === 'gap') {
    return { value: null, instant: null, state, problem: `${formatWallClock(time)} does not exist on ${formatCalendarDate(date)}. The clocks move forward ${formatShift(state.offsetAfter - state.offsetBefore)} that night. Choose an earlier or later time.` };
  }
  if (state.status === 'overlap') {
    const picked = state.candidates.find((candidate) => candidate.offset === choice);
    if (picked) return { value: toStoredInstant(picked.instant), instant: picked.instant, problem: null, state };
    return { value: null, instant: null, state, problem: `${formatWallClock(time)} happens twice on ${formatCalendarDate(date)}. Choose which one you mean.` };
  }
  return { value: null, instant: null, problem: 'Enter a real date and time.', state };
}

function shortZone(instant, timeZone) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
      .formatToParts(instant).find((part) => part.type === 'timeZoneName')?.value ?? '';
  } catch { return ''; }
}

/**
 * @param {object} props
 * @param {string} props.label the legend: what the instant is for
 * @param {string|null} props.value the stored RFC3339 instant, or blank
 * @param {string} props.timeZone the event's IANA zone (config/event.timezone)
 * @param {(value: string|null) => void} props.onChange the new stored value after an edit; null while blank or unresolved
 * @param {(problem: string|null) => void} [props.onProblemChange] the reason a save must wait, or null
 * @param {boolean} [props.required] blank is a problem, not "no value"
 * @param {boolean} [props.showError] show every problem (set after a refused save)
 * @param {string} [props.hint] under the legend
 * @param {string} [props.summaryPrefix] "Closes" reads "Closes Sunday, …"
 * @param {string} [props.emptySummary] the summary while blank
 * @param {boolean} [props.clearable] offer a Clear control
 * @param {boolean} [props.disabled]
 */
export default function EventDateTimeField({
  label, value, timeZone: zoneProp, onChange, onProblemChange, required = false, showError = false,
  hint, summaryPrefix = '', emptySummary = 'No date set.', clearable = false, disabled = false,
}) {
  const id = useId();
  const timeZone = isKnownTimeZone(zoneProp) ? zoneProp : 'UTC';
  const [fields, setFields] = useState(() => fieldsFrom(value, timeZone));
  const emitted = useRef(value || null);
  const zoneRef = useRef(timeZone);
  // A new stored value from outside (a reload, a save elsewhere) replaces
  // the fields. The value this control just sent does not.
  useEffect(() => {
    const next = value || null;
    if (next === emitted.current && zoneRef.current === timeZone) return;
    emitted.current = next;
    zoneRef.current = timeZone;
    setFields(fieldsFrom(next, timeZone));
  }, [value, timeZone]);

  const read = readEventDateTimeFields(fields, timeZone, { required });
  const problemChange = useRef(onProblemChange);
  problemChange.current = onProblemChange;
  useEffect(() => { problemChange.current?.(read.problem); }, [read.problem]);
  useEffect(() => () => problemChange.current?.(null), []);

  function edit(patch) {
    const next = { ...fields, ...patch };
    if ('date' in patch || 'time' in patch) next.choice = null;
    setFields(next);
    const result = readEventDateTimeFields(next, timeZone, { required });
    emitted.current = result.value;
    onChange(result.value);
  }

  const status = read.state?.status;
  // A skipped or repeated time is stated at once: it is a question about
  // the clock, not a mistake in typing. A missing part waits for a save.
  const shown = read.problem && (showError || status === 'gap') ? read.problem : null;
  const dateInvalid = Boolean(shown) && (!fields.date || status === 'invalid');
  const timeInvalid = Boolean(shown) && !dateInvalid && status !== 'overlap';
  const hintId = `${id}-hint`;
  const zoneId = `${id}-zone`;
  const summaryId = `${id}-summary`;
  const errorId = `${id}-error`;
  const legendId = `${id}-legend`;
  const describedBy = [hint ? hintId : null, zoneId, summaryId, shown ? errorId : null].filter(Boolean).join(' ');
  const zoneInstant = read.instant || (fields.date ? resolveEventDateTime(fields.date, '12:00', timeZone).instant : null) || new Date();
  const summary = read.instant
    ? `${summaryPrefix ? `${summaryPrefix} ` : ''}${describeEventDateTime(read.instant, timeZone)}.`
    : !fields.date && !fields.time ? emptySummary : 'Not set until the date and time are complete.';

  return (
    <fieldset className="flex min-w-0 flex-col gap-3xs" disabled={disabled}>
      <legend id={legendId} className={`${fieldLabelClass} mb-3xs`}>{label}</legend>
      {hint ? <p id={hintId} className={`${fieldHintClass} text-pretty`}>{hint}</p> : null}
      <div className="flex flex-wrap items-end gap-sm">
        <div className="flex min-w-0 flex-[1_1_9rem] flex-col gap-3xs">
          <label id={`${id}-date-label`} htmlFor={`${id}-date`} className={partLabelClass}>Date</label>
          <input
            id={`${id}-date`}
            type="date"
            className={inputClass}
            value={fields.date}
            onChange={(event) => edit({ date: event.target.value })}
            aria-labelledby={`${legendId} ${id}-date-label`}
            aria-describedby={describedBy}
            aria-required={required || undefined}
            aria-invalid={dateInvalid ? 'true' : undefined}
          />
        </div>
        <div className="flex min-w-0 flex-[1_1_8rem] flex-col gap-3xs">
          <label id={`${id}-time-label`} htmlFor={`${id}-time`} className={partLabelClass}>Time</label>
          <input
            id={`${id}-time`}
            type="time"
            step={fields.time.length > 5 ? 1 : undefined}
            className={inputClass}
            value={fields.time}
            onChange={(event) => edit({ time: event.target.value })}
            aria-labelledby={`${legendId} ${id}-time-label`}
            aria-describedby={describedBy}
            aria-required={required || undefined}
            aria-invalid={timeInvalid ? 'true' : undefined}
          />
        </div>
        {clearable && (fields.date || fields.time) ? (
          <button type="button" className={secondaryButtonClass} onClick={() => edit({ date: '', time: '' })} aria-label={`Clear ${label.toLowerCase()}`}>Clear</button>
        ) : null}
      </div>
      <p id={zoneId} className={fieldHintClass}>{timeZone === zoneProp
        ? `Event time zone: ${describeTimeZone(timeZone, zoneInstant)}.`
        : 'The event has no time zone set, so this time is in UTC. Set the time zone in Event settings.'}</p>
      {status === 'overlap' ? (
        <fieldset className="mt-3xs flex min-w-0 flex-col border-admin-hairline border-admin-rule-hairline px-sm py-xs" aria-describedby={shown ? errorId : undefined}>
          <legend className={`${fieldLabelClass} px-3xs`}>{formatWallClock(fields.time)} happens twice on {formatCalendarDate(fields.date)}</legend>
          {read.state.candidates.map((candidate, index) => (
            <Radio
              key={candidate.offset}
              tone="admin"
              name={`${id}-choice`}
              value={String(candidate.offset)}
              checked={fields.choice === candidate.offset}
              onChange={() => edit({ choice: candidate.offset })}
              aria-invalid={shown ? 'true' : undefined}
              label={`${formatWallClock(fields.time)} ${shortZone(candidate.instant, timeZone)} (${formatUtcOffset(candidate.offset)}), ${index === 0 ? 'before the clocks go back' : 'after the clocks go back'}`}
            />
          ))}
        </fieldset>
      ) : null}
      <p id={summaryId} role="status" className="text-admin-sm font-medium text-admin-ink">{summary}</p>
      <FieldError id={errorId} message={shown} />
    </fieldset>
  );
}
