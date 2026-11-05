// The pitch form's option lists (ADR 0008 §2): the formats, lengths and
// tracks the public pitch stepper offers, and how many co-presenters one
// pitch may name. Operator-only, like the rest of the call. An empty list
// hides its field on the public form.
//
// Each list is built one choice at a time (AddOneListField). The check is
// shared/pitchForm validatePitchFormOptions, the same rule the server runs,
// so a refusal is shown here before the save, in the server's own words.
import { useEffect, useState } from 'react';
import {
  MAX_CO_PRESENTERS, MAX_OPTIONS, readPitchFormOptions, validatePitchFormOptions,
} from 'shared/pitchForm';
import {
  AddOneListField, Notice, Panel, SaveStatus, SelectField, primaryButtonClass,
} from './formControls.jsx';

/**
 * An entry that is not a whole number stays in the list as NaN, so the shared
 * check names it instead of dropping it.
 */
const minutesOf = (list) => list.map((entry) => (/^\d+$/.test(entry) ? Number(entry) : Number.NaN));

function formOf(options) {
  return {
    formats: options.formats,
    lengths: options.lengths.map(String),
    tracks: options.tracks,
    maxCoPresenters: String(options.maxCoPresenters),
  };
}

const CO_PRESENTER_CHOICES = Array.from({ length: MAX_CO_PRESENTERS + 1 }, (_, n) => ({
  value: String(n),
  label: n === 0 ? 'None: one presenter per pitch' : `Up to ${n}`,
}));

/**
 * @param {{ settings: object|null, call: (name: string, body: object) => Promise<object> }} props
 *   `settings` is the live config/pitch_call document.
 */
export default function PitchFormOptions({ settings, call }) {
  const saved = readPitchFormOptions(settings);
  const savedKey = JSON.stringify(saved);
  const [form, setForm] = useState(() => formOf(saved));
  const [baseline, setBaseline] = useState(savedKey);
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [serverError, setServerError] = useState(null);

  // A save from another tab replaces the form only while this one is unchanged.
  useEffect(() => {
    if (savedKey === baseline) return;
    setForm((current) => (JSON.stringify(current) === JSON.stringify(formOf(JSON.parse(baseline)))
      ? formOf(JSON.parse(savedKey)) : current));
    setBaseline(savedKey);
  }, [savedKey, baseline]);

  const edit = (field) => (value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors([]);
    setResult('');
  };

  async function save(event) {
    event.preventDefault();
    if (busy) return;
    const formOptions = {
      formats: form.formats,
      lengths: minutesOf(form.lengths),
      tracks: form.tracks,
      maxCoPresenters: Number(form.maxCoPresenters),
    };
    const checked = validatePitchFormOptions(formOptions);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setBusy(true);
    setServerError(null);
    try {
      await call('updatePitchFormOptions', { formOptions: checked.options });
      setResult('Pitch form options saved.');
    } catch (err) {
      setServerError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Pitch form options" description={`The choices people pick from on the pitch form. Add each choice, up to ${MAX_OPTIONS} per list. A list with no choices hides its question.`}>
      <form onSubmit={save} className="space-y-sm" noValidate>
        {errors.length ? <Notice tone="error" message={errors.join(' ')} /> : null}
        {serverError ? <Notice tone="error" message={serverError.message} /> : null}
        <fieldset disabled={busy} className="grid gap-sm md:grid-cols-3">
          <AddOneListField label="Formats" itemName="format" items={form.formats} onChange={edit('formats')} hint="For example: Panel, Workshop, Lightning talk." />
          <AddOneListField label="Lengths in minutes" itemName="length" inputMode="numeric" items={form.lengths} onChange={edit('lengths')} hint="Whole minutes, for example 30 or 60." />
          <AddOneListField label="Tracks" itemName="track" items={form.tracks} onChange={edit('tracks')} hint="Add none if the event has no tracks." />
        </fieldset>
        <SelectField label="Co-presenters per pitch" value={form.maxCoPresenters} onChange={edit('maxCoPresenters')} options={CO_PRESENTER_CHOICES} hint="The person who pitches is always the lead presenter." />
        <button type="submit" className={primaryButtonClass} aria-busy={busy || undefined} aria-disabled={busy || undefined}>
          {busy ? 'Saving…' : 'Save pitch form options'}
        </button>
        {result ? <SaveStatus message={result} /> : null}
      </form>
    </Panel>
  );
}
