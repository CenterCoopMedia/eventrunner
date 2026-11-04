import { useEffect, useMemo, useRef } from 'react';
import { GroupError, SelectField, TextField, fieldId } from '../../setup/Field.jsx';
import { MAX_DAYS } from '../../setup/steps.js';

const NEW_DAY = Object.freeze({ date: '', startTime: '09:00', endTime: '17:00' });

/** The browser's time zone, for the preset. */
export function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

function timeZones(current) {
  let zones = [];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    zones = [];
  }
  const all = new Set(zones);
  for (const extra of [current, browserTimeZone(), 'UTC']) if (extra) all.add(extra);
  return [...all].sort();
}

function DayRow({ day, index, errors, onDay, onRemove, onBlur, canRemove }) {
  const base = `event.days.${index}`;
  const set = (key) => (next) => onDay(index, { ...day, [key]: next }, `${base}.${key}`);
  const blur = (key) => () => onBlur(`${base}.${key}`);
  return (
    <li className="day">
      <fieldset className="day-fields">
        <legend>Day {index + 1}</legend>
        <TextField path={`${base}.date`} label="Date" type="date" value={day.date}
          onChange={set('date')} onBlur={blur('date')} error={errors[`${base}.date`]} />
        <TextField path={`${base}.startTime`} label="Starts" type="time" value={day.startTime}
          onChange={set('startTime')} onBlur={blur('startTime')} error={errors[`${base}.startTime`]} />
        <TextField path={`${base}.endTime`} label="Ends" type="time" value={day.endTime}
          onChange={set('endTime')} onBlur={blur('endTime')} error={errors[`${base}.endTime`]} />
        <TextField path={`${base}.label`} label="Name of the day (optional)" hint="For example, Workshops"
          value={day.label || ''} onChange={set('label')} onBlur={blur('label')} error={errors[`${base}.label`]} />
        {canRemove ? (
          <button type="button" className="button" onClick={() => onRemove(index)}>
            Remove day {index + 1}
          </button>
        ) : null}
      </fieldset>
    </li>
  );
}

/** Step 2: the event, its days, its time zone and its venue. */
export default function EventStep({ value, errors, onChange, onBlur }) {
  const zones = useMemo(() => timeZones(value.timezone), [value.timezone]);
  const addButton = useRef(null);
  const set = (key) => (next) => onChange({ ...value, [key]: next }, `event.${key}`);
  const full = value.days.length >= MAX_DAYS;
  const setVenue = (key) => (next) => onChange({ ...value, venue: { ...value.venue, [key]: next } }, `event.venue.${key}`);

  // ADR 0007 §3: the time zone is preset from the browser.
  const preset = useRef(false);
  useEffect(() => {
    if (preset.current || value.timezone) return;
    preset.current = true;
    const zone = browserTimeZone();
    if (zone) onChange({ ...value, timezone: zone }, 'event.timezone');
  }, [value, onChange]);

  function onDay(index, day, path) {
    onChange({ ...value, days: value.days.map((d, i) => (i === index ? day : d)) }, path);
  }

  function addDay() {
    if (full) return;
    const days = [...value.days, { ...NEW_DAY }];
    onChange({ ...value, days }, 'event.days');
    // The new row's date field takes the focus.
    setTimeout(() => document.getElementById(fieldId(`event.days.${days.length - 1}.date`))?.focus(), 0);
  }

  function removeDay(index) {
    onChange({ ...value, days: value.days.filter((_, i) => i !== index) }, 'event.days');
    // After the render, so a button that was off at the limit is on again.
    setTimeout(() => addButton.current?.focus(), 0);
  }

  return (
    <div className="stack">
      <p className="lead">The name and dates your site shows. You can change the details later in your admin panel.</p>
      <TextField path="event.name" label="Event name" hint="For example, 2027 Local News Summit"
        value={value.name} onChange={set('name')} onBlur={() => onBlur('event.name')} error={errors['event.name']} />
      <TextField path="event.shortName" label="Short name" hint="Used in email subjects. For example, News Summit"
        value={value.shortName} onChange={set('shortName')} onBlur={() => onBlur('event.shortName')} error={errors['event.shortName']} />
      <TextField path="event.tagline" label="One-line description (optional)"
        value={value.tagline} onChange={set('tagline')} onBlur={() => onBlur('event.tagline')} error={errors['event.tagline']} />
      <SelectField path="event.timezone" label="Time zone" hint="We set this from your browser. Change it if the event is in another time zone."
        value={value.timezone} options={zones} onChange={set('timezone')} onBlur={() => onBlur('event.timezone')} error={errors['event.timezone']} />

      <section aria-labelledby="days-title" className="stack">
        <h2 id="days-title">Dates</h2>
        <GroupError path="event.days" error={errors['event.days']} />
        <ol className="days">
          {value.days.map((day, index) => (
            <DayRow key={index} day={day} index={index} errors={errors} onDay={onDay} onRemove={removeDay}
              onBlur={onBlur} canRemove={value.days.length > 1} />
          ))}
        </ol>
        <p>
          <button type="button" className="button" ref={addButton} onClick={addDay} disabled={full}
            aria-describedby={full ? 'days-full' : undefined}>Add a day</button>
        </p>
        {full ? <p className="muted" id="days-full">An event can have {MAX_DAYS} days or fewer.</p> : null}
      </section>

      <section aria-labelledby="venue-title" className="stack">
        <h2 id="venue-title">Venue (optional)</h2>
        <TextField path="event.venue.name" label="Venue name" value={value.venue.name}
          onChange={setVenue('name')} onBlur={() => onBlur('event.venue.name')} error={errors['event.venue.name']} />
        <TextField path="event.venue.address" label="Venue address" multiline value={value.venue.address}
          onChange={setVenue('address')} onBlur={() => onBlur('event.venue.address')} error={errors['event.venue.address']} />
      </section>
    </div>
  );
}
