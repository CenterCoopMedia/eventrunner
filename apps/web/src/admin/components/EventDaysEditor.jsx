import { useRef, useState } from 'react';
import { formatCalendarDate } from '../../lib/eventDateTime.js';
import { FieldError, Panel, TextField } from './formControls.jsx';
import {
  AddItemButton,
  RemovalWarning,
  RemoveItemButton,
  afterRender,
  usageSentence,
} from './listItemControls.jsx';

// The event days (issues #14 and #475). Each day keeps its label, date, and
// start and end times. Its id is not a field: sessions store it (dayId), so
// a saved day keeps the id it has, and a new day gets one when it is added.
// That id stays in the form until a save lands, so a refused save that is
// tried again sends the same id. The id skips every id another day has and
// every id a live or draft session still names, so a new day never picks up
// a removed day's sessions.

let rowCount = 0;
/** A form-only key per row. Never stored; the id is the stored identity. */
const rowKey = () => `day-row-${(rowCount += 1)}`;

/**
 * The stored days as form rows.
 *
 * @param {unknown} days config/event.days
 */
export function normalizeDays(days) {
  return Array.isArray(days)
    ? days.map((day) => ({
      key: rowKey(),
      id: day?.id ?? '',
      label: day?.label ?? '',
      date: day?.date ?? '',
      startTime: day?.startTime ?? '',
      endTime: day?.endTime ?? '',
    }))
    : [];
}

/** The rows as updateEventConfig takes them: the stored fields only. */
export function daysPayload(days) {
  return days.map((day) => ({
    id: day.id,
    label: day.label,
    date: day.date,
    startTime: day.startTime,
    endTime: day.endTime,
  }));
}

/**
 * The id for a new day: `day-N`, counting on from the list's length, and
 * past any id in `reserved` (ids sessions still name) or on another day.
 *
 * @param {{ id: string }[]} days
 * @param {Set<string>|Map<string, unknown>} reserved
 */
export function nextDayId(days, reserved) {
  const taken = new Set(days.map((day) => day.id));
  let n = days.length + 1;
  while (taken.has(`day-${n}`) || reserved.has(`day-${n}`)) n += 1;
  return `day-${n}`;
}

/** How a day is named to a screen reader: its label, else its date. */
function dayName(day) {
  if (day.label.trim()) return day.label.trim();
  return day.date ? formatCalendarDate(day.date) : '';
}

/**
 * @param {object} props
 * @param {object[]} props.days the form rows (normalizeDays)
 * @param {(days: object[]) => void} props.onChange
 * @param {(field: string) => string|undefined} props.errorFor
 * @param {Map<string, string[]>} props.dayUsage day id → titles of the live and draft sessions on it
 * @param {boolean} [props.usageReady] both session lists have loaded and are listening;
 *   until then a new id or a removal could be judged against sessions not yet read
 */
export default function EventDaysEditor({ days, onChange, errorFor, dayUsage, usageReady = true }) {
  const [notice, setNotice] = useState('');
  const [confirming, setConfirming] = useState(null);
  const listRef = useRef(null);
  const addRef = useRef(null);
  const removeRefs = useRef(new Map());

  // Focus goes to the remove control now at that place, else the one
  // before it, else the add control.
  const focusRemoveAt = (rows, index) => {
    const key = (rows[index] ?? rows[index - 1])?.key;
    const target = (key ? removeRefs.current.get(key) : null) ?? addRef.current;
    target?.focus();
  };

  const setDay = (index, patch) => onChange(days.map((day, i) => (i === index ? { ...day, ...patch } : day)));

  const add = () => {
    if (!usageReady) return;
    const day = { key: rowKey(), id: nextDayId(days, dayUsage), label: '', date: '', startTime: '', endTime: '' };
    onChange([...days, day]);
    setNotice('');
    afterRender(() => listRef.current?.querySelector(`[data-row-key="${day.key}"]`)?.focus());
  };

  const remove = (index) => {
    const day = days[index];
    const next = days.filter((_, i) => i !== index);
    setConfirming(null);
    onChange(next);
    setNotice(`${dayName(day) || `Day ${index + 1}`} will be removed when you save.`);
    afterRender(() => focusRemoveAt(next, index));
  };

  const requestRemove = (index) => {
    if (!usageReady) return;
    if ((dayUsage.get(days[index].id) ?? []).length > 0) setConfirming(days[index].key);
    else remove(index);
  };

  return (
    <Panel
      className="admin-settings-card"
      title="Days"
      description="Listed in date order. Each day needs a date and start and end times. Sessions are placed on a day here."
      actions={<AddItemButton ref={addRef} onClick={add} unavailable={!usageReady}>Add day</AddItemButton>}
    >
      {usageReady ? null : (
        <p className="mb-sm text-admin-sm text-admin-ink-secondary">
          Checking which sessions use these days. You can add and remove days when that is done.
        </p>
      )}
      {notice ? <p role="status" className="mb-sm text-admin-sm text-admin-ink-secondary">{notice}</p> : null}
      {days.length === 0 ? (
        <p className="text-admin-sm text-admin-ink-secondary">No days configured yet.</p>
      ) : (
        <ol ref={listRef} className="admin-settings-row-list">
          {days.map((day, index) => {
            const n = index + 1;
            const name = dayName(day);
            const uses = dayUsage.get(day.id) ?? [];
            const headingId = `${day.key}-heading`;
            const idError = errorFor(`days[${index}].id`);
            return (
              <li key={day.key} className="admin-settings-row-card" aria-labelledby={headingId}>
                <div className="admin-settings-row-heading">
                  <h3 id={headingId} className="min-w-0 break-words text-admin-base font-bold text-admin-ink">
                    Day {n}
                    {day.label.trim() ? <span className="font-normal text-admin-ink-secondary">: {day.label.trim()}</span> : null}
                  </h3>
                  <RemoveItemButton
                    ref={(node) => {
                      if (node) removeRefs.current.set(day.key, node);
                      else removeRefs.current.delete(day.key);
                    }}
                    name={`Remove day ${n}${name ? `, ${name}` : ''}`}
                    onClick={() => requestRemove(index)}
                    unavailable={!usageReady}
                  />
                </div>
                <div className="admin-settings-fields">
                  <TextField
                    label={`Day ${n} label`}
                    value={day.label}
                    onChange={(value) => setDay(index, { label: value })}
                    error={errorFor(`days[${index}].label`)}
                    data-row-key={day.key}
                  />
                  <TextField
                    label={`Day ${n} date`}
                    type="date"
                    value={day.date}
                    onChange={(value) => setDay(index, { date: value })}
                    error={errorFor(`days[${index}].date`) ?? errorFor(`days[${index}]`)}
                  />
                  <div className="admin-settings-field--wide admin-settings-time-fields">
                    <TextField
                      label={`Day ${n} start`}
                      type="time"
                      value={day.startTime}
                      onChange={(value) => setDay(index, { startTime: value })}
                      error={errorFor(`days[${index}].startTime`)}
                    />
                    <TextField
                      label={`Day ${n} end`}
                      type="time"
                      value={day.endTime}
                      onChange={(value) => setDay(index, { endTime: value })}
                      error={errorFor(`days[${index}].endTime`)}
                    />
                  </div>
                </div>
                {usageReady && uses.length > 0 ? (
                  <p className="mt-sm text-admin-sm text-admin-ink-secondary">{usageSentence(uses)}</p>
                ) : null}
                {idError ? <div className="mt-sm"><FieldError message={`Day ${n}: ${idError}`} /></div> : null}
                {confirming === day.key ? (
                  <RemovalWarning
                    title={`Remove day ${n}?`}
                    consequence={`${uses.length} session${uses.length === 1 ? ' uses' : 's use'} this day. ${uses.length === 1 ? 'It stays' : 'They stay'} saved, but ${uses.length === 1 ? 'it leaves' : 'they leave'} the public schedule until you give each one another day. Nothing changes until you save.`}
                    confirmLabel={`Remove day ${n} anyway`}
                    keepLabel={`Keep day ${n}`}
                    onConfirm={() => remove(index)}
                    onKeep={() => {
                      setConfirming(null);
                      afterRender(() => focusRemoveAt(days, index));
                    }}
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
